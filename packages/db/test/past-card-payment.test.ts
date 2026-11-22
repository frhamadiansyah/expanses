import { expenseLines, statementCycleFor, transferLines, transferWithFeeLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activityOf,
  cardStatement,
  categoryIdsByKey,
  categoryTotalsBetween,
  checkLedgerIntegrity,
  createAccount,
  createCardAccount,
  listAccounts,
  listTransactions,
  nativeBalances,
  pastSidesOf,
  payCardPurchases,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  setCountedFrom,
  setPastPurchase,
  setSettledBeforeApp,
  startDayOfTx,
  undoActivity,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * The start day rule for transfers and card payments (owner, 22 Nov 2026): a side dated before its own account's start
 * day keeps its balance, by the past purchase's balancing pair; a card always moves. Invented figures throughout.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/**
 * Card 4417 (statement on the 20th, opened at nothing) with a purchase from 15 Oct already moving it; Bank Contoh added
 * on 20 Nov with its balance then; Dompet Lama counted from January.
 */
async function world() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Kartu Contoh', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Bank Contoh', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 7_350_000, openedOn: '2026-11-20' });
  const old = await createAccount(database, ws, { name: 'Dompet Lama', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 2_640_000, openedOn: '2026-01-05' });
  const shopping = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const purchase = await postTransaction(database, ws, {
    occurredOn: '2026-10-15',
    description: 'Toko Contoh',
    lines: expenseLines({ categoryAccountId: shopping, paymentAccountId: card.id, amountMinor: 2_970_000, currency: 'IDR' }),
  });
  const pay = (fromAccountId: string, occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Credit card payment',
      lines: transferLines({ fromAccountId, toAccountId: card.id, amountMinor, currency: 'IDR' }),
      beforeStart: true,
    });
  const balance = async (id: string, asOf?: string) => (await nativeBalances(database, ws, asOf))[id] ?? 0;
  const pairs = async () => (await listTransactions(database, ws, { includeBalancing: true })).filter((tx) => tx.externalRef?.startsWith('before-app:'));
  return { database, ws, card, bank, old, shopping, purchase, pay, balance, pairs };
}

const OCTOBER = statementCycleFor('2026-10-20', 20); // 21 Sep – 20 Oct

describe('a card payment dated before the bank paying it was added', () => {
  it('leaves the bank as it was on every day, and the card owes less', async () => {
    const w = await world();
    const id = await w.pay(w.bank.id, '2026-11-12', 1_710_000);
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    for (const day of ['2026-11-11', '2026-11-12', '2026-11-19', '2026-11-20']) expect(await w.balance(w.bank.id, day)).toBe(day < '2026-11-20' ? 0 : 7_350_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 + 1_710_000);
    expect(await w.balance(w.card.id, '2026-11-11')).toBe(-2_970_000);
    const view = (await listTransactions(w.database, w.ws, {})).find((tx) => tx.id === id)!;
    expect(view.past).toBe(true);
    expect(view.pastAccountIds).toEqual([w.bank.id]);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('is the past purchase pair: Before the app against the bank, kept out of every list and the activity page', async () => {
    const w = await world();
    const id = await w.pay(w.bank.id, '2026-11-12', 1_710_000);
    const [pair, ...more] = await w.pairs();
    expect(more).toEqual([]);
    expect(pair!.externalRef).toBe(`before-app:${id}`);
    expect(pair!.occurredOn).toBe('2026-11-12');
    expect(pair!.entries.map((e) => [e.accountSystemKey ?? e.accountId, e.amountMinor]).sort()).toEqual([
      [w.bank.id, 1_710_000],
      ['before_the_app', -1_710_000],
    ].sort());
    expect((await listTransactions(w.database, w.ws, {})).some((tx) => tx.externalRef?.startsWith('before-app:'))).toBe(false);
    expect((await listTransactions(w.database, w.ws, { accountId: w.bank.id })).map((tx) => tx.id)).not.toContain(pair!.id);
    expect((await activityOf(w.database, w.ws, {})).some((line) => line.transactionId === pair!.id)).toBe(false);
  });

  it('moves both as usual dated on or after the bank was added', async () => {
    const w = await world();
    await w.pay(w.bank.id, '2026-11-20', 500_000);
    await w.pay(w.bank.id, '2026-11-21', 300_000);
    expect(await w.balance(w.bank.id)).toBe(7_350_000 - 800_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 + 800_000);
    expect(await w.pairs()).toEqual([]);
  });

  it('moves both as usual from an account added long before', async () => {
    const w = await world();
    await w.pay(w.old.id, '2026-11-12', 1_710_000);
    expect(await w.balance(w.old.id)).toBe(2_640_000 - 1_710_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 + 1_710_000);
    expect(await w.pairs()).toEqual([]);
  });

  it('is left alone by a door that does not follow the rule (no beforeStart)', async () => {
    const w = await world();
    await postTransaction(w.database, w.ws, { occurredOn: '2026-11-12', description: 'Credit card payment', lines: transferLines({ fromAccountId: w.bank.id, toAccountId: w.card.id, amountMinor: 1_710_000, currency: 'IDR' }) });
    expect(await w.balance(w.bank.id)).toBe(7_350_000 - 1_710_000);
    expect(await w.pairs()).toEqual([]);
  });

  it('covers the purchase on its statement as any payment does', async () => {
    const w = await world();
    await w.pay(w.bank.id, '2026-11-12', 1_710_000);
    const october = await cardStatement(w.database, w.ws, w.card.id, OCTOBER, '2026-11-22');
    expect(october.closingMinor).toBe(2_970_000);
    expect(october.paidSinceMinor).toBe(1_710_000);
    expect(october.leftToPayMinor).toBe(1_260_000);
    expect(october.cover[w.purchase]?.coveredMinor).toBe(1_710_000);
  });

  it('the statement’s Pay for chosen purchases follows the same rule', async () => {
    const w = await world();
    await payCardPurchases(w.database, w.ws, { cardAccountId: w.card.id, fromAccountId: w.bank.id, occurredOn: '2026-11-12', purchaseTransactionIds: [w.purchase], today: '2026-11-22' });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.card.id)).toBe(0);
    const october = await cardStatement(w.database, w.ws, w.card.id, OCTOBER, '2026-11-22');
    expect(october.lines.find((line) => line.transactionId === w.purchase)?.paidBy).not.toBeNull();
    expect(october.leftToPayMinor).toBe(0);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });
});

describe('the owner’s case (card added 13 Nov, purchase 15 Oct, paid 12 Nov from a bank added after)', () => {
  it('ends with the card owing the rest, the bank unchanged, net worth right and November spending as it was', async () => {
    current = await setupDb();
    const { database, ws } = current;
    // The card was added on 13 Nov at nothing: its balance counted from then, the October purchase recorded on it.
    const card = await createCardAccount(database, ws, { name: 'Kartu 4417', subtype: 'credit_card', currency: 'IDR' });
    await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
    await setCountedFrom(database, ws, card.id, '2026-11-13', '2026-11-22');
    const keys = await categoryIdsByKey(database, ws);
    const clothes = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await postTransaction(database, ws, {
      occurredOn: '2026-10-15',
      description: 'Toko Contoh',
      lines: expenseLines({ categoryAccountId: clothes, paymentAccountId: card.id, amountMinor: 3_140_000, currency: 'IDR' }),
    });
    const bank = await createAccount(database, ws, { name: 'Bank Contoh', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 4_820_000, openedOn: '2026-11-18' });
    // A November coffee, so November has spending of its own to stay the same.
    await postTransaction(database, ws, {
      occurredOn: '2026-11-19',
      description: 'Kopi',
      lines: expenseLines({ categoryAccountId: keys['food_beverage.takeaways']!, paymentAccountId: bank.id, amountMinor: 38_000, currency: 'IDR' }),
    });
    const novemberBefore = await categoryTotalsBetween(database, ws, 'expense', '2026-11-01', '2026-11-30');
    const worthBefore = await nativeBalances(database, ws);
    await postTransaction(database, ws, {
      occurredOn: '2026-11-12',
      description: 'Credit card payment',
      lines: transferLines({ fromAccountId: bank.id, toAccountId: card.id, amountMinor: 1_890_000, currency: 'IDR' }),
      beforeStart: true,
    });
    const after = await nativeBalances(database, ws);
    expect(after[card.id]).toBe(-(3_140_000 - 1_890_000));
    expect(after[bank.id]).toBe(4_820_000 - 38_000);
    expect(after[bank.id]).toBe(worthBefore[bank.id]);
    expect(await categoryTotalsBetween(database, ws, 'expense', '2026-11-01', '2026-11-30')).toEqual(novemberBefore);
    // Net worth (the money and the card) rises by exactly what the card owes less.
    const worth = (b: Record<string, number>) => (b[bank.id] ?? 0) + (b[card.id] ?? 0);
    expect(worth(after) - worth(worthBefore)).toBe(1_890_000);
    const october = await cardStatement(database, ws, card.id, OCTOBER, '2026-11-22');
    expect(october.leftToPayMinor).toBe(3_140_000 - 1_890_000);
    expect(await checkLedgerIntegrity(database, ws)).toEqual([]);
  });
});

describe('a transfer between own accounts', () => {
  it('keeps a From added after the date, and moves a To added before', async () => {
    const w = await world();
    await postTransaction(w.database, w.ws, { occurredOn: '2026-11-10', description: 'Move', lines: transferLines({ fromAccountId: w.bank.id, toAccountId: w.old.id, amountMinor: 400_000, currency: 'IDR' }), beforeStart: true });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.old.id)).toBe(2_640_000 + 400_000);
  });

  it('keeps a To added after the date, and moves a From added before: each side follows its own start day', async () => {
    const w = await world();
    const id = await postTransaction(w.database, w.ws, { occurredOn: '2026-11-10', description: 'Move', lines: transferLines({ fromAccountId: w.old.id, toAccountId: w.bank.id, amountMinor: 400_000, currency: 'IDR' }), beforeStart: true });
    expect(await w.balance(w.old.id)).toBe(2_640_000 - 400_000);
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect((await listTransactions(w.database, w.ws, {})).find((tx) => tx.id === id)!.pastAccountIds).toEqual([w.bank.id]);
  });

  it('keeps both when both were added after the date', async () => {
    const w = await world();
    const wallet = await createAccount(w.database, w.ws, { name: 'Dompet Baru', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 125_000, openedOn: '2026-11-21' });
    const id = await postTransaction(w.database, w.ws, { occurredOn: '2026-11-10', description: 'Move', lines: transferLines({ fromAccountId: w.bank.id, toAccountId: wallet.id, amountMinor: 60_000, currency: 'IDR' }), beforeStart: true });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(wallet.id)).toBe(125_000);
    const view = (await listTransactions(w.database, w.ws, {})).find((tx) => tx.id === id)!;
    expect(view.past).toBe(true);
    expect([...view.pastAccountIds!].sort()).toEqual([w.bank.id, wallet.id].sort());
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('keeps the From whole with its fee, while the fee still counts as spending on its day', async () => {
    const w = await world();
    const keys = await categoryIdsByKey(w.database, w.ws);
    const fees = keys['miscellaneous.fees_charges']!;
    await postTransaction(w.database, w.ws, {
      occurredOn: '2026-11-10',
      description: 'Move',
      lines: transferWithFeeLines({ fromAccountId: w.bank.id, toAccountId: w.old.id, amountMinor: 400_000, feeMinor: 6_500, currency: 'IDR', feeCategoryId: fees }),
      beforeStart: true,
    });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.old.id)).toBe(2_640_000 + 400_000);
    const totals = await categoryTotalsBetween(w.database, w.ws, 'expense', '2026-11-01', '2026-11-30');
    expect(totals.find((row) => row.accountId === fees)?.amountBaseMinor).toBe(6_500);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('never balances money that leaves a card (a top-up), and a payment takes neither purchase mark', async () => {
    const w = await world();
    await postTransaction(w.database, w.ws, { occurredOn: '2026-11-10', description: 'Isi saldo', lines: transferLines({ fromAccountId: w.card.id, toAccountId: w.bank.id, amountMinor: 90_000, currency: 'IDR' }), beforeStart: true });
    expect(await w.balance(w.bank.id)).toBe(7_350_000 + 90_000);
    expect(await w.pairs()).toEqual([]);
    const id = await w.pay(w.old.id, '2026-11-12', 1_710_000);
    await expect(setPastPurchase(w.database, w.ws, id, true)).rejects.toThrow(/expense or income/);
    await expect(setSettledBeforeApp(w.database, w.ws, id, true)).rejects.toThrow(/credit card purchase/);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 - 90_000 + 1_710_000);
    expect(await w.pairs()).toEqual([]);
  });
});

describe('edits, deletes and undo', () => {
  it('decides again when the date crosses the start day, either way', async () => {
    const w = await world();
    const lines = transferLines({ fromAccountId: w.bank.id, toAccountId: w.card.id, amountMinor: 1_710_000, currency: 'IDR' });
    const id = await w.pay(w.bank.id, '2026-11-12', 1_710_000);
    const later = await replaceTransaction(w.database, w.ws, id, { occurredOn: '2026-11-21', description: 'Credit card payment', lines, beforeStart: true });
    expect(await w.balance(w.bank.id)).toBe(7_350_000 - 1_710_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 + 1_710_000);
    expect(await w.pairs()).toEqual([]);
    const earlier = await replaceTransaction(w.database, w.ws, later, { occurredOn: '2026-11-12', description: 'Credit card payment', lines, beforeStart: true });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 + 1_710_000);
    expect((await w.pairs()).map((pair) => pair.externalRef)).toEqual([`before-app:${earlier}`]);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('decides again when the From changes, and follows an edit that says nothing of it', async () => {
    const w = await world();
    const id = await w.pay(w.bank.id, '2026-11-12', 1_710_000);
    const fromOld = await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-11-12',
      description: 'Credit card payment',
      lines: transferLines({ fromAccountId: w.old.id, toAccountId: w.card.id, amountMinor: 1_710_000, currency: 'IDR' }),
      beforeStart: true,
    });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.old.id)).toBe(2_640_000 - 1_710_000);
    expect(await w.pairs()).toEqual([]);
    const back = await replaceTransaction(w.database, w.ws, fromOld, {
      occurredOn: '2026-11-12',
      description: 'Credit card payment',
      lines: transferLines({ fromAccountId: w.bank.id, toAccountId: w.card.id, amountMinor: 1_710_000, currency: 'IDR' }),
      beforeStart: true,
    });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    // Silent on the rule (a note, a new amount): the pair follows, at the new amount.
    const silent = await replaceTransaction(w.database, w.ws, back, {
      occurredOn: '2026-11-12',
      description: 'Bayar kartu',
      lines: transferLines({ fromAccountId: w.bank.id, toAccountId: w.card.id, amountMinor: 1_500_000, currency: 'IDR' }),
    });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 + 1_500_000);
    expect((await w.pairs()).map((pair) => pair.externalRef)).toEqual([`before-app:${silent}`]);
    // Asked to, it takes the pair away.
    await replaceTransaction(w.database, w.ws, silent, {
      occurredOn: '2026-11-12',
      description: 'Bayar kartu',
      lines: transferLines({ fromAccountId: w.bank.id, toAccountId: w.card.id, amountMinor: 1_500_000, currency: 'IDR' }),
      beforeStart: false,
    });
    expect(await w.balance(w.bank.id)).toBe(7_350_000 - 1_500_000);
    expect(await w.pairs()).toEqual([]);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('a delete takes the pair with it, and undo puts both back', async () => {
    const w = await world();
    const id = await w.pay(w.bank.id, '2026-11-12', 1_710_000);
    await voidTransaction(w.database, w.ws, id);
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000);
    expect(await w.pairs()).toEqual([]);
    const line = (await activityOf(w.database, w.ws, {})).find((l) => l.kind === 'delete')!;
    await undoActivity(w.database, w.ws, line.id);
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    expect(await w.balance(w.card.id)).toBe(-2_970_000 + 1_710_000);
    expect(await w.pairs()).toHaveLength(1);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('undo of an edit that moved the date across the start day puts the bank back as it was', async () => {
    const w = await world();
    const lines = transferLines({ fromAccountId: w.bank.id, toAccountId: w.card.id, amountMinor: 1_710_000, currency: 'IDR' });
    const id = await w.pay(w.bank.id, '2026-11-21', 1_710_000);
    await replaceTransaction(w.database, w.ws, id, { occurredOn: '2026-11-12', description: 'Credit card payment', lines, beforeStart: true });
    expect(await w.balance(w.bank.id)).toBe(7_350_000);
    const line = (await activityOf(w.database, w.ws, {})).find((l) => l.kind === 'edit')!;
    await undoActivity(w.database, w.ws, line.id);
    expect(await w.balance(w.bank.id)).toBe(7_350_000 - 1_710_000);
    expect(await w.pairs()).toEqual([]);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });
});

describe('the start day', () => {
  it('is the opening entry’s day, else the As of day, else the day it was added; only money accounts keep their balance', async () => {
    const w = await world();
    const day = (id: string) => startDayOfTx(w.database.db, w.ws, id);
    expect(await day(w.bank.id)).toBe('2026-11-20');
    const counted = await createAccount(w.database, w.ws, { name: 'Tunai', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await setCountedFrom(w.database, w.ws, counted.id, '2026-11-02', '2026-11-22');
    expect(await day(counted.id)).toBe('2026-11-02');
    expect(await pastSidesOf(w.database, w.ws, [w.bank.id, w.card.id, counted.id, w.old.id], '2026-11-01')).toEqual([w.bank.id, counted.id]);
    expect(await pastSidesOf(w.database, w.ws, [w.bank.id, counted.id], '2026-11-20')).toEqual([]);
  });

  it('an As of day can still not move past a transfer that moved the account', async () => {
    const w = await world();
    const cash = await createAccount(w.database, w.ws, { name: 'Tunai', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await setCountedFrom(w.database, w.ws, cash.id, '2026-11-01', '2026-11-22');
    // From the bank (kept, added later) into the cash (moved): the cash's own money moved on 10 Nov.
    await postTransaction(w.database, w.ws, { occurredOn: '2026-11-10', description: 'Tarik', lines: transferLines({ fromAccountId: w.bank.id, toAccountId: cash.id, amountMinor: 200_000, currency: 'IDR' }), beforeStart: true });
    expect(await w.balance(cash.id)).toBe(200_000);
    await expect(setCountedFrom(w.database, w.ws, cash.id, '2026-11-15', '2026-11-22')).rejects.toThrow();
  });
});
