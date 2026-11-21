import { describe, expect, it } from 'vitest';
import { createAccount, createWorkspace, heldHere } from '../../src/index';
import { setupDb } from '../helpers';

/*
 * Link my devices, review fix: a new device saves a backup file before its data is replaced unless it holds truly
 * nothing of the owner's — a fresh install. An account with no transactions, or a second workspace, is not empty. Invented data.
 */
describe('what a device holds before a link replaces it', () => {
  it('a fresh install is empty', async () => {
    const t = await setupDb();
    expect(await heldHere(t.database)).toMatchObject({ workspaces: 1, transactions: 0, empty: true });
  });

  it('an account with no transactions is not empty', async () => {
    const t = await setupDb();
    await createAccount(t.database, t.ws, { name: 'Test Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    expect(await heldHere(t.database)).toMatchObject({ transactions: 0, empty: false });
  });

  it('a second workspace is not empty', async () => {
    const t = await setupDb();
    await createWorkspace(t.database, { name: 'Test Side', type: 'business', baseCurrency: 'IDR' });
    expect((await heldHere(t.database)).empty).toBe(false);
  });
});
