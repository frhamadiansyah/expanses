import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rateFromAmounts } from '@expanses/core';
import {
  type AccountRow, addHolding, archiveAccount, AssetError, brokerlessHoldingsOf, checkLedgerIntegrity, createAccount, createDatabase, createWorkspace, type Database, getAssetProfile, listAccounts, listDraws, listEarmarks, listHoldingLinks,
  linkHolding, listSecurities, migrate, recordTrade, MIGRATIONS, nativeBalances, positionsFor, saveAssetProfile, saveEarmark, saveGoal, schema, upsertSecurityPrice,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
const bbca = { ticker: 'BBCA', name: 'BBCA name', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' as const, source: 'catalogue' as const };
const aapl = { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share' as const, source: 'owner' as const };
const shares = (n: number) => n * 1_000_000;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
});

describe('addHolding', () => {
  it('opens the broker, the holding and its profile, links them and records the buy', async () => {
    const result = await addHolding(database, ws, {
      security: bbca,
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 13_125, taxMinor: 0, cashAccountId: bca.id },
    });
    expect(result.created).toBe(true);
    const accounts = await listAccounts(database, ws);
    expect(accounts.find((a) => a.id === result.accountId)).toMatchObject({ name: 'BBCA · Stockbit', subtype: 'investment', currency: 'IDR' });
    expect(accounts.find((a) => a.id === result.brokerAccountId)).toMatchObject({ name: 'Stockbit', subtype: 'fund', currency: 'IDR' });
    expect(await getAssetProfile(database, ws, result.accountId)).toMatchObject({ assetKind: 'stock', lotSize: 100, coretaxCode: '0303', unitKind: 'shares' });
    const balances = await nativeBalances(database, ws);
    expect(balances[result.accountId]).toBe(8_763_125);
    expect(balances[bca.id]).toBe(41_236_875);
    expect(await listHoldingLinks(database, ws)).toEqual([{ accountId: result.accountId, securityId: result.securityId, brokerAccountId: result.brokerAccountId }]);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('records a second buy at the same broker on the same holding', async () => {
    const first = await addHolding(database, ws, { security: bbca, broker: { name: 'Stockbit', currency: 'IDR' }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    const second = await addHolding(database, ws, { security: { id: first.securityId }, broker: { accountId: first.brokerAccountId! }, buy: { occurredOn: '2026-04-02', unitsMicro: shares(500), grossMinor: 4_700_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    expect(second).toMatchObject({ created: false, accountId: first.accountId });
    expect((await positionsFor(database, ws))[first.accountId]!.unitsMicro).toBe(shares(1_500));
  });

  it('keeps the same security at two brokers apart (I2)', async () => {
    const stockbit = await addHolding(database, ws, { security: bbca, broker: { name: 'Stockbit', currency: 'IDR' }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    const mandiri = await addHolding(database, ws, { security: { id: stockbit.securityId }, broker: { name: 'Mandiri Sekuritas', currency: 'IDR' }, buy: { occurredOn: '2026-03-05', unitsMicro: shares(500), grossMinor: 4_700_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    expect(stockbit.created).toBe(true);
    expect(mandiri.created).toBe(true);
    expect(mandiri.accountId).not.toBe(stockbit.accountId);
    const positions = await positionsFor(database, ws);
    expect(positions[stockbit.accountId]!.unitsMicro).toBe(shares(1_000));
    expect(positions[mandiri.accountId]!.unitsMicro).toBe(shares(500));
    expect(await listHoldingLinks(database, ws)).toEqual(expect.arrayContaining([
      { accountId: stockbit.accountId, securityId: stockbit.securityId, brokerAccountId: stockbit.brokerAccountId },
      { accountId: mandiri.accountId, securityId: mandiri.securityId, brokerAccountId: mandiri.brokerAccountId },
    ]));
  });

  it('keeps two securities at one broker apart (I3)', async () => {
    const tlkm = { ticker: 'TLKM', name: 'TLKM name', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' as const, source: 'catalogue' as const };
    const first = await addHolding(database, ws, { security: bbca, broker: { name: 'Stockbit', currency: 'IDR' }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    const second = await addHolding(database, ws, { security: tlkm, broker: { accountId: first.brokerAccountId! }, buy: { occurredOn: '2026-03-05', unitsMicro: shares(2_000), grossMinor: 3_800_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    expect(second.created).toBe(true);
    expect(second.accountId).not.toBe(first.accountId);
    expect(await listSecurities(database, ws)).toHaveLength(2);
    expect(await listHoldingLinks(database, ws)).toHaveLength(2);
  });

  it('pins the new holding to the security’s currency, not the broker’s (m8, A11)', async () => {
    const result = await addHolding(database, ws, {
      security: bbca, // IDR
      broker: { name: 'Interactive Brokers', currency: 'USD' },
      buy: { occurredOn: '2026-03-02', unitsMicro: shares(100), grossMinor: 875_000, feeMinor: 0, taxMinor: 0, cashAccountId: null },
    });
    const accounts = await listAccounts(database, ws);
    expect(accounts.find((a) => a.id === result.accountId)).toMatchObject({ currency: 'IDR' });
  });

  it('opens a fresh holding when the one at that broker was sold out and archived', async () => {
    const first = await addHolding(database, ws, { security: bbca, broker: { name: 'Stockbit', currency: 'IDR' }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(100), grossMinor: 875_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    await recordTrade(database, ws, { accountId: first.accountId, kind: 'sell', occurredOn: '2026-03-09', unitsMicro: shares(100), grossMinor: 875_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    await archiveAccount(database, ws, first.accountId);
    const again = await addHolding(database, ws, { security: { id: first.securityId }, broker: { accountId: first.brokerAccountId! }, buy: { occurredOn: '2026-05-04', unitsMicro: shares(200), grossMinor: 1_900_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    expect(again.created).toBe(true);
    expect(again.accountId).not.toBe(first.accountId);
    expect((await positionsFor(database, ws))[again.accountId]!.unitsMicro).toBe(shares(200));
  });

  it('pins a foreign buy paid in rupiah at exactly what left the account', async () => {
    const cashMinor = 20_000_001; // non-round on purpose
    const result = await addHolding(database, ws, {
      security: aapl,
      broker: { name: 'Interactive Brokers', currency: 'USD' },
      buy: { occurredOn: '2026-03-08', unitsMicro: shares(10), grossMinor: 123_457, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id, cashMinor, ratesToBase: { USD: rateFromAmounts(123_457, 'USD', cashMinor, 'IDR') } },
    });
    const lines = await database.db.select().from(schema.entries).where(and(eq(schema.entries.transactionId, result.trade.transactionId!), eq(schema.entries.accountId, result.accountId)));
    expect(lines.map((l) => [l.amountMinor, l.currency, l.amountBaseMinor])).toEqual([[123_457, 'USD', 20_000_001]]);
    expect((await nativeBalances(database, ws))[bca.id]).toBe(50_000_000 - 20_000_001);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('leaves nothing behind when the buy is refused', async () => {
    const before = (await listAccounts(database, ws)).length;
    await expect(addHolding(database, ws, { security: bbca, broker: { name: 'Stockbit', currency: 'IDR' }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 0, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id } })).rejects.toThrow();
    expect((await listAccounts(database, ws)).length).toBe(before);
    expect(await listSecurities(database, ws)).toEqual([]);
  });

  it('refuses a broker the owner closed, leaving nothing behind (m10)', async () => {
    const closed = await createAccount(database, ws, { name: 'Closed broker', kind: 'asset', subtype: 'fund', currency: 'IDR' });
    await archiveAccount(database, ws, closed.id);
    await expect(addHolding(database, ws, { security: bbca, broker: { accountId: closed.id }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(100), grossMinor: 875_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } })).rejects.toThrow(/not found/);
    expect(await listSecurities(database, ws)).toEqual([]);
  });

  it('refuses a broker that is a card or a bank, leaving nothing behind', async () => {
    const card = await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    for (const broker of [card, bca]) {
      await expect(addHolding(database, ws, { security: bbca, broker: { accountId: broker.id }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(100), grossMinor: 875_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } })).rejects.toThrow(/fund account/);
    }
    expect(await listSecurities(database, ws)).toEqual([]);
  });

  it('opens a foreign ETF as Listed shares (0303), like every holding added here', async () => {
    const voo = { ticker: 'VOO', name: 'VOO name', market: 'NYSE ARCA', currency: 'USD', lotSize: null, kind: 'etf' as const, source: 'catalogue' as const };
    const result = await addHolding(database, ws, { security: voo, broker: null, buy: { occurredOn: '2026-03-08', unitsMicro: shares(3), grossMinor: 149_460, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 16_100 } } });
    expect(await getAssetProfile(database, ws, result.accountId)).toMatchObject({ assetKind: 'stock', coretaxCode: '0303' });
  });
});

describe('addHolding’s cash side (I5)', () => {
  it('moves nothing when the buy is "owned before this app" (a)', async () => {
    const result = await addHolding(database, ws, {
      security: bbca,
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 0, taxMinor: 0, cashAccountId: null },
    });
    const balances = await nativeBalances(database, ws);
    expect(balances[result.brokerAccountId!] ?? 0).toBe(0);
    expect(balances[bca.id]).toBe(50_000_000);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('pays from a broker’s pocket, and refuses the parent’s cash (b)', async () => {
    const ibkr = await createAccount(database, ws, { name: 'Interactive Brokers', kind: 'asset', subtype: 'fund', currency: 'USD' });
    const usdPocket = await createAccount(database, ws, { name: 'Interactive Brokers · USD', kind: 'asset', subtype: 'fund', currency: 'USD', parentId: ibkr.id, openingBalanceMinor: 200_000_00, openedOn: '2026-01-01', openingRateToBase: 16_000 });

    const result = await addHolding(database, ws, {
      security: aapl,
      broker: { accountId: ibkr.id },
      buy: { occurredOn: '2026-03-08', unitsMicro: shares(10), grossMinor: 123_457, feeMinor: 0, taxMinor: 0, cashAccountId: usdPocket.id, ratesToBase: { USD: 16_000 } },
    });
    expect(result.brokerAccountId).toBe(ibkr.id);
    expect(await listHoldingLinks(database, ws)).toEqual([{ accountId: result.accountId, securityId: result.securityId, brokerAccountId: ibkr.id }]);
    const afterPocket = await nativeBalances(database, ws);
    expect(afterPocket[usdPocket.id]).toBe(200_000_00 - 123_457);

    await expect(addHolding(database, ws, {
      security: { id: result.securityId },
      broker: { accountId: ibkr.id },
      buy: { occurredOn: '2026-04-01', unitsMicro: shares(1), grossMinor: 12_000, feeMinor: 0, taxMinor: 0, cashAccountId: ibkr.id },
    })).rejects.toThrow();
    expect(await listHoldingLinks(database, ws)).toHaveLength(1);
    const afterRefusal = await nativeBalances(database, ws);
    expect(afterRefusal[usdPocket.id]).toBe(200_000_00 - 123_457);
    expect(afterRefusal[ibkr.id] ?? 0).toBe(0);
  });
});

describe('addHolding with no broker, deterministically (m2)', () => {
  it('lands a broker-less buy on the earliest-linked holding, not an arbitrary one', async () => {
    const first = await addHolding(database, ws, { security: bbca, broker: null, buy: { occurredOn: '2026-01-05', unitsMicro: shares(100), grossMinor: 875_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    // A second, legacy broker-less holding of the same security, linked after the first.
    const legacy = await createAccount(database, ws, { name: 'BBCA legacy', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: legacy.id, assetKind: 'stock' });
    await recordTrade(database, ws, { accountId: legacy.id, kind: 'buy', occurredOn: '2025-01-01', unitsMicro: shares(50), grossMinor: 400_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    await linkHolding(database, ws, { accountId: legacy.id, security: { id: first.securityId } });

    expect(await brokerlessHoldingsOf(database, ws, first.securityId)).toEqual([first.accountId, legacy.id]);

    const second = await addHolding(database, ws, { security: { id: first.securityId }, broker: null, buy: { occurredOn: '2026-02-01', unitsMicro: shares(10), grossMinor: 90_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    expect(second.created).toBe(false);
    expect(second.accountId).toBe(first.accountId);
    expect((await positionsFor(database, ws))[legacy.id]!.unitsMicro).toBe(shares(50));
  });
});

describe('addHolding is a set-aside door, as recordTrade is', () => {
  const goal = (name: string, targetMinor: number) =>
    saveGoal(database, ws, { name, kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name, targetMinor, targetMonths: null, dueOn: '2030-12-31' }] });

  it('lowers the promise of the goal the buy is for by what left the account, as a destination-less move', async () => {
    const pension = await goal('Pension', 20_000_000);
    await saveEarmark(database, ws, { goalId: pension, accountId: bca.id, amountMinor: 10_000_000 });
    const result = await addHolding(database, ws, {
      security: bbca,
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 13_125, taxMinor: 0, cashAccountId: bca.id, goalId: pension },
    });
    expect(await listDraws(database, ws)).toEqual([
      expect.objectContaining({ transactionId: result.trade.transactionId, goalId: pension, accountId: bca.id, intent: 'move', toAccountId: null, amountMinor: 8_763_125 }),
    ]);
    expect((await listEarmarks(database, ws)).find((row) => row.goalId === pension)!.amountMinor).toBe(1_236_875);
  });

  it('forwards the answer to "which goal paid" when the buy takes more than was free', async () => {
    const emergency = await goal('Emergency fund', 45_000_000);
    // Rp 50.000.000 in BCA, Rp 45.000.000 promised: Rp 5.000.000 free, so the buy takes Rp 3.763.125 from the fund.
    await saveEarmark(database, ws, { goalId: emergency, accountId: bca.id, amountMinor: 45_000_000 });
    const result = await addHolding(database, ws, {
      security: bbca,
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: {
        occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 13_125, taxMinor: 0, cashAccountId: bca.id,
        setAside: { accountId: bca.id, goalId: emergency, intent: 'borrow', overMinor: 3_763_125 },
      },
    });
    expect(await listDraws(database, ws)).toEqual([expect.objectContaining({ transactionId: result.trade.transactionId, goalId: emergency, intent: 'borrow', amountMinor: 3_763_125 })]);
  });
});

describe('on a database without 0051', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => { executor?.close(); executor = undefined; });

  it('refuses to add a holding, link one or price a security, and writes nothing', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version !== 51));
    const ows = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(older, ows, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
    const held = await createAccount(older, ows, { name: 'BBCA', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(older, ows, { accountId: held.id, assetKind: 'stock' });
    const accountsBefore = (await listAccounts(older, ows)).length;
    const balancesBefore = await nativeBalances(older, ows);

    await expect(addHolding(older, ows, {
      security: bbca,
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id },
    })).rejects.toBeInstanceOf(AssetError);
    await expect(linkHolding(older, ows, { accountId: held.id, security: bbca })).rejects.toBeInstanceOf(AssetError);
    await expect(upsertSecurityPrice(older, ows, { securityId: 'none', onDate: '2026-09-19', priceMicro: 1 })).rejects.toBeInstanceOf(AssetError);

    expect((await listAccounts(older, ows)).length).toBe(accountsBefore);
    expect(await nativeBalances(older, ows)).toEqual(balancesBefore);
  });
});
