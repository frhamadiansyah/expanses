import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, MIGRATIONS, migrate, saveAssetProfile, saveTradeTemplate, upsertPrice } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('migration 0076: monthly buys of a fund become amounts', () => {
  it('is version 76 and named fund_templates_by_money', () => {
    expect(MIGRATIONS.find((m) => m.version === 76)).toMatchObject({ name: 'fund_templates_by_money' });
  });

  it('turns a fund’s units into an amount at its last NAV, switches one with no NAV off, and leaves gold alone', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 75));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const priced = await createAccount(database, ws, { name: 'Priced fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    const bare = await createAccount(database, ws, { name: 'Fund with no NAV', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    const gold = await createAccount(database, ws, { name: 'Gold', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    // Saved while funds were still counted in units: the profile comes after the monthly buy.
    const units = (accountId: string) => saveTradeTemplate(database, ws, { accountId, cashAccountId: bank.id, amountMinor: null, unitsMicro: 10_500_000, dayOfMonth: 5, active: true });
    const pricedId = await units(priced.id);
    const bareId = await units(bare.id);
    const goldId = await units(gold.id);
    await saveAssetProfile(database, ws, { accountId: priced.id, assetKind: 'fund' });
    await saveAssetProfile(database, ws, { accountId: bare.id, assetKind: 'fund' });
    await upsertPrice(database, ws, { accountId: priced.id, onDate: '2026-09-01', priceMicro: 1_800_000_000 });
    await upsertPrice(database, ws, { accountId: priced.id, onDate: '2026-10-01', priceMicro: 1_843_271_500 });

    expect(await migrate(database)).toContain(76);

    const row = async (id: string) =>
      (await database.db.values<[number | null, number | null, number]>(sql`SELECT amount_minor, units_micro, active FROM trade_templates WHERE id = ${id}`))[0];
    // 10,5 units at the last NAV, 1.843,2715: Rp 19.354.
    expect(await row(pricedId)).toEqual([19_354, null, 1]);
    expect(await row(bareId)).toEqual([null, 10_500_000, 0]);
    expect(await row(goldId)).toEqual([null, 10_500_000, 1]);
  });

  it('refuses a new monthly buy of a fund in units', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const fund = await createAccount(database, ws, { name: 'Fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: fund.id, assetKind: 'fund' });
    await expect(saveTradeTemplate(database, ws, { accountId: fund.id, cashAccountId: bank.id, amountMinor: null, unitsMicro: 1_000_000, dayOfMonth: 5, active: true })).rejects.toThrow(
      'A monthly buy of a fund is an amount of money, not units',
    );
  });
});
