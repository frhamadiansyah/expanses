import { describe, expect, it } from 'vitest';
import {
  coretaxInputsFor,
  createAccount,
  getAssetProfile,
  netWorthAt,
  recordValuation,
  saveAssetProfile,
  setAssetReporting,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = 2026;
const TODAY = '2026-09-13';

/** BPJS JHT: money that is yours, valued by hand, and not reported until it is paid out. */
async function jht() {
  const { database, ws } = await setupDb();
  const account = await createAccount(database, ws, { name: 'BPJS JHT', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'other' });
  await recordValuation(database, ws, { accountId: account.id, asOf: TODAY, valueMinor: 50_000_000, basis: 'estimate' });
  return { database, ws, account };
}

const inReport = async (database: Database, ws: WorkspaceContext, accountId: string) => {
  const inputs = await coretaxInputsFor(database, ws, YEAR);
  return [...inputs.cash, ...inputs.holdings, ...inputs.estimated, ...inputs.receivables].some((row) => row.accountId === accountId);
};

describe('an asset the tax office should not see', () => {
  it('is reported by default, as everything else is', async () => {
    const { database, ws, account } = await jht();

    expect(await getAssetProfile(database, ws, account.id)).toMatchObject({ reportable: true });
    expect(await inReport(database, ws, account.id)).toBe(true);
  });

  it('drops out of the report once it is marked not reportable', async () => {
    const { database, ws, account } = await jht();

    await setAssetReporting(database, ws, account.id, { reportable: false });

    expect(await inReport(database, ws, account.id)).toBe(false);
  });

  it('still counts toward net worth, because the money is yours', async () => {
    const { database, ws, account } = await jht();
    await setAssetReporting(database, ws, account.id, { reportable: false });

    const worth = await netWorthAt(database, ws, TODAY, {});

    expect(worth.assetsMinor).toBe(50_000_000);
  });

  it('comes back into the report when it is turned on again', async () => {
    const { database, ws, account } = await jht();
    await setAssetReporting(database, ws, account.id, { reportable: false });

    await setAssetReporting(database, ws, account.id, { reportable: true });

    expect(await inReport(database, ws, account.id)).toBe(true);
  });
});

describe('choosing the code yourself', () => {
  it('keeps the code the owner picked instead of the preset', async () => {
    const { database, ws } = await setupDb();
    const account = await createAccount(database, ws, { name: 'DPLK Manulife', kind: 'asset', subtype: 'investment', currency: 'IDR' });

    // DJP says DPLK is not specially regulated: pick kas, setara kas, or an investasi code to match.
    await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'other', coretaxSection: 'kas', coretaxCode: '0109' });
    await recordValuation(database, ws, { accountId: account.id, asOf: TODAY, valueMinor: 20_000_000, basis: 'estimate' });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.estimated.find((row) => row.accountId === account.id)).toMatchObject({ code: '0109' });
  });

  it('can be changed later without touching anything else on the asset', async () => {
    const { database, ws, account } = await jht();

    await setAssetReporting(database, ws, account.id, { coretaxCode: '0102', coretaxSection: 'kas' });

    expect(await getAssetProfile(database, ws, account.id)).toMatchObject({ coretaxCode: '0102', coretaxSection: 'kas', assetKind: 'other' });
  });

  it('refuses a code that is not four digits', async () => {
    const { database, ws, account } = await jht();

    await expect(setAssetReporting(database, ws, account.id, { coretaxCode: '019' })).rejects.toThrow();
  });
});
