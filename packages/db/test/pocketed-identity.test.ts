import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, getAssetProfile, listAccounts, openPocketedAccount, renameAccount, setPocketedIdentity, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

const valas = () =>
  openPocketedAccount(database, ws, {
    item: 'savings',
    name: 'Multi',
    bank: 'BCA',
    openedOn: '2025-02-04',
    pockets: [
      { currency: 'USD', openingBalanceMinor: 240_000, openingRateToBase: 15_940 },
      { currency: 'SGD', openingBalanceMinor: 115_000, openingRateToBase: 12_110.5 },
    ],
  });

describe('the Bank, Group and Description of an account with pockets', () => {
  it('are kept by every pocket, which is what the reports read, and the parent is given no profile', async () => {
    const { parent, pockets } = await valas();
    await setPocketedIdentity(database, ws, parent.id, { planGroup: 'invest', coretaxCode: '0199', inst: ' Bank Two ' });
    for (const pocket of pockets) {
      const profile = await getAssetProfile(database, ws, pocket.id);
      expect(profile).toMatchObject({ planGroup: 'invest', coretaxCode: '0199' });
      expect(profile?.coretaxFields.inst).toBe('Bank Two');
    }
    expect(await getAssetProfile(database, ws, parent.id)).toBeUndefined();
  });

  it('leave what a pocket has of its own alone, and an emptied bank is removed from all', async () => {
    const { parent, pockets } = await valas();
    await setPocketedIdentity(database, ws, parent.id, { coretaxCode: null });
    const before = await getAssetProfile(database, ws, pockets[0]!.id);
    expect(before?.coretaxCode).toBeNull();
    expect(before?.coretaxFields.inst).toBe('BCA');
    await setPocketedIdentity(database, ws, parent.id, { inst: '' });
    for (const pocket of pockets) expect((await getAssetProfile(database, ws, pocket.id))?.coretaxFields.inst).toBeUndefined();
  });

  it('a change of bank shows on the account and every pocket, and a rename follows into the pockets’ names', async () => {
    const { parent, pockets } = await valas();
    await setPocketedIdentity(database, ws, parent.id, { inst: 'Bank Two' });
    await renameAccount(database, ws, parent.id, 'Valas Max');
    const rows = await listAccounts(database, ws);
    for (const id of [parent.id, ...pockets.map((p) => p.id)]) expect(rows.find((a) => a.id === id)?.bank).toBe('Bank Two');
    expect(rows.find((a) => a.id === pockets[0]!.id)?.typedName ?? rows.find((a) => a.id === pockets[0]!.id)?.name).toContain('Valas Max');
  });

  it('refuses a pocket, which takes them from its account', async () => {
    const { pockets } = await valas();
    await expect(setPocketedIdentity(database, ws, pockets[0]!.id, { planGroup: 'liquid' })).rejects.toThrow('takes these from its account');
  });
});
