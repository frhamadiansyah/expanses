import { expenseLines, splitExpenseLines, transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  checkLedgerIntegrity,
  createAccount,
  listAccounts,
  listTransactions,
  nativeBalances,
  postTransaction,
  replaceTransaction,
  setTransactionMcc,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

async function cardSetup() {
  const t = await setupDb();
  const { database, ws } = t;
  const checking = await createAccount(database, ws, { name: 'BCA Checking', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-09-01' });
  const visa = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const groceries = all.find((a) => a.name === 'Groceries')!;
  const household = all.find((a) => a.name === 'Household')!;
  return { ...t, checking, visa, groceries, household };
}

describe('ledger', () => {
  it('counts a card purchase once and the statement payment as a transfer', async () => {
    const { database, ws, checking, visa, groceries } = await cardSetup();
    await postTransaction(database, ws, {
      occurredOn: '2026-09-11',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 500_000, currency: 'IDR' }),
    });
    let balances = await nativeBalances(database, ws);
    expect(balances[groceries.id]).toBe(500_000);
    expect(balances[visa.id]).toBe(-500_000);

    await postTransaction(database, ws, {
      occurredOn: '2026-09-25',
      description: 'Pay BCA Visa',
      lines: transferLines({ fromAccountId: checking.id, toAccountId: visa.id, amountMinor: 500_000, currency: 'IDR' }),
    });
    balances = await nativeBalances(database, ws);
    expect(balances[groceries.id]).toBe(500_000);
    expect(balances[visa.id]).toBe(0);
    expect(balances[checking.id]).toBe(19_500_000);
    expect(await checkLedgerIntegrity(database, ws)).toEqual([]);
  });

  it('applies balances as of a date', async () => {
    const { database, ws, visa, groceries } = await cardSetup();
    await postTransaction(database, ws, {
      occurredOn: '2026-10-02',
      description: 'Later',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 1000, currency: 'IDR' }),
    });
    expect((await nativeBalances(database, ws, '2026-09-30'))[groceries.id]).toBeUndefined();
    expect((await nativeBalances(database, ws, '2026-10-02'))[groceries.id]).toBe(1000);
  });

  it('voids and replaces without mutating entries', async () => {
    const { database, ws, visa, groceries, household } = await cardSetup();
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-11',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 500_000, currency: 'IDR' }),
    });
    const replacement = await replaceTransaction(database, ws, id, {
      occurredOn: '2026-09-11',
      description: 'Superindo (split)',
      lines: splitExpenseLines({
        paymentAccountId: visa.id,
        currency: 'IDR',
        splits: [
          { categoryAccountId: groceries.id, amountMinor: 350_000 },
          { categoryAccountId: household.id, amountMinor: 150_000 },
        ],
      }),
    });
    const balances = await nativeBalances(database, ws);
    expect(balances[groceries.id]).toBe(350_000);
    expect(balances[household.id]).toBe(150_000);
    expect(balances[visa.id]).toBe(-500_000);

    const visible = await listTransactions(database, ws, { accountId: visa.id });
    expect(visible.map((t) => t.id)).toEqual([replacement]);
    const withVoid = await listTransactions(database, ws, { accountId: visa.id, includeVoid: true });
    expect(withVoid.find((t) => t.id === id)?.status).toBe('void');
    expect(withVoid.find((t) => t.id === id)?.entries).toHaveLength(2);

    await expect(voidTransaction(database, ws, id)).rejects.toMatchObject({ code: 'ALREADY_VOID' });
  });

  it('writes nothing when posting fails', async () => {
    const { database, ws, visa, groceries } = await cardSetup();
    await expect(
      postTransaction(database, ws, {
        occurredOn: '2026-09-11',
        description: 'bad',
        lines: [
          { accountId: groceries.id, amountMinor: 10, currency: 'IDR' },
          { accountId: visa.id, amountMinor: -9, currency: 'IDR' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNBALANCED' });
    await expect(
      postTransaction(database, ws, {
        occurredOn: '11/09/2026',
        description: 'bad date',
        lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 1, currency: 'IDR' }),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DATE' });
    expect((await listTransactions(database, ws, { accountId: visa.id, includeVoid: true }))).toEqual([]);
  });

  it('rejects accounts from another workspace', async () => {
    const a = await cardSetup();
    const b = await setupDb();
    await expect(
      postTransaction(b.database, b.ws, {
        occurredOn: '2026-09-11',
        description: 'cross',
        lines: expenseLines({ categoryAccountId: a.groceries.id, paymentAccountId: a.visa.id, amountMinor: 1, currency: 'IDR' }),
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNT' });
  });

  it('stores foreign entries with base amounts', async () => {
    const { database, ws, groceries } = await cardSetup();
    const baht = await createAccount(database, ws, { name: 'Baht cash', kind: 'asset', subtype: 'cash', currency: 'THB' });
    await postTransaction(database, ws, {
      occurredOn: '2026-01-14',
      description: '7-Eleven Bangkok',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: baht.id, amountMinor: 45_000, currency: 'THB' }),
      ratesToBase: { THB: 536.49 },
    });
    const [tx] = await listTransactions(database, ws, { accountId: baht.id });
    expect(tx!.entries.find((e) => e.accountId === groceries.id)).toMatchObject({ amountMinor: 45_000, currency: 'THB', amountBaseMinor: 241_421 });
  });
});

describe('review fixes: replace keeps import identity', () => {
  it('keeps source and external_ref when a transaction is replaced', async () => {
    const t = await setupDb();
    const visa = await createAccount(t.database, t.ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const all = await listAccounts(t.database, t.ws);
    const other = all.find((a) => a.name === 'Other Expense')!;
    const dining = all.find((a) => a.name === 'Dining Out')!;
    const id = await postTransaction(t.database, t.ws, {
      occurredOn: '2026-09-11', description: 'Sushi Tei', source: 'csv', externalRef: 'csv:visa|x|0',
      lines: expenseLines({ categoryAccountId: other.id, paymentAccountId: visa.id, amountMinor: 400_000, currency: 'IDR' }),
    });
    await replaceTransaction(t.database, t.ws, id, {
      occurredOn: '2026-09-11', description: 'Sushi Tei',
      lines: expenseLines({ categoryAccountId: dining.id, paymentAccountId: visa.id, amountMinor: 400_000, currency: 'IDR' }),
    });
    const [tx] = await listTransactions(t.database, t.ws, { accountId: visa.id });
    expect(tx).toMatchObject({ source: 'csv', externalRef: 'csv:visa|x|0', description: 'Sushi Tei' });
  });
});

describe('original currency', () => {
  it('round-trips through post, replace, and list', async () => {
    const { database, ws, visa, groceries } = await cardSetup();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 150_000, currency: 'IDR' });
    const id = await postTransaction(database, ws, { occurredOn: '2026-09-11', description: 'Cold Storage', lines, originalCurrency: 'SGD', originalAmountMinor: 1250 });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, originalCurrency: 'SGD', originalAmountMinor: 1250 });

    const kept = await replaceTransaction(database, ws, id, { occurredOn: '2026-09-11', description: 'Cold Storage Orchard', lines });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id: kept, originalCurrency: 'SGD', originalAmountMinor: 1250 });

    const cleared = await replaceTransaction(database, ws, kept, { occurredOn: '2026-09-11', description: 'Superindo', lines, originalCurrency: null, originalAmountMinor: null });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id: cleared, originalCurrency: null, originalAmountMinor: null });
  });

  it('rejects a currency without an amount, an unknown currency, and a non-positive amount', async () => {
    const { database, ws, visa, groceries } = await cardSetup();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 150_000, currency: 'IDR' });
    const post = (original: { originalCurrency?: string | null; originalAmountMinor?: number | null }) =>
      postTransaction(database, ws, { occurredOn: '2026-09-11', description: 'Cold Storage', lines, ...original });
    await expect(post({ originalCurrency: 'SGD' })).rejects.toMatchObject({ code: 'INVALID_ORIGINAL' });
    await expect(post({ originalCurrency: 'XYZ', originalAmountMinor: 100 })).rejects.toMatchObject({ code: 'INVALID_ORIGINAL' });
    await expect(post({ originalCurrency: 'SGD', originalAmountMinor: 0 })).rejects.toMatchObject({ code: 'INVALID_ORIGINAL' });
    expect((await listTransactions(database, ws)).filter((t) => t.description === 'Cold Storage')).toEqual([]);
  });
});

describe('typed MCC', () => {
  it('round-trips through post, stays on replace, and clears when set to null', async () => {
    const { database, ws, visa, groceries } = await cardSetup();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 150_000, currency: 'IDR' });
    const id = await postTransaction(database, ws, { occurredOn: '2026-09-11', description: 'Superindo', lines, mcc: '5411' });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, mcc: '5411' });
    const kept = await replaceTransaction(database, ws, id, { occurredOn: '2026-09-11', description: 'Superindo Kemang', lines });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id: kept, mcc: '5411' });
    const cleared = await replaceTransaction(database, ws, kept, { occurredOn: '2026-09-11', description: 'Superindo', lines, mcc: null });
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id: cleared, mcc: null });
  });

  it('rejects an MCC that is not four digits', async () => {
    const { database, ws, visa, groceries } = await cardSetup();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 150_000, currency: 'IDR' });
    await expect(postTransaction(database, ws, { occurredOn: '2026-09-11', description: 'Superindo', lines, mcc: '541' })).rejects.toMatchObject({ code: 'INVALID_MCC' });
  });
});

describe('setTransactionMcc', () => {
  it('sets and clears a purchase MCC in place without changing its entries', async () => {
    const { database, ws, visa, groceries } = await cardSetup();
    const lines = expenseLines({ categoryAccountId: groceries.id, paymentAccountId: visa.id, amountMinor: 60_000, currency: 'IDR' });
    const id = await postTransaction(database, ws, { occurredOn: '2026-09-11', description: 'MCDONALD SENAYAN', lines });
    const before = (await listTransactions(database, ws))[0]!;
    await setTransactionMcc(database, ws, id, '5814');
    const after = (await listTransactions(database, ws))[0]!;
    expect(after).toMatchObject({ id, mcc: '5814', status: 'posted' });
    expect(after.entries).toEqual(before.entries);
    await setTransactionMcc(database, ws, id, null);
    expect((await listTransactions(database, ws))[0]).toMatchObject({ id, mcc: null });
    await expect(setTransactionMcc(database, ws, id, '58')).rejects.toMatchObject({ code: 'INVALID_MCC' });
    await expect(setTransactionMcc(database, ws, 'missing', '5814')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
