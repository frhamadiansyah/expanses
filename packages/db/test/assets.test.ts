import { presetFor } from '@expanses/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  ensureCategoryKeys,
  getAssetProfile,
  listAccounts,
  listAssetProfiles,
  migrate,
  MIGRATIONS,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let goldId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  goldId = gold.id;
});

describe('migration 0007', () => {
  it('is version 7 and named assets', () => {
    expect(MIGRATIONS.find((m) => m.version === 7)).toMatchObject({ name: 'assets' });
  });

  it('applies on a database already populated through version 6', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 6));
    const workspace = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    // No opening balance here: the ORM always describes the newest columns, so posting a transaction
    // into an older database would name columns that version does not have yet.
    await createAccount(older, workspace, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });

    const applied = await migrate(older);

    expect(applied).toContain(7);
    const accounts = await listAccounts(older, workspace);
    expect(accounts.some((a) => a.name === 'BCA Tahapan')).toBe(true);
    await expect(listAssetProfiles(older, workspace)).resolves.toEqual([]);
  });
});

describe('asset profiles', () => {
  it('writes the defaults of the chosen preset', async () => {
    await saveAssetProfile(database, ws, { accountId: goldId, assetKind: 'gold' });

    const profile = await getAssetProfile(database, ws, goldId);
    const preset = presetFor('gold');
    expect(profile).toMatchObject({
      accountId: goldId,
      assetKind: 'gold',
      planGroup: preset.planGroup,
      unitKind: preset.unitKind,
      risk: preset.risk,
      coretaxSection: preset.coretaxSection,
      coretaxCode: preset.coretaxCode,
      coretaxFields: {},
    });
  });

  it('keeps what the owner changed', async () => {
    await saveAssetProfile(database, ws, { accountId: goldId, assetKind: 'gold' });
    await saveAssetProfile(database, ws, {
      accountId: goldId,
      assetKind: 'gold',
      acquiredYear: 2022,
      coretaxCode: '052',
      coretaxFields: { cert: 'Antam certificates', info: 'Emas batangan Antam' },
    });

    const profile = await getAssetProfile(database, ws, goldId);
    expect(profile).toMatchObject({ acquiredYear: 2022, coretaxCode: '052' });
    expect(profile!.coretaxFields).toEqual({ cert: 'Antam certificates', info: 'Emas batangan Antam' });
  });

  it('refuses a Coretax code that is not three digits', async () => {
    // 0701 was the placeholder shape this project used before the codes were checked.
    await expect(saveAssetProfile(database, ws, { accountId: goldId, assetKind: 'gold', coretaxCode: '0701' })).rejects.toThrow();
  });

  it('refuses an account from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(saveAssetProfile(database, other, { accountId: goldId, assetKind: 'gold' })).rejects.toThrow();
  });

  it('lists only this workspace', async () => {
    await saveAssetProfile(database, ws, { accountId: goldId, assetKind: 'gold' });
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });

    await expect(listAssetProfiles(database, other)).resolves.toEqual([]);
    await expect(listAssetProfiles(database, ws)).resolves.toHaveLength(1);
  });
});

describe('category keys', () => {
  it('adds Realized Gains and Final Tax, once', async () => {
    await ensureCategoryKeys(database, ws);
    await ensureCategoryKeys(database, ws);

    const accounts = await listAccounts(database, ws, { includeArchived: true });
    const keys = accounts.filter((a) => a.systemKey === 'income.realized_gains' || a.systemKey === 'government.final_tax');
    expect(keys).toHaveLength(2);
    expect(keys.find((a) => a.systemKey === 'income.realized_gains')!.kind).toBe('income');
    const finalTax = keys.find((a) => a.systemKey === 'government.final_tax')!;
    expect(finalTax.kind).toBe('expense');
    expect(accounts.find((a) => a.id === finalTax.parentId)!.systemKey).toBe('government');
  });
});

import { listGoals, saveGoal, setAssetGroup, setLotSize } from '../src/index';

describe('migration 0009', () => {
  it('is version 9 and named buy_flow', () => {
    expect(MIGRATIONS.find((migration) => migration.version === 9)).toMatchObject({ name: 'buy_flow' });
  });

  it('applies on a database already populated through version 8 and keeps goals and profiles', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 8));
    const workspace = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const account = await createAccount(older, workspace, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveGoal(older, workspace, {
      name: 'Hajj for two',
      kind: 'hajj',
      growthBps: 500,
      returnBps: 600,
      stages: [{ name: 'Setoran awal', targetMinor: 50_000_000, targetMonths: null, dueOn: '2027-06-30' }],
    });

    const applied = await migrate(older);
    // Written after the upgrade: a version 8 table still demands a four-digit Coretax code.
    await saveAssetProfile(older, workspace, { accountId: account.id, assetKind: 'gold' });

    expect(applied).toContain(9);
    await expect(listAssetProfiles(older, workspace)).resolves.toHaveLength(1);
    await expect(listGoals(older, workspace)).resolves.toHaveLength(1);
  });
});

describe('asset settings', () => {
  it('moves broker cash out of the emergency buffer and into investments', async () => {
    const rdn = await createAccount(database, ws, { name: 'RDN cash', kind: 'asset', subtype: 'bank', currency: 'IDR' });

    await setAssetGroup(database, ws, rdn.id, 'invest');

    const profile = await getAssetProfile(database, ws, rdn.id);
    expect(profile).toMatchObject({ planGroup: 'invest' });
  });

  it('keeps the rest of a profile when only the group changes', async () => {
    await saveAssetProfile(database, ws, { accountId: goldId, assetKind: 'gold', coretaxFields: { info: 'Emas batangan Antam' } });

    await setAssetGroup(database, ws, goldId, 'use');

    const profile = await getAssetProfile(database, ws, goldId);
    expect(profile).toMatchObject({ planGroup: 'use', assetKind: 'gold', coretaxCode: '051' });
    expect(profile!.coretaxFields).toEqual({ info: 'Emas batangan Antam' });
  });

  it('refuses a group it does not know', async () => {
    // @ts-expect-error the group must be one of the four on the balance sheet
    await expect(setAssetGroup(database, ws, goldId, 'somewhere')).rejects.toThrow(/Unknown group/);
  });

  it('stores 100 shares a lot for an IDX stock and 1 for a US stock', async () => {
    const bbri = await createAccount(database, ws, { name: 'BBRI shares', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    const vti = await createAccount(database, ws, { name: 'VTI shares', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: bbri.id, assetKind: 'stock' });
    await saveAssetProfile(database, ws, { accountId: vti.id, assetKind: 'stock' });

    await setLotSize(database, ws, bbri.id, 100);
    await setLotSize(database, ws, vti.id, 1);

    expect((await getAssetProfile(database, ws, bbri.id))!.lotSize).toBe(100);
    expect((await getAssetProfile(database, ws, vti.id))!.lotSize).toBe(1);
  });

  it('refuses a lot of zero and asks for the asset first', async () => {
    await saveAssetProfile(database, ws, { accountId: goldId, assetKind: 'gold' });
    await expect(setLotSize(database, ws, goldId, 0)).rejects.toThrow(/one share or more/);

    const fresh = await createAccount(database, ws, { name: 'Unset holding', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await expect(setLotSize(database, ws, fresh.id, 100)).rejects.toThrow(/Add this asset first/);
  });

  it('refuses an account from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(setAssetGroup(database, other, goldId, 'invest')).rejects.toThrow();
  });
});
