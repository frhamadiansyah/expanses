import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  checkLedgerIntegrity,
  createAccount,
  createWorkspace,
  type Database,
  deleteTrade,
  listTrades,
  listTransactions,
  nativeBalances,
  positionsFor,
  recordTrade,
  replaceTrade,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let gold: AccountRow;
let bca: AccountRow;

const g = (grams: number) => grams * 1_000_000;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  bca = await createAccount(database, ws, {
    name: 'BCA Tahapan',
    kind: 'asset',
    subtype: 'bank',
    currency: 'IDR',
    openingBalanceMinor: 50_000_000,
    openedOn: '2026-01-01',
  });
});

const buy = (occurredOn: string, grams: number, grossMinor: number, extra: Record<string, unknown> = {}) =>
  recordTrade(database, ws, { accountId: gold.id, kind: 'buy' as const, occurredOn, unitsMicro: g(grams), grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id, ...extra });

const sell = (occurredOn: string, grams: number, grossMinor: number) =>
  recordTrade(database, ws, { accountId: gold.id, kind: 'sell' as const, occurredOn, unitsMicro: g(grams), grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id });

async function balanced() {
  await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
}

describe('recordTrade', () => {
  it('posts a buy and moves the cash balance', async () => {
    const result = await buy('2026-03-09', 5, 9_300_000);

    expect(result.transactionId).toBeTruthy();
    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(9_300_000);
    expect(balances[bca.id]).toBe(50_000_000 - 9_300_000);
    await balanced();
  });

  it('adds fees and tax to cost', async () => {
    await buy('2026-02-16', 5, 9_250_000, { feeMinor: 13_875, taxMinor: 1_125 });

    const positions = await positionsFor(database, ws);
    expect(positions[gold.id]!.costMinor).toBe(9_265_000);
  });

  it('posts an opening position against Opening Balances and leaves the bank alone', async () => {
    await buy('2022-05-14', 10, 9_520_000, { cashAccountId: null });

    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(9_520_000);
    expect(balances[bca.id]).toBe(50_000_000);
    await balanced();
  });

  it('books the realized gain on a sell', async () => {
    await buy('2024-02-03', 10, 13_100_000);
    const result = await sell('2026-06-14', 5, 9_000_000);

    expect(result.recalculatedSells).toEqual([]);
    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(13_100_000 - 6_550_000);
    expect(balances[bca.id]).toBe(50_000_000 - 13_100_000 + 9_000_000);
    await balanced();
  });

  it('refuses to sell more than is held and writes nothing', async () => {
    await buy('2024-02-03', 10, 13_100_000);

    await expect(sell('2026-06-14', 11, 9_000_000)).rejects.toThrow(/10/);
    await expect(listTrades(database, ws, { accountId: gold.id })).resolves.toHaveLength(1);
    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(13_100_000);
    await balanced();
  });

  it('recomputes a later sell when a backdated buy changes the average cost', async () => {
    await buy('2024-02-03', 10, 13_100_000);
    await sell('2026-06-14', 5, 9_000_000);

    const result = await buy('2026-03-09', 5, 9_300_000);

    expect(result.recalculatedSells).toHaveLength(1);
    expect(result.recalculatedSells[0]).toMatchObject({ oldBasisMinor: 6_550_000, newBasisMinor: 7_466_667 });
    const positions = await positionsFor(database, ws);
    expect(positions[gold.id]!.unitsMicro).toBe(g(10));
    expect(positions[gold.id]!.costMinor).toBe(13_100_000 + 9_300_000 - 7_466_667);
    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(positions[gold.id]!.costMinor);
    await balanced();
  });
});

describe('replaceTrade and deleteTrade', () => {
  it('replaces a trade, keeping one active row that points at the old one', async () => {
    const first = await buy('2026-03-09', 5, 9_300_000);

    const replaced = await replaceTrade(database, ws, first.tradeId, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: '2026-03-09',
      unitsMicro: g(5),
      grossMinor: 9_500_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: bca.id,
    });

    const rows = await listTrades(database, ws, { accountId: gold.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: replaced.tradeId, replacesTradeId: first.tradeId, grossMinor: 9_500_000 });
    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(9_500_000);
    expect(balances[bca.id]).toBe(50_000_000 - 9_500_000);
    await balanced();
  });

  it('deletes a trade, voids its transaction and recomputes later sells', async () => {
    await buy('2024-02-03', 10, 13_100_000);
    const extra = await buy('2026-03-09', 5, 9_300_000);
    await sell('2026-06-14', 5, 9_000_000);

    const result = await deleteTrade(database, ws, extra.tradeId);

    expect(result.recalculatedSells).toHaveLength(1);
    const rows = await listTrades(database, ws, { accountId: gold.id });
    expect(rows.map((r) => r.kind)).toEqual(['buy', 'sell']);
    const positions = await positionsFor(database, ws);
    expect(positions[gold.id]!.costMinor).toBe(13_100_000 - 6_550_000);
    const posted = await listTransactions(database, ws, {});
    expect(posted.filter((t) => t.description.includes('Bought'))).toHaveLength(1);
    await balanced();
  });
});

describe('listTrades and positionsFor', () => {
  it('lists active trades oldest first', async () => {
    await buy('2026-03-09', 5, 9_300_000);
    await buy('2024-02-03', 10, 13_100_000);

    const rows = await listTrades(database, ws, { accountId: gold.id });
    expect(rows.map((r) => r.occurredOn)).toEqual(['2024-02-03', '2026-03-09']);
  });

  it('gives units and cost per holding', async () => {
    await buy('2024-02-03', 10, 13_100_000);

    const positions = await positionsFor(database, ws);
    expect(positions[gold.id]).toMatchObject({ unitsMicro: g(10), costMinor: 13_100_000 });
  });

  it('keeps another workspace out', async () => {
    await buy('2024-02-03', 10, 13_100_000);
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });

    await expect(listTrades(database, other)).resolves.toEqual([]);
    await expect(positionsFor(database, other)).resolves.toEqual({});
  });
});
