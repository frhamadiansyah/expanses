import { expenseLines, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  AccountError,
  archiveAccount,
  assetValuesAt,
  createAccount,
  createWorkspace,
  listAccounts,
  listEarmarks,
  nativeBalances,
  postTransaction,
  saveEarmark,
  saveGoal,
  unarchiveAccountTx,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

describe('workspace seed', () => {
  it('creates system equity accounts and a two-level category tree', async () => {
    const { database, ws } = await setupDb();
    const all = await listAccounts(database, ws);
    expect(all.filter((a) => a.kind === 'equity').map((a) => a.systemKey).sort()).toEqual(['currency_exchange', 'opening_balance']);
    const food = all.find((a) => a.name === 'Food and beverage')!;
    const groceries = all.find((a) => a.name === 'Groceries')!;
    expect(food.kind).toBe('expense');
    expect(groceries.parentId).toBe(all.find((a) => a.name === 'Household')!.id);
    expect(all.find((a) => a.name === 'Salary')?.kind).toBe('income');
  });
});

describe('createAccount', () => {
  it('creates a credit card with an owed opening balance', async () => {
    const { database, ws } = await setupDb();
    const visa = await createAccount(database, ws, {
      name: 'BCA Visa',
      kind: 'liability',
      subtype: 'credit_card',
      currency: 'IDR',
      openingBalanceMinor: 1_200_000,
      openedOn: '2026-09-01',
    });
    const balances = await nativeBalances(database, ws);
    expect(balances[visa.id]).toBe(-1_200_000);
  });

  it('requires a rate for a foreign opening balance', async () => {
    const { database, ws } = await setupDb();
    await expect(
      createAccount(database, ws, { name: 'Baht cash', kind: 'asset', subtype: 'cash', currency: 'THB', openingBalanceMinor: 10000 }),
    ).rejects.toMatchObject({ code: 'MISSING_RATE' });
    expect((await listAccounts(database, ws)).some((a) => a.name === 'Baht cash')).toBe(false);
    await createAccount(database, ws, {
      name: 'Baht cash',
      kind: 'asset',
      subtype: 'cash',
      currency: 'THB',
      openingBalanceMinor: 10000,
      openingRateToBase: 536.49,
    });
  });

  it('validates kind, subtype, currency, and parent', async () => {
    const { database, ws } = await setupDb();
    const all = await listAccounts(database, ws);
    const food = all.find((a) => a.name === 'Food and beverage')!;
    const salary = all.find((a) => a.name === 'Salary')!;
    await expect(createAccount(database, ws, { name: 'X', kind: 'asset', subtype: 'credit_card', currency: 'IDR' })).rejects.toThrow(AccountError);
    await expect(createAccount(database, ws, { name: 'X', kind: 'asset', subtype: 'bank', currency: null })).rejects.toThrow(AccountError);
    await expect(createAccount(database, ws, { name: 'X', kind: 'expense', subtype: 'category', currency: 'IDR' })).rejects.toThrow(AccountError);
    await expect(createAccount(database, ws, { name: 'X', kind: 'expense', subtype: 'category', currency: null, parentId: salary.id })).rejects.toThrow(AccountError);
    const snacks = await createAccount(database, ws, { name: 'Boba', kind: 'expense', subtype: 'category', currency: null, parentId: food.id });
    expect(snacks.parentId).toBe(food.id);
  });

  it('archives user accounts but never system accounts', async () => {
    const { database, ws } = await setupDb();
    const wallet = await createAccount(database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const equity = (await listAccounts(database, ws)).find((a) => a.systemKey === 'opening_balance')!;
    await archiveAccount(database, ws, wallet.id);
    await expect(archiveAccount(database, ws, equity.id)).rejects.toThrow(AccountError);
    const visible = await listAccounts(database, ws);
    expect(visible.some((a) => a.id === wallet.id)).toBe(false);
    expect(visible.some((a) => a.id === equity.id)).toBe(true);
  });
});

describe('unarchiving', () => {
  it('brings an archived account back, audits it, and refuses one from another workspace', async () => {
    const { database, ws } = await setupDb();
    const wallet = await createAccount(database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await archiveAccount(database, ws, wallet.id);
    await database.transaction((tx) => unarchiveAccountTx(tx, ws, wallet.id));
    expect((await listAccounts(database, ws)).some((a) => a.id === wallet.id)).toBe(true);
    expect(await database.db.values(sql`SELECT action FROM audit_log WHERE entity_id = ${wallet.id} AND action LIKE '%archive' ORDER BY rowid`)).toEqual([['archive'], ['unarchive']]);
    await expect(database.transaction((tx) => unarchiveAccountTx(tx, { ...ws, workspaceId: 'elsewhere' }, wallet.id))).rejects.toThrow(AccountError);
  });
});

describe('review fixes: archiving with a balance', () => {
  it('refuses to archive a money account that still has a balance, but allows categories with history', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Old card', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 2_000_000 });
    await expect(archiveAccount(database, ws, card.id)).rejects.toThrow(AccountError);
    expect((await listAccounts(database, ws)).some((a) => a.id === card.id)).toBe(true);
    const equity = (await listAccounts(database, ws)).find((a) => a.systemKey === 'opening_balance')!;
    expect((await nativeBalances(database, ws))[equity.id]).toBe(2_000_000);
    const other = (await listAccounts(database, ws)).find((a) => a.name === 'Miscellaneous')!;
    await archiveAccount(database, ws, other.id);
  });

  it('never archives an account that belongs to another workspace', async () => {
    const { database, ws } = await setupDb();
    const wallet = await createAccount(database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    await expect(archiveAccount(database, other, wallet.id)).rejects.toThrow(AccountError);
    expect((await listAccounts(database, ws)).some((a) => a.id === wallet.id)).toBe(true);
  });

  it('does not count a voided transaction toward the balance a fresh archive checks', async () => {
    const { database, ws } = await setupDb();
    const source = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000 });
    const target = await createAccount(database, ws, { name: 'Temp wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const txId = await postTransaction(database, ws, {
      occurredOn: '2026-09-01',
      description: 'Move some cash over',
      lines: transferLines({ fromAccountId: source.id, toAccountId: target.id, amountMinor: 1_000_000, currency: 'IDR' }),
    });
    await voidTransaction(database, ws, txId);
    // The voided entries are still in the table; only a status filter keeps them out of the balance check.
    await archiveAccount(database, ws, target.id);
    expect((await listAccounts(database, ws)).some((a) => a.id === target.id)).toBe(false);
  });

  it('writes an audit entry for the archive', async () => {
    const { database, ws } = await setupDb();
    const wallet = await createAccount(database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await archiveAccount(database, ws, wallet.id);
    expect(await database.db.values(sql`SELECT action FROM audit_log WHERE entity_id = ${wallet.id} AND entity = 'account' AND action = 'archive'`)).toEqual([
      ['archive'],
    ]);
  });
});

describe('category keys on new workspaces', () => {
  it('sets system_key on every default category', async () => {
    const { DEFAULT_CATEGORY_KEYS } = await import('@expanses/core');
    const { database, ws } = await setupDb();
    const categories = (await listAccounts(database, ws)).filter((a) => a.subtype === 'category');
    expect(categories.every((c) => c.systemKey !== null)).toBe(true);
    expect(new Set(categories.map((c) => c.systemKey))).toEqual(new Set(DEFAULT_CATEGORY_KEYS));
    expect(categories.find((c) => c.systemKey === 'utilities.gas_energy')?.name).toBe('Gas & energy');
    expect(categories.find((c) => c.systemKey === 'government_taxes')?.name).toBe('Government & taxes');
  });
});

describe('fund accounts and digital wallets', () => {
  it('holds money, pays like cash, and counts as cash and equivalents', async () => {
    const { database, ws } = await setupDb();
    const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!;
    const gopay = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 500_000 });
    const rdn = await createAccount(database, ws, { name: 'RDN Mandiri Sekuritas', kind: 'asset', subtype: 'fund', currency: 'IDR', openingBalanceMinor: 8_000_000 });

    await postTransaction(database, ws, {
      occurredOn: '2026-09-18',
      description: 'Warung Tegal',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: gopay.id, amountMinor: 45_000, currency: 'IDR' }),
    });

    const balances = await nativeBalances(database, ws);
    expect(balances[gopay.id]).toBe(455_000);
    expect(balances[rdn.id]).toBe(8_000_000);

    const values = await assetValuesAt(database, ws, '2026-09-30');
    const groupOf = new Map(values.map((row) => [row.accountId, row.planGroup]));
    expect(groupOf.get(gopay.id)).toBe('liquid');
    expect(groupOf.get(rdn.id)).toBe('liquid');
    expect(values.find((row) => row.accountId === rdn.id)?.valueMinor).toBe(8_000_000);
  });

  it('can hold money set aside for a goal', async () => {
    const { database, ws } = await setupDb();
    const rdn = await createAccount(database, ws, { name: 'RDN', kind: 'asset', subtype: 'fund', currency: 'IDR', openingBalanceMinor: 8_000_000 });
    const goalId = await saveGoal(database, ws, {
      name: 'Rumah',
      kind: 'home',
      growthBps: 500,
      returnBps: 600,
      stages: [{ name: 'Uang muka', targetMinor: 100_000_000, targetMonths: null, dueOn: '2030-01-31' }],
    });
    await saveEarmark(database, ws, { goalId, accountId: rdn.id, amountMinor: 3_000_000 });
    expect((await listEarmarks(database, ws)).find((row) => row.accountId === rdn.id)?.amountMinor).toBe(3_000_000);
  });
});
