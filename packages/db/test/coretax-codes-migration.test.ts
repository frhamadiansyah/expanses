import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  assetsSchema,
  createAccount,
  createDatabase,
  createWorkspace,
  getAssetProfile,
  getDebtProfile,
  migrate,
  MIGRATIONS,
  saveAssetProfile,
  saveDebtProfile,
  type WorkspaceContext,
  type Database,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/** A database still on version 12, where codes are the e-Form three-digit ones. */
async function atVersion12(): Promise<{ older: Database; olderWs: WorkspaceContext }> {
  const older = createDatabase(createNodeExecutor());
  await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 12));
  const olderWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { older, olderWs };
}

/** Writes a profile the way a version 12 database held it, three-digit code and all. */
async function oldProfile(older: Database, ws: WorkspaceContext, accountId: string, assetKind: string, code: string, section: string) {
  await older.db.insert(assetsSchema.assetProfiles).values({
    accountId,
    workspaceId: ws.workspaceId,
    assetKind: assetKind as 'gold',
    planGroup: 'invest',
    unitKind: null,
    lotSize: null,
    risk: null,
    coretaxSection: section as 'lainnya',
    coretaxCode: code,
    coretaxFieldsJson: '{}',
    acquiredYear: null,
    updatedAt: new Date().toISOString(),
  });
}

describe('migration 0013', () => {
  it('applies on a database already populated through version 12', async () => {
    const { older, olderWs } = await atVersion12();
    const gold = await createAccount(older, olderWs, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await oldProfile(older, olderWs, gold.id, 'gold', '051', 'lainnya');

    await migrate(older);

    await expect(getAssetProfile(older, olderWs, gold.id)).resolves.toMatchObject({ coretaxCode: '0701' });
  });

  it('converts every family to its Coretax table', async () => {
    const { older, olderWs } = await atVersion12();
    const cases: [string, string, string][] = [
      ['012', '0102', 'kas'],
      ['014', '0104', 'kas'],
      ['032', '0303', 'investasi'],
      ['034', '0305', 'investasi'],
      ['036', '0307', 'investasi'],
      ['043', '0403', 'bergerak'],
      ['061', '0502', 'tidak_bergerak'],
      ['063', '0505', 'tidak_bergerak'],
    ];
    const ids: [string, string][] = [];
    for (const [before, after, section] of cases) {
      const account = await createAccount(older, olderWs, { name: `Asset ${before}`, kind: 'asset', subtype: 'investment', currency: 'IDR' });
      await oldProfile(older, olderWs, account.id, 'other', before, section);
      ids.push([account.id, after]);
    }

    await migrate(older);

    for (const [accountId, after] of ids) {
      await expect(getAssetProfile(older, olderWs, accountId)).resolves.toMatchObject({ coretaxCode: after });
    }
  });

  it('sends a fund to the collective investment contract code, not the bond one', async () => {
    const { older, olderWs } = await atVersion12();
    const fund = await createAccount(older, olderWs, { name: 'Equity fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await oldProfile(older, olderWs, fund.id, 'fund', '036', 'investasi');

    await migrate(older);

    await expect(getAssetProfile(older, olderWs, fund.id)).resolves.toMatchObject({ coretaxCode: '0307' });
  });

  it('converts a receivable and leaves a payable on its unverified code', async () => {
    const { older, olderWs } = await atVersion12();
    const andi = await createAccount(older, olderWs, { name: 'Andi', kind: 'asset', subtype: 'receivable', currency: 'IDR' });
    const budi = await createAccount(older, olderWs, { name: 'Budi', kind: 'liability', subtype: 'payable', currency: 'IDR' });
    await saveDebtProfile(older, olderWs, { accountId: andi.id, personName: 'Andi', coretaxCode: '021' });
    await saveDebtProfile(older, olderWs, { accountId: budi.id, personName: 'Budi', coretaxCode: '104' });

    await migrate(older);

    await expect(getDebtProfile(older, olderWs, andi.id)).resolves.toMatchObject({ coretaxCode: '0201' });
    await expect(getDebtProfile(older, olderWs, budi.id)).resolves.toMatchObject({ coretaxCode: '104' });
  });

  it('converts a code once, and migrating again changes nothing', async () => {
    const { older, olderWs } = await atVersion12();
    const permata = await createAccount(older, olderWs, { name: 'Batu mulia', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    // Batu mulia is one of the four Coretax splits apart: it becomes permata.
    await oldProfile(older, olderWs, permata.id, 'other', '052', 'lainnya');

    await migrate(older);
    await expect(getAssetProfile(older, olderWs, permata.id)).resolves.toMatchObject({ coretaxCode: '0705' });

    // Migrating again changes nothing: the codes are already where they belong.
    await migrate(older);
    await expect(getAssetProfile(older, olderWs, permata.id)).resolves.toMatchObject({ coretaxCode: '0705' });
  });

  it('never touches a row already frozen into a report', async () => {
    const { older, olderWs } = await atVersion12();
    // A frozen row is what was filed, so it keeps the code it carried then.
    await older.db.values(sql`INSERT INTO tax_year_reports (id, workspace_id, tax_year, status, property_basis, repeat_rows, created_at)
      VALUES ('r1', ${olderWs.workspaceId}, 2025, 'frozen', 'cost', 'holding', '2026-01-02T00:00:00Z')`);
    await older.db.values(sql`INSERT INTO tax_year_rows (id, report_id, workspace_id, section, code, row_key, name, sort, fields_json, cost_minor, value_minor, balance_minor, source, already_filed, created_at)
      VALUES ('row1', 'r1', ${olderWs.workspaceId}, 'lainnya', '051', 'gold', 'Antam gold bars', 0, '{}', 18600000, 19000000, 0, 'auto', 0, '2026-01-02T00:00:00Z')`);

    await migrate(older);

    const rows = await older.db.values<[string]>(sql`SELECT code FROM tax_year_rows WHERE id = 'row1'`);
    expect(rows).toEqual([['051']]);
  });
});

describe('after the upgrade', () => {
  it('refuses a three-digit code again', async () => {
    const { database, ws } = await setupDb();
    const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });

    await expect(saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold', coretaxCode: '051' })).rejects.toThrow(/four digits/);
  });

  it('gives a new asset the Coretax code its preset carries', async () => {
    const { database, ws } = await setupDb();
    const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });

    await expect(getAssetProfile(database, ws, gold.id)).resolves.toMatchObject({ coretaxCode: '0701' });
  });
});
