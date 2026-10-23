import { beforeEach, describe, expect, it } from 'vitest';
import { createAccount, listCardTiers, MIGRATIONS, openCashAccount, setAccountCardTier, type Database, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

/**
 * "Card tier" (0087): which of its bank's debit cards a money account is drawn as in Wallet. Unset for every account
 * until chosen; the tier's own short word; only on an account a debit card spends from.
 */

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('migration 0087', () => {
  it('is version 87 and named account_card_tier', () => {
    expect(MIGRATIONS.find((m) => m.version === 87)).toMatchObject({ name: 'account_card_tier' });
  });
});

describe('card tier', () => {
  it('is unset until chosen, keeps the word chosen, and is cleared with null', async () => {
    const payroll = await openCashAccount(database, ws, { item: 'bank', name: 'Payroll', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-09-01' });
    expect(await listCardTiers(database, ws)).toEqual({});
    await setAccountCardTier(database, ws, payroll.id, 'gold');
    expect(await listCardTiers(database, ws)).toEqual({ [payroll.id]: 'gold' });
    await setAccountCardTier(database, ws, payroll.id, 'prioritas');
    expect(await listCardTiers(database, ws)).toEqual({ [payroll.id]: 'prioritas' });
    await setAccountCardTier(database, ws, payroll.id, null);
    expect(await listCardTiers(database, ws)).toEqual({});
  });

  it('is a short word, and blank is unset', async () => {
    const savings = await openCashAccount(database, ws, { item: 'savings', name: 'Rainy day', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-09-01' });
    await expect(setAccountCardTier(database, ws, savings.id, 'Gold Card!')).rejects.toThrow('short word');
    await setAccountCardTier(database, ws, savings.id, '  ');
    expect(await listCardTiers(database, ws)).toEqual({});
  });

  it('is only a question about an account a debit card spends from', async () => {
    const wallet = await openCashAccount(database, ws, { item: 'ewallet', name: 'OVO', currency: 'IDR', openingBalanceMinor: 100_000, openedOn: '2026-09-01' });
    await expect(setAccountCardTier(database, ws, wallet.id, 'gold')).rejects.toThrow('not an account a debit card spends from');
    const card = await createAccount(database, ws, { name: 'Blue Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(setAccountCardTier(database, ws, card.id, 'gold')).rejects.toThrow('not an account a debit card spends from');
    await expect(setAccountCardTier(database, ws, 'no-such-account', 'gold')).rejects.toThrow('Account not found');
  });
});
