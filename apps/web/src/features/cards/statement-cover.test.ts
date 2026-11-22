import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import {
  cardStatement,
  createAccount,
  createCardAccount,
  createDatabase,
  createWorkspace,
  listAccounts,
  migrate,
  nativeBalances,
  payCardPurchases,
  postTransaction,
  saveCardTerms,
  setPostedOn,
  setSettledBeforeApp,
  voidTransaction,
  type StatementLine,
} from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it } from 'vitest';
import { type LineCover, paidCountText, paidHowText, showsPaid, statementCover } from './statement-cover';
import { statementTotals } from './statement-totals';

/* Invented figures and names throughout. A card with a statement on the 20th: August is 21 Jul – 20 Aug. */
const AUGUST = statementCycleFor('2026-08-20', 20);
const TODAY = '2026-09-01';

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
});

async function card() {
  const executor = createNodeExecutor();
  close = () => executor.close();
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const visa = await createCardAccount(database, ws, { name: 'Kartu Satu', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: visa.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Bank Satu', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const buy = (occurredOn: string, description: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  /** A lump payment, the way the card page's Pay records one. */
  const pay = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description: 'Card payment', lines: transferLines({ fromAccountId: bank.id, toAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  const statement = () => cardStatement(database, ws, visa.id, AUGUST, TODAY);
  /** Ticks purchases and pays them for what the page offers: each one's amount left. */
  const payWhatIsOffered = async (ids: string[], occurredOn = TODAY) => {
    const s = await statement();
    const cover = statementCover(s);
    const byId = new Map(s.lines.map((line) => [line.transactionId, line]));
    return payCardPurchases(database, ws, {
      cardAccountId: visa.id,
      fromAccountId: bank.id,
      occurredOn,
      purchaseTransactionIds: ids,
      amountsMinor: Object.fromEntries(ids.map((id) => [id, cover.get(byId.get(id)!.key)?.leftMinor ?? byId.get(id)!.owedMinor])),
      today: TODAY,
    });
  };
  const balance = async () => (await nativeBalances(database, ws))[visa.id] ?? 0;
  return { database, ws, visa, bank, buy, pay, statement, payWhatIsOffered, balance };
}

describe('which purchases a statement’s payments cover', () => {
  it('a statement paid in full with Pay shows every purchase covered, by that payment', async () => {
    const c = await card();
    const ids = [await c.buy('2026-08-02', 'Market', 412_000), await c.buy('2026-08-03', 'Ride', 185_000), await c.buy('2026-08-04', 'Shop', 649_000)];
    const lump = await c.pay('2026-08-28', 1_246_000);
    const s = await c.statement();
    expect(statementTotals(s).leftMinor).toBe(0);
    const cover = statementCover(s);
    for (const id of ids) expect(cover.get(id)).toMatchObject({ whole: true, by: { transactionId: lump }, creditCount: 1 });
    expect(s.lines.filter((line) => line.countedMinor > 0).every((line) => showsPaid(line, cover))).toBe(true);
  });

  it('a part payment covers the oldest first; paying what is offered ends the card at exactly nothing', async () => {
    const c = await card();
    await c.buy('2026-08-02', 'Market', 412_000);
    await c.buy('2026-08-03', 'Ride', 185_000);
    const shop = await c.buy('2026-08-04', 'Shop', 649_000);
    const dinner = await c.buy('2026-08-06', 'Dinner', 280_000);
    await c.pay('2026-08-28', 600_000);
    const cover = statementCover(await c.statement());
    expect(cover.get(shop)).toMatchObject({ whole: false, coveredMinor: 3_000, leftMinor: 646_000 });
    expect(cover.get(dinner)).toMatchObject({ coveredMinor: 0, leftMinor: 280_000 });

    await c.payWhatIsOffered([shop, dinner]);
    expect(await c.balance()).toBe(0);
    const after = await c.statement();
    expect(after.lines.filter((line) => line.countedMinor > 0).every((line) => showsPaid(line, statementCover(after)))).toBe(true);
  });

  it('a purchase paid one by one for a later statement covers nothing here, so paying what is offered clears the card', async () => {
    const c = await card();
    const bookshop = await c.buy('2026-08-02', 'Bookshop', 300_000);
    const bakery = await c.buy('2026-08-25', 'Bakery', 100_000);
    await payCardPurchases(c.database, c.ws, { cardAccountId: c.visa.id, fromAccountId: c.bank.id, occurredOn: '2026-08-30', purchaseTransactionIds: [bakery], today: '2026-08-30' });

    expect(statementCover(await c.statement()).get(bookshop)).toMatchObject({ coveredMinor: 0, leftMinor: 300_000 });
    await c.payWhatIsOffered([bookshop]);
    expect(await c.balance()).toBe(0);
  });

  it('a purchase paid for what was left drops back to owed for the rest when the lump is deleted', async () => {
    const c = await card();
    const a = await c.buy('2026-08-02', 'Bookshop', 100_000);
    const lump = await c.pay('2026-08-25', 60_000);
    const rest = await c.payWhatIsOffered([a]);
    // The lump and the payment for what was left both went into it: two payments, the later one completing it.
    expect(statementCover(await c.statement()).get(a)).toMatchObject({ whole: true, by: { transactionId: rest }, creditCount: 2 });

    await voidTransaction(c.database, c.ws, lump);
    const s = await c.statement();
    expect(statementCover(s).get(a)).toMatchObject({ whole: false, coveredMinor: 40_000, leftMinor: 60_000 });
    expect(showsPaid(s.lines.find((line) => line.transactionId === a)!, statementCover(s))).toBe(false);
    expect(await c.balance()).toBe(-60_000);
  });

  it('a purchase paid off before the app, billed on the next statement, gives this one no cover', async () => {
    const c = await card();
    const x = await c.buy('2026-08-02', 'Bookshop', 100_000);
    const y = await c.buy('2026-08-18', 'Bakery', 50_000);
    await setPostedOn(c.database, c.ws, y, '2026-08-22');
    await setSettledBeforeApp(c.database, c.ws, y, true);
    expect(statementCover(await c.statement()).get(x)).toMatchObject({ coveredMinor: 0, leftMinor: 100_000, by: null });
  });

  it('a page read before a lump arrived cannot pay more than is left now', async () => {
    const c = await card();
    const a = await c.buy('2026-08-02', 'Bookshop', 100_000);
    const stale = statementCover(await c.statement()).get(a)!;
    await c.pay('2026-08-25', 60_000);
    await expect(
      payCardPurchases(c.database, c.ws, { cardAccountId: c.visa.id, fromAccountId: c.bank.id, occurredOn: TODAY, purchaseTransactionIds: [a], amountsMinor: { [a]: stale.leftMinor }, today: TODAY }),
    ).rejects.toMatchObject({ code: 'STALE_AMOUNT' });
    expect(await c.balance()).toBe(-40_000);
  });
});

describe('the count beside a statement’s heading', () => {
  it('says All paid when every purchase is ticked either way, otherwise how many of them', () => {
    expect(paidCountText(4, 4)).toBe('All paid');
    expect(paidCountText(2, 4)).toBe('2 of 4 paid');
    expect(paidCountText(0, 3)).toBe('0 of 3 paid');
    expect(paidCountText(0, 0)).toBeNull();
  });
});

describe('the words that say how a paid line was paid', () => {
  const line = (over: Partial<StatementLine> = {}): StatementLine => ({
    key: 'l1',
    transactionId: 't1',
    occurredOn: '2026-10-23',
    postedOn: null,
    statementOn: '2026-10-23',
    description: 'Restoran Satu',
    cardId: null,
    owedMinor: 520_000,
    countedMinor: 520_000,
    instalment: null,
    convertedTo: null,
    spending: true,
    originalCurrency: null,
    originalAmountMinor: null,
    paidBy: null,
    settles: 0,
    paidOff: false,
    balancing: false,
    ...over,
  });
  const payment = line({ key: 'p1', transactionId: 'p1', occurredOn: '2026-11-15', owedMinor: -340_000, countedMinor: -340_000, spending: false });
  const covered = (over: Partial<LineCover>): ReadonlyMap<string, LineCover> => new Map([['l1', { coveredMinor: 520_000, leftMinor: 0, whole: true, by: payment, creditCount: 1, ...over }]]);
  const none = new Map<string, LineCover>();

  it('says nothing for a line not paid, or only part covered', () => {
    expect(paidHowText(line(), none)).toBeNull();
    expect(paidHowText(line(), covered({ coveredMinor: 100_000, leftMinor: 420_000, whole: false }))).toBeNull();
  });

  it('names the pay date of a purchase paid one by one', () => {
    expect(paidHowText(line({ paidBy: { transactionId: 'p2', paidOn: '2026-11-03' } }), none)).toBe('Paid 3 Nov');
  });

  it('names the payment that covered it, or how many did', () => {
    expect(paidHowText(line(), covered({}))).toBe('Paid with the 15 Nov payment');
    expect(paidHowText(line(), covered({ by: { ...payment, spending: true } }))).toBe('Paid with the 15 Nov refund');
    expect(paidHowText(line(), covered({ creditCount: 2 }))).toBe('Paid with 2 payments');
    expect(paidHowText(line(), covered({ by: null, creditCount: 0 }))).toBe('Paid with earlier credit');
  });

  it('says paid off, settled for money back, and paid for a plan’s instalment', () => {
    expect(paidHowText(line({ paidOff: true }), none)).toBe('Paid off');
    expect(paidHowText(line({ paidOff: true, owedMinor: -120_000, countedMinor: -120_000 }), none)).toBe('Settled');
    expect(paidHowText(line({ paidOff: true, instalment: { planId: 'plan', number: 1, of: 12, noPurchase: true, paidSoFar: 1 } }), none)).toBe('Paid');
  });

  it('says settled for an annual fee’s money back, and for the fee row added beside one before the app (owner, 22 Nov 2026)', () => {
    expect(paidHowText(line({ feeSettled: true, owedMinor: -800_000, countedMinor: -800_000 }), none)).toBe('Settled');
    expect(paidHowText(line({ feeSettled: true, paidOff: true, countedMinor: 0 }), none)).toBe('Settled');
  });
});
