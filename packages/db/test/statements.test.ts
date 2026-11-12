import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  billOnNextStatement,
  cardSpendLines,
  cardStatement,
  cardStatements,
  cardStatementLines,
  createAccount,
  createCardAccount,
  listAccounts,
  nativeBalances,
  payCardPurchases,
  postTransaction,
  replaceTransaction,
  saveInstallment,
  deleteInstallment,
  saveCardTerms,
  setPostedOn,
  setSettledBeforeApp,
  StatementError,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** A card with a statement on the 20th, a bank account to pay it from, and a groceries category. */
async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'BCA Visa', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const buy = (occurredOn: string, description: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor, currency: 'IDR' }) });
  const pay = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description: 'Card payment', lines: transferLines({ fromAccountId: bank.id, toAccountId: card.id, amountMinor, currency: 'IDR' }) });
  return { database, ws, card, bank, buy, pay };
}

const AUGUST = statementCycleFor('2026-08-20', 20); // 21 Jul – 20 Aug
const SEPTEMBER = statementCycleFor('2026-09-20', 20); // 21 Aug – 20 Sep

describe('a card statement', () => {
  it('closes at what was owed before, plus charges, less payments, and says what is left after it', async () => {
    const h = await household();
    await h.buy('2026-07-10', 'June stuff', 100_000);
    await h.buy('2026-08-01', 'Superindo', 450_000);
    await h.pay('2026-08-05', 100_000);
    await h.buy('2026-08-25', 'Ranch Market', 80_000);
    await h.pay('2026-08-28', 200_000);

    const august = await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01');
    expect(august).toMatchObject({ openingMinor: 100_000, chargesMinor: 450_000, creditsMinor: 100_000, closingMinor: 450_000, closed: true, paidSinceMinor: 200_000, leftToPayMinor: 250_000 });
    expect(august.lines.map((line) => line.description)).toEqual(['Superindo', 'Card payment']);

    const september = await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-01');
    expect(september).toMatchObject({ openingMinor: 450_000, chargesMinor: 80_000, creditsMinor: 200_000, closingMinor: 330_000, closed: false, leftToPayMinor: null });
  });
});

describe('several statements of one card at once', () => {
  it('reads the card once and gives each cycle exactly what cardStatement gives it', async () => {
    const h = await household();
    await h.buy('2026-07-10', 'June stuff', 100_000);
    await h.buy('2026-08-01', 'Superindo', 450_000);
    await h.pay('2026-08-05', 100_000);
    await h.buy('2026-08-25', 'Ranch Market', 80_000);
    await h.pay('2026-08-28', 200_000);
    const many = await cardStatements(h.database, h.ws, h.card.id, [AUGUST, SEPTEMBER], '2026-09-01');
    expect(many).toEqual([
      await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01'),
      await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-01'),
    ]);
    expect(await cardStatements(h.database, h.ws, h.card.id, [], '2026-09-01')).toEqual([]);
  });
});

describe('a purchase paid off before the app', () => {
  it('shows as one marked line, its balancing settlement kept in the totals but not drawn, and nothing to pay', async () => {
    const h = await household();
    const groceries = (await listAccounts(h.database, h.ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    const paidOff = await postTransaction(h.database, h.ws, {
      occurredOn: '2026-08-02',
      description: 'Hero Market',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: h.card.id, amountMinor: 230_000, currency: 'IDR' }),
      settledBeforeApp: true,
    });
    await h.buy('2026-08-03', 'Kopi', 40_000);

    const august = await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01');
    expect(august.lines.map((line) => [line.description, line.paidOff])).toEqual([
      ['Hero Market', true],
      ['Kopi', false],
    ]);
    expect(august).toMatchObject({ chargesMinor: 270_000, creditsMinor: 230_000, closingMinor: 40_000, leftToPayMinor: 40_000 });
    expect((await cardStatementLines(h.database, h.ws, h.card.id)).map((line) => line.description)).toEqual(['Hero Market', 'Kopi']);
    expect(august.lines.find((line) => line.transactionId === paidOff)?.balancing).toBe(false);
  });
});

describe('a purchase the bank billed late', () => {
  it('moves to the next statement and its points cycle, keeping its purchase date', async () => {
    const h = await household();
    const late = await h.buy('2026-08-19', 'Late posting', 300_000);

    expect(await billOnNextStatement(h.database, h.ws, h.card.id, late)).toBe('2026-08-21');

    const august = await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01');
    const september = await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-01');
    expect(august.chargesMinor).toBe(0);
    expect(september.lines[0]).toMatchObject({ transactionId: late, occurredOn: '2026-08-19', postedOn: '2026-08-21', statementOn: '2026-08-21' });
    expect(await cardSpendLines(h.database, h.ws, h.card.id, AUGUST.start, AUGUST.end)).toHaveLength(0);
    expect(await cardSpendLines(h.database, h.ws, h.card.id, SEPTEMBER.start, SEPTEMBER.end)).toHaveLength(1);
  });

  it('goes back when the posting date is cleared, and refuses a posting before the purchase', async () => {
    const h = await household();
    const late = await h.buy('2026-08-19', 'Late posting', 300_000);
    await setPostedOn(h.database, h.ws, late, '2026-08-22');
    await expect(setPostedOn(h.database, h.ws, late, '2026-08-18')).rejects.toMatchObject({ code: 'POSTED_BEFORE_PURCHASE' });

    await setPostedOn(h.database, h.ws, late, null);
    expect((await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01')).chargesMinor).toBe(300_000);
  });

  it('keeps its posting date when the purchase is corrected', async () => {
    const h = await household();
    const late = await h.buy('2026-08-19', 'Late posting', 300_000);
    await billOnNextStatement(h.database, h.ws, h.card.id, late);
    const groceries = (await listAccounts(h.database, h.ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await replaceTransaction(h.database, h.ws, late, {
      occurredOn: '2026-08-19',
      description: 'Late posting, corrected',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: h.card.id, amountMinor: 320_000, currency: 'IDR' }),
    });
    expect((await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-01')).chargesMinor).toBe(320_000);
  });
});

describe('paying purchases before the statement', () => {
  it('moves their total from the bank and marks exactly those purchases paid', async () => {
    const h = await household();
    const superindo = await h.buy('2026-08-22', 'Superindo', 450_000);
    const ranch = await h.buy('2026-08-23', 'Ranch Market', 80_000);
    const hotel = await h.buy('2026-08-24', 'Hotel', 2_000_000);

    const payment = await payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-08-25', purchaseTransactionIds: [superindo, ranch] });

    const statement = await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-08-26');
    const paid = (id: string) => statement.lines.find((line) => line.transactionId === id)!.paidBy;
    expect(paid(superindo)).toEqual({ transactionId: payment, paidOn: '2026-08-25' });
    expect(paid(ranch)).toEqual({ transactionId: payment, paidOn: '2026-08-25' });
    expect(paid(hotel)).toBeNull();
    expect(statement).toMatchObject({ chargesMinor: 2_530_000, creditsMinor: 530_000, closingMinor: 2_000_000 });
    const paymentLine = statement.lines.find((line) => line.transactionId === payment)!;
    expect(paymentLine).toMatchObject({ owedMinor: -530_000, spending: false });
  });

  it('will not pay a purchase twice, and frees it again when the payment is deleted', async () => {
    const h = await household();
    const superindo = await h.buy('2026-08-22', 'Superindo', 450_000);
    const input = { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-08-25', purchaseTransactionIds: [superindo] };
    const payment = await payCardPurchases(h.database, h.ws, input);

    await expect(payCardPurchases(h.database, h.ws, input)).rejects.toMatchObject({ code: 'ALREADY_PAID' });
    await voidTransaction(h.database, h.ws, payment);
    const again = await payCardPurchases(h.database, h.ws, input);
    const [line] = (await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-08-26')).lines.filter((l) => l.transactionId === superindo);
    expect(line!.paidBy?.transactionId).toBe(again);
  });

  it('refuses what is not a purchase on this card, or a bank in another currency', async () => {
    const h = await household();
    const payment = await h.pay('2026-08-22', 100_000);
    await expect(payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-08-25', purchaseTransactionIds: [payment] })).rejects.toBeInstanceOf(StatementError);
    const usd = await createAccount(h.database, h.ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
    const superindo = await h.buy('2026-08-22', 'Superindo', 450_000);
    await expect(payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: usd.id, occurredOn: '2026-08-25', purchaseTransactionIds: [superindo] })).rejects.toMatchObject({ code: 'CURRENCY' });
  });

  it('pays only what is left of a purchase a payment partly covered, and the card ends at exactly nothing', async () => {
    const h = await household();
    await h.buy('2026-07-25', 'Market', 312_000);
    await h.buy('2026-07-28', 'Ride', 95_000);
    const shop = await h.buy('2026-08-02', 'Shop', 549_000);
    const dinner = await h.buy('2026-08-06', 'Dinner', 170_000);
    // A lump payment after the statement: Market and Ride whole, Rp 3.000 of Shop.
    await h.pay('2026-08-28', 410_000);

    const payment = await payCardPurchases(h.database, h.ws, {
      cardAccountId: h.card.id,
      fromAccountId: h.bank.id,
      occurredOn: '2026-08-30',
      purchaseTransactionIds: [shop, dinner],
      amountsMinor: { [shop]: 546_000 },
      today: '2026-08-30',
    });

    const august = await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01');
    expect(august.laterCredits.find((line) => line.transactionId === payment)!.owedMinor).toBe(-716_000);
    // Dinner, paid whole, is settled by it; Shop, paid for what was left, is covered by the lump and this payment.
    expect(august.lines.find((line) => line.transactionId === dinner)!.paidBy?.transactionId).toBe(payment);
    expect(august.lines.find((line) => line.transactionId === shop)!.paidBy).toBeNull();
    expect(august.cover[shop]).toMatchObject({ whole: true, creditKey: payment });
    expect(august.leftToPayMinor).toBe(0);
    expect((await nativeBalances(h.database, h.ws))[h.card.id] ?? 0).toBe(0);
  });

  it('refuses to pay more of a purchase than it charged, or nothing of it', async () => {
    const h = await household();
    const shop = await h.buy('2026-08-02', 'Shop', 549_000);
    const pay = (amountMinor: number) =>
      payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-08-30', purchaseTransactionIds: [shop], amountsMinor: { [shop]: amountMinor } });
    for (const amountMinor of [549_001, 0, -1, 1.5]) await expect(pay(amountMinor)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    expect((await nativeBalances(h.database, h.ws))[h.card.id]).toBe(-549_000);
  });
});

describe('what the card’s payments cover on a statement', () => {
  const coverOf = async (h: Awaited<ReturnType<typeof household>>, cycle: typeof AUGUST, today: string) => (await cardStatement(h.database, h.ws, h.card.id, cycle, today)).cover;
  const cardBalance = async (h: Awaited<ReturnType<typeof household>>) => (await nativeBalances(h.database, h.ws))[h.card.id] ?? 0;

  it('a purchase paid one by one on a later statement covers nothing on this one, so paying what is offered clears the card', async () => {
    const h = await household();
    const p1 = await h.buy('2026-08-02', 'Bookshop', 300_000);
    const q = await h.buy('2026-08-25', 'Bakery', 100_000);
    await payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-08-30', purchaseTransactionIds: [q], today: '2026-08-30' });

    const cover = await coverOf(h, AUGUST, '2026-09-01');
    expect(cover[p1]).toMatchObject({ coveredMinor: 0, leftMinor: 300_000, whole: false });
    await payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-09-01', purchaseTransactionIds: [p1], amountsMinor: { [p1]: cover[p1]!.leftMinor }, today: '2026-09-01' });
    expect(await cardBalance(h)).toBe(0);
  });

  it('paying what is left of a part-covered purchase writes no settlement: deleting the lump makes the rest owed again', async () => {
    const h = await household();
    const a = await h.buy('2026-08-02', 'Bookshop', 100_000);
    const lump = await h.pay('2026-08-25', 60_000);
    expect((await coverOf(h, AUGUST, '2026-09-01'))[a]).toMatchObject({ coveredMinor: 60_000, leftMinor: 40_000 });

    const rest = await payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-09-01', purchaseTransactionIds: [a], amountsMinor: { [a]: 40_000 }, today: '2026-09-01' });
    const august = await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01');
    expect(august.lines.find((line) => line.transactionId === a)!.paidBy).toBeNull();
    expect(august.cover[a]).toMatchObject({ whole: true, creditKey: rest });
    expect(await cardBalance(h)).toBe(0);

    await voidTransaction(h.database, h.ws, lump);
    expect((await coverOf(h, AUGUST, '2026-09-01'))[a]).toMatchObject({ coveredMinor: 40_000, leftMinor: 60_000, whole: false });
    expect(await cardBalance(h)).toBe(-60_000);
  });

  it('a purchase paid off before the app gives no cover, even when its balancing settlement falls on another statement', async () => {
    const h = await household();
    const x = await h.buy('2026-08-02', 'Bookshop', 100_000);
    const y = await h.buy('2026-08-18', 'Bakery', 50_000);
    await setPostedOn(h.database, h.ws, y, '2026-08-22');
    await setSettledBeforeApp(h.database, h.ws, y, true);

    expect((await coverOf(h, AUGUST, '2026-09-01'))[x]).toMatchObject({ coveredMinor: 0, leftMinor: 100_000 });
  });

  it('a purchase paid one by one and then converted to a plan: its payment covers the instalments, and nothing is offered to pay', async () => {
    const h = await household();
    const phone = await h.buy('2026-07-02', 'Phone', 300_000);
    await payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: '2026-07-05', purchaseTransactionIds: [phone], today: '2026-07-05' });
    await saveInstallment(h.database, h.ws, { cardAccountId: h.card.id, description: 'Phone plan', totalMinor: 300_000, months: 3, firstBilledMonth: '2026-07', transactionId: phone });

    const today = '2026-10-01';
    const cycles = [statementCycleFor('2026-07-20', 20), AUGUST, SEPTEMBER];
    const rows = [];
    for (const cycle of cycles) {
      const s = await cardStatement(h.database, h.ws, h.card.id, cycle, today);
      for (const line of s.lines.filter((l) => l.instalment)) rows.push(s.cover[line.key]);
    }
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toMatchObject({ whole: true, leftMinor: 0 });
    expect(await cardBalance(h)).toBe(0);
  });

  it('refuses to pay more than is left right now, or a purchase a payment now covers whole', async () => {
    const h = await household();
    const a = await h.buy('2026-08-02', 'Bookshop', 100_000);
    await h.pay('2026-08-25', 60_000);
    const pay = (amountMinor?: number) =>
      payCardPurchases(h.database, h.ws, {
        cardAccountId: h.card.id,
        fromAccountId: h.bank.id,
        occurredOn: '2026-09-01',
        purchaseTransactionIds: [a],
        ...(amountMinor === undefined ? {} : { amountsMinor: { [a]: amountMinor } }),
        today: '2026-09-01',
      });
    await expect(pay()).rejects.toMatchObject({ code: 'STALE_AMOUNT', message: 'Already partly covered by a payment. Open the statement again.' });
    await expect(pay(50_000)).rejects.toMatchObject({ code: 'STALE_AMOUNT' });
    await h.pay('2026-08-28', 40_000);
    await expect(pay(1_000)).rejects.toMatchObject({ code: 'STALE_AMOUNT' });
    expect(await cardBalance(h)).toBe(0);
  });
});

describe('credits after a closed statement', () => {
  it('lists the payments and money back since its statement date, up to today, and none on an open statement', async () => {
    const h = await household();
    await h.buy('2026-08-02', 'Shop', 549_000);
    const early = await h.pay('2026-08-05', 100_000);
    const since = await h.pay('2026-08-28', 200_000);
    await h.pay('2026-09-03', 50_000);

    const august = await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01');
    expect(august.laterCredits.map((line) => line.transactionId)).toEqual([since]);
    expect(august.laterCredits.reduce((sum, line) => sum - line.countedMinor, 0)).toBe(august.paidSinceMinor);
    expect(august.lines.some((line) => line.transactionId === early)).toBe(true);
    const september = await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-01');
    expect(september.laterCredits).toEqual([]);
  });
});

describe('a purchase converted to instalments', () => {
  it('stays on its statement counting nothing, and bills one instalment a month after', async () => {
    const h = await household();
    const phone = await h.buy('2026-07-06', 'iBox iPhone 16 Pro', 12_000_000);
    await saveInstallment(h.database, h.ws, { cardAccountId: h.card.id, description: 'iBox iPhone 16 Pro', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-08', transactionId: phone });

    const JULY = statementCycleFor('2026-07-20', 20);
    const july = await cardStatement(h.database, h.ws, h.card.id, JULY, '2026-09-01');
    expect(july.chargesMinor).toBe(0);
    expect(july.lines).toEqual([expect.objectContaining({ transactionId: phone, owedMinor: 12_000_000, countedMinor: 0, convertedTo: expect.objectContaining({ months: 12 }) })]);

    const august = await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01');
    expect(august.lines).toEqual([expect.objectContaining({ statementOn: '2026-08-20', countedMinor: 1_000_000, instalment: expect.objectContaining({ number: 1, of: 12 }) })]);
    expect(august).toMatchObject({ openingMinor: 0, chargesMinor: 1_000_000, closingMinor: 1_000_000, leftToPayMinor: 1_000_000 });

    const september = await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-01');
    expect(september).toMatchObject({ openingMinor: 1_000_000, chargesMinor: 1_000_000, closingMinor: 2_000_000 });
  });

  it('counts the full purchase again once the plan is removed', async () => {
    const h = await household();
    const phone = await h.buy('2026-07-06', 'iBox iPhone 16 Pro', 12_000_000);
    const plan = await saveInstallment(h.database, h.ws, { cardAccountId: h.card.id, description: 'iBox iPhone 16 Pro', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-08', transactionId: phone });
    await deleteInstallment(h.database, h.ws, plan);

    const july = await cardStatement(h.database, h.ws, h.card.id, statementCycleFor('2026-07-20', 20), '2026-09-01');
    expect(july.chargesMinor).toBe(12_000_000);
    expect((await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01')).lines).toEqual([]);
  });

  it('leaves a plan with no purchase on this card out of the statement', async () => {
    const h = await household();
    await saveInstallment(h.database, h.ws, { cardAccountId: h.card.id, description: 'Old plan', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-08' });
    expect((await cardStatement(h.database, h.ws, h.card.id, AUGUST, '2026-09-01')).lines).toEqual([]);
  });
});
