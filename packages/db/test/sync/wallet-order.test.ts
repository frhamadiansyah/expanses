import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, personalBook, renameAccount, setWalletOrder } from '../../src/index';
import { setupDb } from '../helpers';
import { outboxOps, shareBookForTest } from './sync-helpers';

/**
 * Wallet's order goes through the same capture as an account's rename. A money account or a credit card is the device's
 * own — it is never one of a shared book's categories — so in a shared book the order is written and emits nothing,
 * exactly as a rename of a money account does, while a category's rename beside it still goes out.
 */
describe('capture: Wallet order', () => {
  it('is written in a shared book and stays on the device, as an edit to a money account does', async () => {
    const { database, ws } = await setupDb();
    const book = await personalBook(database, ws);
    const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const card = await createAccount(database, ws, { name: 'Blue Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await shareBookForTest(database, book.id, 'member-me');

    await renameAccount(database, ws, bca.id, 'BCA');
    expect(await outboxOps(database)).toEqual([]);
    await setWalletOrder(database, ws, [card.id, bca.id]);
    expect(await outboxOps(database)).toEqual([]);
    const order = Object.fromEntries((await listAccounts(database, ws)).map((a) => [a.id, a.sortOrder]));
    expect([order[card.id], order[bca.id]]).toEqual([1, 2]);

    // The same capture still carries a category's own edit.
    const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!;
    await renameAccount(database, ws, groceries.id, 'Market');
    expect(await outboxOps(database)).toEqual([{ entity: 'category', id: groceries.id, op: 'upsert', fields: { name: 'Market' } }]);
  });
});
