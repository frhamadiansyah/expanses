import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptLedgerValue,
  type AccountRow,
  createAccount,
  type Database,
  draftReport,
  freezeReport,
  markFiled,
  recordTrade,
  reportFor,
  rowDifferences,
  savedRows,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = 2026;

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let gold: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: bca.id, assetKind: 'cash', coretaxFields: { owner: 'Fandrian', inst: 'BCA', loc: 'IDN' } });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold', coretaxFields: { info: 'Emas batangan Antam' } });
  await recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn: '2026-03-09',
    unitsMicro: 10_000_000,
    grossMinor: 18_600_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: null,
  });
  await draftReport(database, ws, { taxYear: YEAR });
});

/** A purchase dated into the year, recorded after the year was frozen. */
const backdatedBuy = () =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn: '2026-11-02',
    unitsMicro: 5_000_000,
    grossMinor: 9_300_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: null,
  });

describe('freezing a year', () => {
  it('copies the rows and marks the report frozen', async () => {
    const result = await freezeReport(database, ws, YEAR);

    expect(result.rows).toBeGreaterThan(0);
    await expect(reportFor(database, ws, YEAR)).resolves.toMatchObject({ status: 'frozen' });
    const rows = await savedRows(database, ws, YEAR);
    expect(rows.find((row) => row.name === 'BCA Tahapan')).toMatchObject({ valueMinor: 50_000_000 });
  });

  it('stops following the ledger once it is frozen', async () => {
    await freezeReport(database, ws, YEAR);

    await backdatedBuy();

    const rows = await savedRows(database, ws, YEAR);
    expect(rows.find((row) => row.name === 'Antam gold bars')).toMatchObject({ costMinor: 18_600_000 });
  });

  it('refuses to freeze a year twice, naming it', async () => {
    await freezeReport(database, ws, YEAR);

    await expect(freezeReport(database, ws, YEAR)).rejects.toThrow(/2026/);
  });

  it('refuses to freeze a year that has no report yet', async () => {
    await expect(freezeReport(database, ws, 2025)).rejects.toThrow(/2025/);
  });
});

describe('what changed after the freeze', () => {
  it('lists a backdated purchase as a difference, row by row', async () => {
    await freezeReport(database, ws, YEAR);
    await backdatedBuy();

    const differences = await rowDifferences(database, ws, YEAR);
    expect(differences.length).toBeGreaterThan(0);
    expect(differences[0]).toMatchObject({ name: 'Antam gold bars', field: 'costMinor', savedMinor: 18_600_000, ledgerMinor: 27_900_000 });
  });

  it('has nothing to report when the ledger has not moved', async () => {
    await freezeReport(database, ws, YEAR);

    await expect(rowDifferences(database, ws, YEAR)).resolves.toEqual([]);
  });

  it('takes the ledger figure when the owner accepts it, and marks the row edited', async () => {
    await freezeReport(database, ws, YEAR);
    await backdatedBuy();

    await acceptLedgerValue(database, ws, YEAR, gold.id);

    const rows = await savedRows(database, ws, YEAR);
    expect(rows.find((row) => row.name === 'Antam gold bars')).toMatchObject({ costMinor: 27_900_000, source: 'edited' });
    await expect(rowDifferences(database, ws, YEAR)).resolves.toEqual([]);
  });

  it('says nothing about a draft, which follows the ledger anyway', async () => {
    await expect(rowDifferences(database, ws, YEAR)).resolves.toEqual([]);
  });
});

describe('a filed report', () => {
  it('is read-only', async () => {
    await freezeReport(database, ws, YEAR);
    await markFiled(database, ws, YEAR, '2027-03-20');

    await expect(reportFor(database, ws, YEAR)).resolves.toMatchObject({ status: 'filed', filedOn: '2027-03-20' });
    await expect(freezeReport(database, ws, YEAR)).rejects.toThrow(/filed/i);
    await expect(acceptLedgerValue(database, ws, YEAR, gold.id)).rejects.toThrow(/filed/i);
  });

  it('cannot be filed before it is frozen', async () => {
    await expect(markFiled(database, ws, YEAR, '2027-03-20')).rejects.toThrow(/frozen/i);
  });

  it('keeps its rows for next year to carry over from', async () => {
    await freezeReport(database, ws, YEAR);
    await markFiled(database, ws, YEAR, '2027-03-20');

    const rows = await savedRows(database, ws, YEAR);
    expect(rows.length).toBeGreaterThan(0);
  });
});
