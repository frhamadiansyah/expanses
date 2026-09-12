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
    await createAccount(older, workspace, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 48_250_000, openedOn: '2026-01-01' });

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
      coretaxCode: '0702',
      coretaxFields: { cert: 'Antam certificates', info: 'Emas batangan Antam' },
    });

    const profile = await getAssetProfile(database, ws, goldId);
    expect(profile).toMatchObject({ acquiredYear: 2022, coretaxCode: '0702' });
    expect(profile!.coretaxFields).toEqual({ cert: 'Antam certificates', info: 'Emas batangan Antam' });
  });

  it('refuses a Coretax code that is not four digits', async () => {
    await expect(saveAssetProfile(database, ws, { accountId: goldId, assetKind: 'gold', coretaxCode: '070' })).rejects.toThrow();
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
