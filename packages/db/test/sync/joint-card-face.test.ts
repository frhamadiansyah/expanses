import { isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  confirmReview,
  createAccount,
  runSharedBookRepairs,
  saveAssetProfile,
  setAccountCardTier,
  setAccountNumberLast4,
  setJointAccount,
  setShareSetting,
} from '../../src/index';
import { itemIdOf, receivedItems } from '../../src/sync/net-worth/summaries';
import { Household, type Device } from './household';

/*
 * A joint money account's card face on the partner's phone (fix/sync-card-tier). Wallet draws an own account's face
 * from its bank (the profile's Nama institusi), its own name and its card tier (0087), with its number's last four
 * (0080) when it has no card; the partner's phone drew a joint account from its name alone, so the two phones showed
 * different faces. The holder's summary now carries those inputs — for a joint account only, never for anything else.
 * Every bank name and digit here is invented.
 */

const today = isoDate();

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina and Andi in one workspace and one net-worth group, each sharing their bank account with the other. */
async function sharing() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total', [rina.usd]: 'hidden' });
  await confirmReview(andi.database, andi.ws, { [andi.bank]: 'total' });
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  return { home, rina, andi, bookId, groupBookId };
}

async function itemOn(d: Device, groupBookId: string, owner: Device, accountId: string) {
  const itemId = await itemIdOf(groupBookId, accountId);
  return (await receivedItems(d.database, groupBookId)).find((i) => i.itemId === itemId && i.owner === owner.memberId);
}

/** Every summary another phone holds, as text: what a private account must never be found in. */
async function everythingOn(d: Device): Promise<string> {
  const rows = await d.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items`);
  return rows.map(([json]) => json).join('\n');
}

const bankOf = (d: Device, accountId: string, bank: string) => saveAssetProfile(d.database, d.ws, { accountId, assetKind: 'cash', coretaxFields: { inst: bank } });

describe('a joint account’s card face on the partner’s phone', () => {
  it('carries the bank, the tier and the account digits the holder set, and follows a change and a clear', async () => {
    const { home, rina, andi, groupBookId } = await sharing();
    await setJointAccount(rina.database, rina.bank, true);
    await bankOf(rina, rina.bank, 'Bank Contoh Raya');
    await setAccountCardTier(rina.database, rina.ws, rina.bank, 'gold');
    await setAccountNumberLast4(rina.database, rina.ws, rina.bank, '4096');
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, rina.bank))?.face).toEqual({ bank: 'Bank Contoh Raya', tier: 'gold', last4: '4096' });

    await setAccountCardTier(rina.database, rina.ws, rina.bank, 'platinum');
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, rina.bank))?.face?.tier).toBe('platinum');

    await setAccountCardTier(rina.database, rina.ws, rina.bank, null);
    await setAccountNumberLast4(rina.database, rina.ws, rina.bank, null);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, rina.bank))?.face).toEqual({ bank: 'Bank Contoh Raya' });
  });

  it('goes the other way too: the partner’s joint account reaches the owner’s phone', async () => {
    const { home, rina, andi, groupBookId } = await sharing();
    await setJointAccount(andi.database, andi.bank, true);
    await setAccountCardTier(andi.database, andi.ws, andi.bank, 'prioritas');
    await settle(home);
    expect((await itemOn(rina, groupBookId, andi, andi.bank))?.face).toEqual({ tier: 'prioritas' });
  });

  it('leaves the account digits out when a card’s digits are already in its name', async () => {
    const { home, rina, andi, groupBookId } = await sharing();
    await setJointAccount(rina.database, rina.bank, true);
    await rina.database.db.run(
      sql`INSERT INTO cards (id, workspace_id, account_id, last4, holder_name, is_primary, created_at) VALUES ('card-1', ${rina.ws.workspaceId}, ${rina.bank}, '2718', NULL, 1, '2026-01-01T00:00:00.000Z')`,
    );
    await setAccountNumberLast4(rina.database, rina.ws, rina.bank, '4096');
    await settle(home);
    const item = await itemOn(andi, groupBookId, rina, rina.bank);
    expect(item?.name).toBe('Rina Bank ···· 2718');
    expect(item?.face).toBeUndefined();
  });

  it('never sends the face of an account that is not joint, nor of one that is not shared at all', async () => {
    const { home, rina, andi, groupBookId } = await sharing();
    // Shared, but not joint: its summary is what it always was.
    await bankOf(rina, rina.bank, 'Bank Contoh Raya');
    await setAccountCardTier(rina.database, rina.ws, rina.bank, 'gold');
    await setAccountNumberLast4(rina.database, rina.ws, rina.bank, '4096');
    // Hidden from the household: nothing of it travels.
    await bankOf(rina, rina.usd, 'Bank Rahasia Jauh');
    await setAccountCardTier(rina.database, rina.ws, rina.usd, 'platinum');
    await setAccountNumberLast4(rina.database, rina.ws, rina.usd, '8191');
    // An account never reviewed for sharing at all.
    const savings = await createAccount(rina.database, rina.ws, { name: 'Rina Tabungan Pribadi', kind: 'asset', subtype: 'savings', currency: 'IDR' });
    await setAccountCardTier(rina.database, rina.ws, savings.id, 'prioritas');
    await setAccountNumberLast4(rina.database, rina.ws, savings.id, '6553');
    await settle(home);

    const shared = await itemOn(andi, groupBookId, rina, rina.bank);
    expect(shared).toBeDefined();
    expect(shared?.face).toBeUndefined();
    expect(await itemOn(andi, groupBookId, rina, rina.usd)).toBeUndefined();
    expect(await itemOn(andi, groupBookId, rina, savings.id)).toBeUndefined();
    const held = await everythingOn(andi);
    for (const secret of ['Bank Contoh Raya', 'Bank Rahasia Jauh', 'gold', 'platinum', 'prioritas', '4096', '8191', '6553', 'Pribadi']) expect(held).not.toContain(secret);
  });

  it('a tier set before this build reaches the partner through the one-time repair, once', async () => {
    const { home, rina, andi, bookId, groupBookId } = await sharing();
    await setJointAccount(rina.database, rina.bank, true);
    await settle(home);
    // As an older build kept it: written on the account, never marked for a send.
    await rina.database.db.run(sql`UPDATE accounts SET card_tier = 'gold', number_last4 = '4096' WHERE id = ${rina.bank}`);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, rina.bank))?.face).toBeUndefined();

    const first = await runSharedBookRepairs(rina.database, bookId, { today });
    expect(first.cardFaces).toBe(1);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, rina.bank))?.face).toEqual({ tier: 'gold', last4: '4096' });

    // Once per phone: a second run sends nothing, and the partner's own run has nothing of its own to send.
    expect((await runSharedBookRepairs(rina.database, bookId, { today })).cardFaces).toBeNull();
    expect((await runSharedBookRepairs(andi.database, bookId, { today })).cardFaces).toBe(0);
    expect((await runSharedBookRepairs(andi.database, bookId, { today })).cardFaces).toBeNull();
  });

  it('a partner on an older build keeps the face in the summary it holds and still reads the item', async () => {
    const { home, rina, andi, groupBookId } = await sharing();
    await setJointAccount(rina.database, rina.bank, true);
    await setAccountCardTier(rina.database, rina.ws, rina.bank, 'gold');
    await settle(home);
    const itemId = await itemIdOf(groupBookId, rina.bank);
    const [row] = await andi.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE item_id = ${itemId}`);
    const stored = JSON.parse(row![0]) as Record<string, unknown>;
    expect(stored.face).toEqual({ tier: 'gold' });
    // A peer's face is read defensively: anything that is not a short word, a short name or four digits is dropped.
    await andi.database.db.run(
      sql`UPDATE nw_items SET summary_json = ${JSON.stringify({ ...stored, face: { bank: 'x'.repeat(200), tier: 'Gold!', last4: '12345' } })} WHERE item_id = ${itemId}`,
    );
    const read = await itemOn(andi, groupBookId, rina, rina.bank);
    expect(read?.joint).toBe(true);
    expect(read?.face).toBeUndefined();
  });

  it('turning Joint off takes the face away with it', async () => {
    const { home, rina, andi, groupBookId } = await sharing();
    await setJointAccount(rina.database, rina.bank, true);
    await setAccountCardTier(rina.database, rina.ws, rina.bank, 'gold');
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, rina.bank))?.face).toEqual({ tier: 'gold' });
    await setJointAccount(rina.database, rina.bank, false);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, rina.bank))?.face).toBeUndefined();
    await setShareSetting(rina.database, rina.bank, 'hidden');
    await settle(home);
    expect(await itemOn(andi, groupBookId, rina, rina.bank)).toBeUndefined();
  });
});
