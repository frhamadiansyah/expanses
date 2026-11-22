import { describe, expect, it } from 'vitest';
import {
  activityOf,
  categoryIdsByKey,
  categoryTotalsBetween,
  checkLedgerIntegrity,
  createAccount,
  changeOpeningDate,
  isPastDefault,
  listTransactions,
  nativeBalances,
  openingsOf,
  pastPurchaseOf,
  postTransaction,
  postTransactions,
  replaceTransaction,
  setPastPurchase,
  undoActivity,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

async function world() {
  const { database, ws } = await setupDb();
  const gopay = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 1_480_000, openedOn: '2026-10-28' });
  const usd = await createAccount(database, ws, { name: 'Dollar wallet', kind: 'asset', subtype: 'cash', currency: 'USD', openingBalanceMinor: 50_000, openedOn: '2026-10-01', openingRateToBase: 16_000 });
  const bank = await createAccount(database, ws, { name: 'Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' });
  const keys = await categoryIdsByKey(database, ws);
  const food = keys['food_beverage.takeaways']!;
  const salaryAccount = await createAccount(database, ws, { name: 'Gig', kind: 'income', subtype: 'category', currency: null });
  const spend = (accountId: string, amount: number, occurredOn: string, past?: boolean, currency = 'IDR', extra = {}) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Noodle Stall',
      lines: [
        { accountId: food, amountMinor: amount, currency },
        { accountId, amountMinor: -amount, currency },
      ],
      ...(currency !== 'IDR' ? { ratesToBase: { [currency]: 16_000 } } : {}),
      ...(past === undefined ? {} : { pastPurchase: past }),
      ...extra,
    });
  const earn = (accountId: string, amount: number, occurredOn: string, past?: boolean) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Old gig',
      lines: [
        { accountId, amountMinor: amount, currency: 'IDR' },
        { accountId: salaryAccount.id, amountMinor: -amount, currency: 'IDR' },
      ],
      ...(past === undefined ? {} : { pastPurchase: past }),
    });
  const balance = async (id: string, asOf?: string) => (await nativeBalances(database, ws, asOf))[id] ?? 0;
  return { database, ws, gopay, usd, bank, food, salaryAccount, spend, earn, balance };
}

describe('isPastDefault', () => {
  it('is past strictly before the opening day, never on or after, and never without one', () => {
    expect(isPastDefault('2026-10-28', '2026-09-19')).toBe(true);
    expect(isPastDefault('2026-10-28', '2026-10-27')).toBe(true);
    expect(isPastDefault('2026-10-28', '2026-10-28')).toBe(false);
    expect(isPastDefault('2026-10-28', '2026-11-01')).toBe(false);
    expect(isPastDefault(null, '2026-01-01')).toBe(false);
    expect(isPastDefault(undefined, '2026-01-01')).toBe(false);
  });
});

describe('a past purchase on a money account', () => {
  it('leaves the balance as it was, today and on every day, while the expense still counts', async () => {
    const w = await world();
    const before = await w.balance(w.gopay.id);
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19', true);
    expect(await w.balance(w.gopay.id)).toBe(before);
    expect(await w.balance(w.gopay.id, '2026-09-19')).toBe(0);
    expect(await w.balance(w.gopay.id, '2026-10-28')).toBe(before);
    expect(await pastPurchaseOf(w.database, w.ws, id)).toBe(true);
    const totals = await categoryTotalsBetween(w.database, w.ws, 'expense', '2026-09-01', '2026-09-30');
    expect(totals.find((row) => row.accountId === w.food)).toMatchObject({ amountBaseMinor: 41_000, transactions: 1 });
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('is the same for an old income', async () => {
    const w = await world();
    const before = await w.balance(w.gopay.id);
    const id = await w.earn(w.gopay.id, 300_000, '2026-08-01', true);
    expect(await w.balance(w.gopay.id)).toBe(before);
    expect(await pastPurchaseOf(w.database, w.ws, id)).toBe(true);
    const totals = await categoryTotalsBetween(w.database, w.ws, 'income', '2026-08-01', '2026-08-31');
    expect(totals.find((row) => row.accountId === w.salaryAccount.id)?.amountBaseMinor).toBe(300_000);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('moves the balance as usual when not marked, or marked false', async () => {
    const w = await world();
    await w.spend(w.gopay.id, 41_000, '2026-09-19');
    await w.spend(w.gopay.id, 9_000, '2026-09-20', false);
    expect(await w.balance(w.gopay.id)).toBe(1_480_000 - 50_000);
    expect((await listTransactions(w.database, w.ws, {})).every((tx) => !tx.past)).toBe(true);
  });

  it('keeps the balancing pair out of the list a person reads, the activity page and its undo', async () => {
    const w = await world();
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19', true);
    expect((await listTransactions(w.database, w.ws, {})).filter((tx) => !tx.description.startsWith('Opening')).map((tx) => tx.description)).toEqual(['Noodle Stall']);
    expect((await listTransactions(w.database, w.ws, {})).find((tx) => tx.id === id)!.past).toBe(true);
    const all = await listTransactions(w.database, w.ws, { includeBalancing: true });
    const balancing = all.filter((tx) => tx.externalRef === `before-app:${id}`);
    expect(balancing).toHaveLength(1);
    expect(balancing[0]!.entries.some((e) => e.accountSystemKey === 'before_the_app')).toBe(true);
    const lines = await activityOf(w.database, w.ws, {});
    expect(lines.some((line) => line.title.startsWith('Paid off'))).toBe(false);
    expect(lines.filter((line) => line.transactionId === balancing[0]!.id)).toHaveLength(0);
    // The balancing is equity: no category total and no spending report counts it.
    const expense = await categoryTotalsBetween(w.database, w.ws, 'expense', '2026-01-01', '2026-12-31');
    expect(expense.reduce((sum, row) => sum + row.amountBaseMinor, 0)).toBe(41_000);
    const income = await categoryTotalsBetween(w.database, w.ws, 'income', '2026-01-01', '2026-12-31');
    expect(income).toEqual([]);
  });

  it('is removed with the purchase when deleted, and undo puts the purchase and its mark back', async () => {
    const w = await world();
    const before = await w.balance(w.gopay.id);
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19', true);
    await voidTransaction(w.database, w.ws, id);
    expect(await w.balance(w.gopay.id)).toBe(before);
    expect((await listTransactions(w.database, w.ws, { includeBalancing: true })).filter((tx) => tx.externalRef?.startsWith('before-app:'))).toHaveLength(0);
    const line = (await activityOf(w.database, w.ws, {})).find((l) => l.kind === 'delete')!;
    await undoActivity(w.database, w.ws, line.id);
    expect(await w.balance(w.gopay.id)).toBe(before);
    const back = (await listTransactions(w.database, w.ws, {})).find((tx) => tx.description === 'Noodle Stall')!;
    expect(await pastPurchaseOf(w.database, w.ws, back.id)).toBe(true);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('follows an edit of the amount, the day and the account', async () => {
    const w = await world();
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19', true);
    const edited = await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-09-20',
      description: 'Noodle Stall',
      lines: [
        { accountId: w.food, amountMinor: 55_000, currency: 'IDR' },
        { accountId: w.bank.id, amountMinor: -55_000, currency: 'IDR' },
      ],
    });
    expect(await w.balance(w.gopay.id)).toBe(1_480_000);
    expect(await w.balance(w.bank.id)).toBe(5_000_000);
    expect(await pastPurchaseOf(w.database, w.ws, edited)).toBe(true);
    const settlement = (await listTransactions(w.database, w.ws, { includeBalancing: true })).find((tx) => tx.externalRef === `before-app:${edited}`)!;
    expect(settlement.occurredOn).toBe('2026-09-20');
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('moves the balance by the amount exactly once when an edit unticks and ticks the mark', async () => {
    const w = await world();
    const lines = (amount: number) => [
      { accountId: w.food, amountMinor: amount, currency: 'IDR' },
      { accountId: w.gopay.id, amountMinor: -amount, currency: 'IDR' },
    ];
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19', true);
    const counted = await replaceTransaction(w.database, w.ws, id, { occurredOn: '2026-09-19', description: 'Noodle Stall', lines: lines(41_000), pastPurchase: false });
    expect(await w.balance(w.gopay.id)).toBe(1_480_000 - 41_000);
    expect(await pastPurchaseOf(w.database, w.ws, counted)).toBe(false);
    const again = await replaceTransaction(w.database, w.ws, counted, { occurredOn: '2026-09-19', description: 'Noodle Stall', lines: lines(41_000), pastPurchase: true });
    expect(await w.balance(w.gopay.id)).toBe(1_480_000);
    // An edit that does not mention the mark leaves it as it was.
    const kept = await replaceTransaction(w.database, w.ws, again, { occurredOn: '2026-09-19', description: 'Noodle Stall', lines: lines(42_000) });
    expect(await w.balance(w.gopay.id)).toBe(1_480_000);
    expect(await pastPurchaseOf(w.database, w.ws, kept)).toBe(true);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('is marked or taken back on a saved purchase, once however often asked', async () => {
    const w = await world();
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19');
    await setPastPurchase(w.database, w.ws, id, true);
    await setPastPurchase(w.database, w.ws, id, true);
    expect(await w.balance(w.gopay.id)).toBe(1_480_000);
    await setPastPurchase(w.database, w.ws, id, false);
    await setPastPurchase(w.database, w.ws, id, false);
    expect(await w.balance(w.gopay.id)).toBe(1_480_000 - 41_000);
  });

  it('is on a foreign-currency account in that currency, whose balance stays', async () => {
    const w = await world();
    const id = await w.spend(w.usd.id, 1_200, '2026-09-19', true, 'USD');
    expect(await w.balance(w.usd.id)).toBe(50_000);
    const settlement = (await listTransactions(w.database, w.ws, { includeBalancing: true })).find((tx) => tx.externalRef === `before-app:${id}`)!;
    expect(settlement.entries.every((e) => e.currency === 'USD')).toBe(true);
    expect(settlement.entries.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(0);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
    const totals = await categoryTotalsBetween(w.database, w.ws, 'expense', '2026-09-01', '2026-09-30');
    expect(totals.find((row) => row.accountId === w.food)?.amountBaseMinor).toBe(1_200 * 160);
  });

  it('ignores the mark on a transfer, and refuses to set it on one', async () => {
    const w = await world();
    const id = await postTransaction(w.database, w.ws, {
      occurredOn: '2026-09-19',
      description: 'Top up',
      lines: [
        { accountId: w.gopay.id, amountMinor: 100_000, currency: 'IDR' },
        { accountId: w.bank.id, amountMinor: -100_000, currency: 'IDR' },
      ],
      pastPurchase: true,
    });
    expect(await w.balance(w.gopay.id)).toBe(1_580_000);
    expect(await w.balance(w.bank.id)).toBe(4_900_000);
    expect(await pastPurchaseOf(w.database, w.ws, id)).toBe(false);
    await expect(setPastPurchase(w.database, w.ws, id, true)).rejects.toThrow(/expense or income on a money account/);
  });

  it('leaves a credit card purchase to its own already-paid-off mark', async () => {
    const w = await world();
    const visa = await createAccount(w.database, w.ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const id = await w.spend(visa.id, 20_000, '2026-03-12', true);
    expect((await nativeBalances(w.database, w.ws))[visa.id] ?? 0).toBe(0);
    const settlement = (await listTransactions(w.database, w.ws, {})).find((tx) => tx.externalRef === `before-app:${id}`)!;
    expect(settlement.entries.some((e) => e.accountSystemKey === 'opening_balance')).toBe(true);
  });

  it('never becomes the account opening entry, even dated before it', async () => {
    const w = await world();
    await w.spend(w.gopay.id, 41_000, '2026-01-02', true);
    const opening = (await openingsOf(w.database, w.ws, [w.gopay.id]))[w.gopay.id]!;
    expect(opening.occurredOn).toBe('2026-10-28');
    expect(opening.amountMinor).toBe(1_480_000);
  });

  it('is posted per row by postTransactions', async () => {
    const w = await world();
    const line = (amount: number, occurredOn: string, past: boolean) => ({
      occurredOn,
      description: 'Row',
      lines: [
        { accountId: w.food, amountMinor: amount, currency: 'IDR' },
        { accountId: w.gopay.id, amountMinor: -amount, currency: 'IDR' },
      ],
      pastPurchase: past,
    });
    await postTransactions(w.database, w.ws, [line(10_000, '2026-09-01', true), line(20_000, '2026-10-29', false), line(5_000, '2026-09-02', true)]);
    expect(await w.balance(w.gopay.id)).toBe(1_480_000 - 20_000);
    expect(await w.balance(w.gopay.id, '2026-09-30')).toBe(0);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('undoes an edit that ticked the mark, taking it off again', async () => {
    const w = await world();
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19');
    await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-09-19',
      description: 'Noodle Stall',
      lines: [
        { accountId: w.food, amountMinor: 41_000, currency: 'IDR' },
        { accountId: w.gopay.id, amountMinor: -41_000, currency: 'IDR' },
      ],
      pastPurchase: true,
    });
    expect(await w.balance(w.gopay.id)).toBe(1_480_000);
    const line = (await activityOf(w.database, w.ws, {})).find((l) => l.kind === 'edit')!;
    await undoActivity(w.database, w.ws, line.id);
    expect(await w.balance(w.gopay.id)).toBe(1_480_000 - 41_000);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('moving the account day later or earlier rewrites nothing already recorded', async () => {
    const w = await world();
    const id = await w.spend(w.gopay.id, 41_000, '2026-09-19', true);
    const counted = await w.spend(w.gopay.id, 9_000, '2026-10-30');
    await changeOpeningDate(w.database, w.ws, w.gopay.id, '2026-09-01', '2026-10-31');
    expect((await openingsOf(w.database, w.ws, [w.gopay.id]))[w.gopay.id]!.occurredOn).toBe('2026-09-01');
    expect(await pastPurchaseOf(w.database, w.ws, id)).toBe(true);
    expect(await pastPurchaseOf(w.database, w.ws, counted)).toBe(false);
    expect(await w.balance(w.gopay.id)).toBe(1_480_000 - 9_000);
    await expect(changeOpeningDate(w.database, w.ws, w.gopay.id, '2026-12-01', '2026-10-31')).rejects.toThrow(/after today/);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('As of may move earlier, or later up to the first counted transaction, never past it; a past purchase never holds it back', async () => {
    const w = await world();
    // Opened 2026-10-28; a past purchase before it, and a counted one on 30 Oct.
    await w.spend(w.gopay.id, 41_000, '2026-09-19', true);
    await w.spend(w.gopay.id, 9_000, '2026-10-30');
    await changeOpeningDate(w.database, w.ws, w.gopay.id, '2026-10-30', '2026-10-31');
    expect((await openingsOf(w.database, w.ws, [w.gopay.id]))[w.gopay.id]!.occurredOn).toBe('2026-10-30');
    await expect(changeOpeningDate(w.database, w.ws, w.gopay.id, '2026-10-31', '2026-10-31')).rejects.toThrow('Transactions from 2026-10-30 come before it');
    expect((await openingsOf(w.database, w.ws, [w.gopay.id]))[w.gopay.id]!.occurredOn).toBe('2026-10-30');
    await changeOpeningDate(w.database, w.ws, w.gopay.id, '2026-08-01', '2026-10-31');
    expect(await w.balance(w.gopay.id)).toBe(1_480_000 - 9_000);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });
});
