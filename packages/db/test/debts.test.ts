import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  DebtDbError,
  getDebtProfile,
  listDebtProfiles,
  migrate,
  MIGRATIONS,
  saveDebtProfile,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let andi: AccountRow;
let budi: AccountRow;
let bca: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  andi = await createAccount(database, ws, { name: 'Andi', kind: 'asset', subtype: 'receivable', currency: 'IDR' });
  budi = await createAccount(database, ws, { name: 'Budi', kind: 'liability', subtype: 'payable', currency: 'IDR' });
});

describe('migration 0010', () => {
  it('applies on a database already populated through version 9', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 9));
    const olderWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    // No opening balance: the ORM always describes the newest columns, and a v9 database has none of 0010's.
    const person = await createAccount(older, olderWs, { name: 'Andi', kind: 'asset', subtype: 'receivable', currency: 'IDR' });

    await migrate(older);

    await saveDebtProfile(older, olderWs, { accountId: person.id, personName: 'Andi' });
    await expect(getDebtProfile(older, olderWs, person.id)).resolves.toMatchObject({ personName: 'Andi' });
  });
});

describe('debt profiles', () => {
  it('keeps who the person is and why they owe it', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi', reason: 'Motorcycle repair', dueOn: '2026-12-31', personIdNumber: '3174010101900001' });

    await expect(getDebtProfile(database, ws, andi.id)).resolves.toMatchObject({
      personName: 'Andi',
      reason: 'Motorcycle repair',
      dueOn: '2026-12-31',
      personIdNumber: '3174010101900001',
      status: 'open',
      direction: 'lent',
    });
  });

  it('reads the direction from the account, so a payable is money you owe', async () => {
    await saveDebtProfile(database, ws, { accountId: budi.id, personName: 'Budi' });

    await expect(getDebtProfile(database, ws, budi.id)).resolves.toMatchObject({ direction: 'borrowed' });
  });

  it('gives each direction its own Coretax code', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi' });
    await saveDebtProfile(database, ws, { accountId: budi.id, personName: 'Budi' });

    await expect(getDebtProfile(database, ws, andi.id)).resolves.toMatchObject({ coretaxCode: '0201' });
    await expect(getDebtProfile(database, ws, budi.id)).resolves.toMatchObject({ coretaxCode: '109' });
  });

  it('keeps a related-party code when one is given', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi', coretaxCode: '0202' });

    await expect(getDebtProfile(database, ws, andi.id)).resolves.toMatchObject({ coretaxCode: '0202' });
  });

  it('saves again in place instead of adding a second profile', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi', reason: 'Motorcycle repair' });
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi Pratama', reason: 'Motorcycle repair', dueOn: '2027-01-31' });

    const profiles = await listDebtProfiles(database, ws);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ personName: 'Andi Pratama', dueOn: '2027-01-31' });
  });

  it('refuses an account that is not a receivable or a payable', async () => {
    await expect(saveDebtProfile(database, ws, { accountId: bca.id, personName: 'Andi' })).rejects.toThrow(DebtDbError);
    await expect(saveDebtProfile(database, ws, { accountId: bca.id, personName: 'Andi' })).rejects.toThrow(/lent to or borrowed from a person/);
  });

  it('refuses an account from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Other', type: 'personal', baseCurrency: 'IDR' });

    await expect(saveDebtProfile(database, other, { accountId: andi.id, personName: 'Andi' })).rejects.toThrow(/not found in this workspace/);
  });

  it('refuses a person with no name', async () => {
    await expect(saveDebtProfile(database, ws, { accountId: andi.id, personName: '  ' })).rejects.toThrow(/needs a name/);
  });

  it('lists nothing for a workspace with no debts', async () => {
    await expect(listDebtProfiles(database, ws)).resolves.toEqual([]);
  });
});
