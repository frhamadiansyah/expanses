import { describe, expect, it } from 'vitest';
import { AccountError, archiveAccount, createAccount, listAccounts, nativeBalances } from '../src/index';
import { setupDb } from './helpers';

describe('workspace seed', () => {
  it('creates system equity accounts and a two-level category tree', async () => {
    const { database, ws } = await setupDb();
    const all = await listAccounts(database, ws);
    expect(all.filter((a) => a.kind === 'equity').map((a) => a.systemKey).sort()).toEqual(['currency_exchange', 'opening_balance']);
    const food = all.find((a) => a.name === 'Food & Drink')!;
    const groceries = all.find((a) => a.name === 'Groceries')!;
    expect(food.kind).toBe('expense');
    expect(groceries.parentId).toBe(food.id);
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
    const food = all.find((a) => a.name === 'Food & Drink')!;
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

describe('review fixes: archiving with a balance', () => {
  it('refuses to archive a money account that still has a balance, but allows categories with history', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Old card', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 2_000_000 });
    await expect(archiveAccount(database, ws, card.id)).rejects.toThrow(AccountError);
    expect((await listAccounts(database, ws)).some((a) => a.id === card.id)).toBe(true);
    const equity = (await listAccounts(database, ws)).find((a) => a.systemKey === 'opening_balance')!;
    expect((await nativeBalances(database, ws))[equity.id]).toBe(2_000_000);
    const other = (await listAccounts(database, ws)).find((a) => a.name === 'Other Expense')!;
    await archiveAccount(database, ws, other.id);
  });
});

describe('category keys on new workspaces', () => {
  it('sets system_key on every default category', async () => {
    const { DEFAULT_CATEGORY_KEYS } = await import('@expanses/core');
    const { database, ws } = await setupDb();
    const categories = (await listAccounts(database, ws)).filter((a) => a.subtype === 'category');
    expect(categories.every((c) => c.systemKey !== null)).toBe(true);
    expect(new Set(categories.map((c) => c.systemKey))).toEqual(new Set(DEFAULT_CATEGORY_KEYS));
    expect(categories.find((c) => c.systemKey === 'utilities.gas')?.name).toBe('Gas');
    expect(categories.find((c) => c.systemKey === 'government')?.name).toBe('Government & Taxes');
  });
});
