import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAccount, createWorkspace, listAccounts, openCashAccount, openPocketedAccount, setWalletOrder, type Database, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

/**
 * Wallet's order (owner's "A2"): money kept for spending and credit cards in one mixed list, kept as each account's
 * `sort_order` 1, 2, 3… An account left out keeps what it had.
 */

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const orderOf = async () => Object.fromEntries((await listAccounts(database, ws, { includeArchived: true })).map((row) => [row.id, row.sortOrder]));

async function threeCards() {
  const bank = await openCashAccount(database, ws, { item: 'bank', name: 'Payroll', currency: 'IDR', openingBalanceMinor: 2_000_000, openedOn: '2026-09-01' });
  const wallet = await openCashAccount(database, ws, { item: 'ewallet', name: 'Pocket app', currency: 'IDR', openingBalanceMinor: 150_000, openedOn: '2026-09-01' });
  const card = await createAccount(database, ws, { name: 'Blue Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  return { bank, wallet, card };
}

describe('setWalletOrder', () => {
  it('saves the order as 1, 2, 3, a credit card in front of money included', async () => {
    const { bank, wallet, card } = await threeCards();
    await setWalletOrder(database, ws, [card.id, bank.id, wallet.id]);
    const order = await orderOf();
    expect([order[card.id], order[bank.id], order[wallet.id]]).toEqual([1, 2, 3]);
    // Saved again in another order, every place is rewritten.
    await setWalletOrder(database, ws, [wallet.id, card.id, bank.id]);
    const again = await orderOf();
    expect([again[wallet.id], again[card.id], again[bank.id]]).toEqual([1, 2, 3]);
  });

  it('leaves every account it was not given as it was: categories, pockets and a card left out', async () => {
    const { bank, wallet, card } = await threeCards();
    const { pockets } = await openPocketedAccount(database, ws, { item: 'bank', name: 'Wise', pockets: [{ currency: 'USD', openingRateToBase: 16_250 }, { currency: 'IDR' }] });
    const before = await orderOf();
    await setWalletOrder(database, ws, [card.id, bank.id]);
    const after = await orderOf();
    for (const [id, place] of Object.entries(before)) {
      if (id === card.id || id === bank.id) continue;
      expect(after[id], id).toBe(place);
    }
    expect(after[wallet.id]).toBe(0);
    expect(pockets.map((p) => after[p.id])).toEqual(pockets.map((p) => before[p.id]));
  });

  it('refuses an id that is not an account here, and writes nothing', async () => {
    const { bank, card } = await threeCards();
    await expect(setWalletOrder(database, ws, [card.id, 'no-such-account', bank.id])).rejects.toThrow('Account not found');
    const order = await orderOf();
    expect([order[card.id], order[bank.id]]).toEqual([0, 0]);
  });

  it("refuses another workspace's account", async () => {
    const { bank } = await threeCards();
    const business = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    const theirs = await openCashAccount(database, business, { item: 'bank', name: 'Theirs', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-09-01' });
    await expect(setWalletOrder(database, ws, [theirs.id, bank.id])).rejects.toThrow('Account not found');
    const rows = await database.db.values<[number]>(sql`SELECT sort_order FROM accounts WHERE id = ${theirs.id}`);
    expect(rows).toEqual([[0]]);
  });

  it('refuses a category or a pocket, which are never Wallet cards, and an id given twice', async () => {
    const { bank } = await threeCards();
    const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!;
    await expect(setWalletOrder(database, ws, [bank.id, groceries.id])).rejects.toThrow('is not a card in Wallet');
    const { pockets } = await openPocketedAccount(database, ws, { item: 'bank', name: 'Wise', pockets: [{ currency: 'USD', openingRateToBase: 16_250 }, { currency: 'IDR' }] });
    await expect(setWalletOrder(database, ws, [pockets[0]!.id])).rejects.toThrow('is not a card in Wallet');
    await expect(setWalletOrder(database, ws, [bank.id, bank.id])).rejects.toThrow('listed twice');
    expect((await orderOf())[bank.id]).toBe(0);
  });

  it('is audited as one change', async () => {
    const { bank, card } = await threeCards();
    await setWalletOrder(database, ws, [card.id, bank.id]);
    const rows = await database.db.values<[string]>(sql`SELECT payload_json FROM audit_log WHERE action = 'wallet_order'`);
    expect(rows.map(([json]) => JSON.parse(json))).toEqual([{ order: [card.id, bank.id] }]);
  });
});
