import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  billOnNextStatement,
  cardSpendLines,
  cardStatement,
  createAccount,
  createCardAccount,
  listAccounts,
  payCardPurchases,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  setPostedOn,
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
});
