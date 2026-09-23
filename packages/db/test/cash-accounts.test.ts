import { beforeEach, describe, expect, it } from 'vitest';
import { AccountError, archiveAccount, listTransactions, nativeBalances, openCashAccount, type Database, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

/**
 * Where the money an account opens with comes from. Left unsaid, it is an opening balance against equity —
 * money that was already there, which no account of the owner's loses. Said (a source account), it moves: one
 * transfer out of that account and into the new one, so both balances follow and nothing is counted twice.
 */

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const openBank = async (name: string, balanceMinor: number, currency = 'IDR') =>
  openCashAccount(database, ws, {
    item: 'bank',
    name,
    currency,
    openingBalanceMinor: balanceMinor,
    openedOn: '2026-09-01',
    openingRateToBase: currency === 'IDR' ? undefined : 16_000,
  });

describe('opening an account with a balance', () => {
  it('without a source, stays an opening balance: equity moves, no other account does', async () => {
    const bca = await openBank('BCA Tahapan', 100_000_000);
    const deposit = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'bluuu',
      currency: 'IDR',
      openingBalanceMinor: 50_000_000,
      openedOn: '2026-09-02',
      maturesOn: '2026-12-02',
    });
    const balances = await nativeBalances(database, ws);
    expect(balances[bca.id]).toBe(100_000_000);
    expect(balances[deposit.id]).toBe(50_000_000);
    const [tx] = await listTransactions(database, ws, { accountId: deposit.id });
    expect(tx!.description).toBe('Opening balance: bluuu');
    expect(tx!.entries.map((e) => e.accountKind)).toEqual(expect.arrayContaining(['equity']));
  });

  it('with a source, moves it: one transfer, two money sides, no equity', async () => {
    const bca = await openBank('BCA Tahapan', 100_000_000);
    const deposit = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'bluuu',
      currency: 'IDR',
      openingBalanceMinor: 50_000_000,
      openedOn: '2026-09-02',
      maturesOn: '2026-12-02',
      sourceAccountId: bca.id,
    });
    const balances = await nativeBalances(database, ws);
    expect(balances[bca.id]).toBe(50_000_000);
    expect(balances[deposit.id]).toBe(50_000_000);
    const txs = await listTransactions(database, ws, { accountId: deposit.id });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.description).toBe('Transfer');
    expect(txs[0]!.occurredOn).toBe('2026-09-02');
    expect(txs[0]!.entries.map((e) => e.accountKind)).toEqual(['asset', 'asset']);
    expect(txs[0]!.entries.find((e) => e.accountId === deposit.id)!.amountMinor).toBe(50_000_000);
    expect(txs[0]!.entries.find((e) => e.accountId === bca.id)!.amountMinor).toBe(-50_000_000);
    // The source's own ledger shows the same one movement.
    expect(await listTransactions(database, ws, { accountId: bca.id })).toHaveLength(2);
  });

  it('carries the settled rate onto the transfer when the money is foreign', async () => {
    const usd = await openBank('Jenius USD', 1_000_000, 'USD');
    const deposit = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'Jenius Deposito',
      currency: 'USD',
      openingBalanceMinor: 500_000,
      openedOn: '2026-09-02',
      maturesOn: '2026-12-02',
      openingRateToBase: 16_000,
      sourceAccountId: usd.id,
    });
    const [tx] = await listTransactions(database, ws, { accountId: deposit.id });
    expect(tx!.entries.map((e) => e.fxRateToBase)).toEqual([16_000, 16_000]);
    // US$5.000 at 16.000 is Rp 80.000.000 — every entry is valued in the base currency the transfer was posted at.
    expect(tx!.entries.find((e) => e.accountId === deposit.id)!.amountBaseMinor).toBe(80_000_000);
  });

  it('refuses a source the owner cannot spend, and opens nothing', async () => {
    const locked = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Old deposit', currency: 'IDR', maturesOn: '2026-12-01' });
    await expect(
      openCashAccount(database, ws, { item: 'bank', name: 'New bank', currency: 'IDR', openingBalanceMinor: 1_000_000, sourceAccountId: locked.id }),
    ).rejects.toBeInstanceOf(AccountError);
    expect((await nativeBalances(database, ws))[locked.id] ?? 0).toBe(0);
  });

  it('refuses a source in another currency', async () => {
    const usd = await openBank('Jenius USD', 1_000_000, 'USD');
    await expect(
      openCashAccount(database, ws, { item: 'time_deposit', name: 'Rupiah deposit', currency: 'IDR', openingBalanceMinor: 50_000_000, maturesOn: '2026-12-02', sourceAccountId: usd.id }),
    ).rejects.toThrow(/holds USD/);
  });

  it('refuses an archived source', async () => {
    const closed = await openBank('Old bank', 0);
    await archiveAccount(database, ws, closed.id);
    await expect(
      openCashAccount(database, ws, { item: 'bank', name: 'New bank', currency: 'IDR', openingBalanceMinor: 1_000_000, sourceAccountId: closed.id }),
    ).rejects.toBeInstanceOf(AccountError);
  });

  it('moves nothing when the account opens at zero, whatever the source', async () => {
    const bca = await openBank('BCA Tahapan', 1_000_000);
    const empty = await openCashAccount(database, ws, { item: 'bank', name: 'Second bank', currency: 'IDR', sourceAccountId: bca.id });
    expect((await nativeBalances(database, ws))[bca.id]).toBe(1_000_000);
    expect(await listTransactions(database, ws, { accountId: empty.id })).toEqual([]);
  });
});
