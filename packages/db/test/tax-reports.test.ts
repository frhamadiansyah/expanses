import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assetsSchema,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  draftReport,
  getAssetProfile,
  getDebtProfile,
  listReports,
  migrate,
  MIGRATIONS,
  reportFor,
  saveAssetProfile,
  saveDebtProfile,
  schema,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const YEAR = 2026;

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

/** A database still on version 11, so a migration can be watched doing its work. */
async function atVersion11() {
  const older = createDatabase(createNodeExecutor());
  await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 11));
  const olderWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { older, olderWs };
}

describe('migration 0012', () => {
  it('applies on a database already populated through version 11', async () => {
    const { older, olderWs } = await atVersion11();

    await migrate(older);

    await draftReport(older, olderWs, { taxYear: YEAR });
    await expect(reportFor(older, olderWs, YEAR)).resolves.toMatchObject({ taxYear: YEAR, status: 'draft' });
  });

  it('keeps the rates already stored when it rebuilds the table', async () => {
    const { older, olderWs } = await atVersion11();
    await older.db.insert(schema.fxRates).values({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      onDate: '2026-12-31',
      rate: 16_000,
      source: 'manual',
      sourceDate: '2026-12-31',
      fetchedAt: new Date().toISOString(),
    });

    await migrate(older);

    const rows = await older.db.values<[string, number, string]>(sql`SELECT from_currency, rate, source FROM fx_rates`);
    expect(rows).toEqual([['USD', 16_000, 'manual']]);
    expect(olderWs.workspaceId).toBeTruthy();
  });
});

describe('the KMK rate source', () => {
  it('is allowed once the table has been rebuilt', async () => {
    await database.db.insert(schema.fxRates).values({
      fromCurrency: 'USD',
      toCurrency: 'IDR',
      onDate: '2026-12-31',
      rate: 16_100,
      source: 'kmk',
      sourceDate: '2026-12-31',
      fetchedAt: new Date().toISOString(),
    });

    const rows = await database.db.values<[string]>(sql`SELECT source FROM fx_rates WHERE on_date = '2026-12-31'`);
    expect(rows).toEqual([['kmk']]);
  });

  it('still refuses a source nobody recognises', async () => {
    await expect(
      database.db.values(sql`INSERT INTO fx_rates VALUES ('USD', 'IDR', '2026-12-30', 16000, 'bloomberg', '2026-12-30', '2026-12-30T00:00:00Z')`),
    ).rejects.toThrow();
  });
});

describe('a draft report', () => {
  it('is created for a year, and starts as a draft', async () => {
    await draftReport(database, ws, { taxYear: YEAR });

    await expect(reportFor(database, ws, YEAR)).resolves.toMatchObject({ taxYear: YEAR, status: 'draft', propertyBasis: 'cost', repeatRows: 'holding' });
  });

  it('keeps the taxpayer details and the settings', async () => {
    await draftReport(database, ws, { taxYear: YEAR, npwp: '0011223344556677', taxpayerName: 'Fandrian', propertyBasis: 'njop', repeatRows: 'year' });

    await expect(reportFor(database, ws, YEAR)).resolves.toMatchObject({
      npwp: '0011223344556677',
      taxpayerName: 'Fandrian',
      propertyBasis: 'njop',
      repeatRows: 'year',
    });
  });

  it('updates the one already there instead of opening a second for the same year', async () => {
    await draftReport(database, ws, { taxYear: YEAR, taxpayerName: 'Fandrian' });
    await draftReport(database, ws, { taxYear: YEAR, taxpayerName: 'Fandrian Rhamadiansyah', repeatRows: 'year' });

    const reports = await listReports(database, ws);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ taxpayerName: 'Fandrian Rhamadiansyah', repeatRows: 'year' });
  });

  it('opens for a year with nothing recorded in it at all', async () => {
    await draftReport(database, ws, { taxYear: 2019 });

    await expect(reportFor(database, ws, 2019)).resolves.toMatchObject({ status: 'draft' });
  });

  it('lists the years newest first', async () => {
    await draftReport(database, ws, { taxYear: 2025 });
    await draftReport(database, ws, { taxYear: YEAR });

    expect((await listReports(database, ws)).map((report) => report.taxYear)).toEqual([2026, 2025]);
  });

  it('has nothing to show for a workspace with no reports', async () => {
    await expect(listReports(database, ws)).resolves.toEqual([]);
    await expect(reportFor(database, ws, YEAR)).resolves.toBeUndefined();
  });

  it('refuses a year that has not happened', async () => {
    await expect(draftReport(database, ws, { taxYear: 2999 })).rejects.toThrow(/tax year/i);
  });
});

describe('the corrected defaults', () => {
  it('opens a new receivable on the real code, not the placeholder', async () => {
    const andi = await createAccount(database, ws, { name: 'Andi', kind: 'asset', subtype: 'receivable', currency: 'IDR' });
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi' });

    await expect(getDebtProfile(database, ws, andi.id)).resolves.toMatchObject({ coretaxCode: '0201' });
  });

  it('opens a new payable on the real code', async () => {
    const budi = await createAccount(database, ws, { name: 'Budi', kind: 'liability', subtype: 'payable', currency: 'IDR' });
    await saveDebtProfile(database, ws, { accountId: budi.id, personName: 'Budi' });

    await expect(getDebtProfile(database, ws, budi.id)).resolves.toMatchObject({ coretaxCode: '104' });
  });

  it('gives a new asset the code its preset carries', async () => {
    const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });

    await expect(getAssetProfile(database, ws, gold.id)).resolves.toMatchObject({ coretaxCode: '0701' });
  });
});
