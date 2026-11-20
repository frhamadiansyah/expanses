import { findEntry } from '@expanses/catalog';
import { isoDate, type ItemSummary, summaryHash } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  applyCatalogEntry,
  confirmReview,
  createAccount,
  createCardAccount,
  customiseFromScratch,
  listPrograms,
  openPocketedAccount,
  runSharedBookRepairs,
  saveAssetProfile,
  saveCardIdentity,
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

  it('a joint pocket carries its account’s bank and tier, as the holder’s Wallet draws the account', async () => {
    const { home, rina, andi, groupBookId } = await sharing();
    const { parent, pockets } = await openPocketedAccount(rina.database, rina.ws, {
      item: 'savings',
      name: 'Tabungan Bersama',
      pockets: [
        { currency: 'IDR', openingBalanceMinor: 2_500_000 },
        { currency: 'USD', openingBalanceMinor: 40_00, openingRateToBase: 15_700 },
      ],
    });
    const [idr, usd] = pockets as [(typeof pockets)[0], (typeof pockets)[0]];
    await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total', [rina.usd]: 'hidden', [idr.id]: 'total', [usd.id]: 'total' });
    await setJointAccount(rina.database, usd.id, true);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, usd.id))?.face).toBeUndefined();

    // The bank on the first pocket's profile and the tier on the account, as the holder's Wallet reads them for its card:
    // the USD pocket goes out again though neither write touched it.
    await bankOf(rina, idr.id, 'Bank Contoh Raya');
    await setAccountCardTier(rina.database, rina.ws, parent.id, 'gold');
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, usd.id))?.face).toEqual({ bank: 'Bank Contoh Raya', tier: 'gold' });
    // Only the joint pocket carries one.
    expect((await itemOn(andi, groupBookId, rina, idr.id))?.face).toBeUndefined();
  });

  it('the one-time repair sends nothing for a phone whose faces have not changed, however old its summaries', async () => {
    const { home, rina, andi, bookId } = await sharing();
    const before = await everythingOn(andi);
    // A day later, with no joint account: nothing goes out, so the one-time note has nothing to count.
    const later = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect((await runSharedBookRepairs(rina.database, bookId, { today: later })).cardFaces).toBe(0);
    await settle(home);
    expect(await everythingOn(andi)).toBe(before);

    // A joint account whose face was already sent: still nothing.
    await setJointAccount(rina.database, rina.bank, true);
    await setAccountCardTier(rina.database, rina.ws, rina.bank, 'gold');
    await settle(home);
    const sent = await everythingOn(andi);
    expect((await runSharedBookRepairs(andi.database, bookId, { today: later })).cardFaces).toBe(0);
    await settle(home);
    expect(await everythingOn(rina)).toContain('"tier":"gold"');
    expect(await everythingOn(andi)).toBe(sent);
  });
});

/*
 * A joint credit card's face on the partner's phone (fix/joint-card-face, owner 20 Nov: "the joint account shared
 * already shows its card art on the other phone, but the credit card doesn't yet"). The holder's Wallet draws a credit
 * card from its catalogue product's look and its issuer; only a joint money account's summary carried a face, so the
 * partner's phone drew the plain card. A joint card's summary now carries its issuer and its catalogue entry — the
 * product the art is drawn from, a public id the app ships with — and nothing else of the card. Digits and names here
 * are invented; the entry is the shipped catalogue's.
 */
describe('a joint credit card’s face on the partner’s phone', () => {
  const ENTRY = 'bca-sq-krisflyer-visa-signature';

  async function jointCard() {
    const s = await sharing();
    const card = await createCardAccount(s.rina.database, s.rina.ws, { name: 'Rina Kartu', subtype: 'credit_card', currency: 'IDR', last4: '7302' });
    await setShareSetting(s.rina.database, card.id, 'total');
    return { ...s, card: card.id };
  }

  it('carries the card’s issuer and its catalogue product, and follows a new product, a new issuer and a product taken off', async () => {
    const { home, rina, andi, groupBookId, card } = await jointCard();
    await setJointAccount(rina.database, card, true);
    await applyCatalogEntry(rina.database, rina.ws, { cardAccountId: card, entry: findEntry(ENTRY)!, today, replaceManual: false });
    await settle(home);
    const item = await itemOn(andi, groupBookId, rina, card);
    expect(item?.joint).toBe(true);
    expect(item?.name).toBe('Rina Kartu ···· 7302');
    expect(item?.face).toEqual({ bank: 'BCA', entry: ENTRY });

    await saveCardIdentity(rina.database, rina.ws, { accountId: card, issuer: 'Bank Contoh Raya' });
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, card))?.face).toEqual({ bank: 'Bank Contoh Raya', entry: ENTRY });

    const [program] = (await listPrograms(rina.database, rina.ws)).filter((p) => p.cardAccountId === card);
    await customiseFromScratch(rina.database, rina.ws, program!.id);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, card))?.face).toEqual({ bank: 'Bank Contoh Raya' });
  });

  it('never sends a card’s face while the card is merely shared, nor once Joint card is off', async () => {
    const { home, rina, andi, groupBookId, card } = await jointCard();
    await applyCatalogEntry(rina.database, rina.ws, { cardAccountId: card, entry: findEntry(ENTRY)!, today, replaceManual: false });
    await settle(home);
    expect(await itemOn(andi, groupBookId, rina, card)).toBeDefined();
    expect((await itemOn(andi, groupBookId, rina, card))?.face).toBeUndefined();
    expect(await everythingOn(andi)).not.toContain(ENTRY);

    await setJointAccount(rina.database, card, true);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, card))?.face).toEqual({ bank: 'BCA', entry: ENTRY });
    await setJointAccount(rina.database, card, false);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, card))?.face).toBeUndefined();
  });

  it('a card made joint before this build reaches the partner with its face through the one-time repair, once', async () => {
    const { home, rina, andi, bookId, groupBookId, card } = await jointCard();
    await applyCatalogEntry(rina.database, rina.ws, { cardAccountId: card, entry: findEntry(ENTRY)!, today, replaceManual: false });
    await setJointAccount(rina.database, card, true);
    await settle(home);
    // As an older build left it: the summary sent without a face, its hash kept as sent, and R4 long since run.
    const itemId = await itemIdOf(groupBookId, card);
    const [row] = await rina.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE item_id = ${itemId}`);
    const { face: _face, ...older } = JSON.parse(row![0]) as ItemSummary & Record<string, unknown>;
    for (const d of [rina, andi]) await d.database.db.run(sql`UPDATE nw_items SET summary_json = ${JSON.stringify(older)} WHERE item_id = ${itemId}`);
    await rina.database.db.run(sql`UPDATE nw_sent SET summary_hash = ${summaryHash(older)} WHERE item_id = ${itemId}`);
    for (const d of [rina, andi]) await d.database.db.run(sql`INSERT INTO settings (key, value) VALUES (${`repair.card-faces.v1.${bookId}`}, '2026-11-01T00:00:00.000Z')`);
    expect((await itemOn(andi, groupBookId, rina, card))?.face).toBeUndefined();

    const first = await runSharedBookRepairs(rina.database, bookId, { today });
    expect(first.cardFaces).toBeNull();
    expect(first.creditCardFaces).toBe(1);
    await settle(home);
    expect((await itemOn(andi, groupBookId, rina, card))?.face).toEqual({ bank: 'BCA', entry: ENTRY });

    // Once per phone: a second run sends nothing, and the partner's own run has nothing of its own to send.
    expect((await runSharedBookRepairs(rina.database, bookId, { today })).creditCardFaces).toBeNull();
    expect((await runSharedBookRepairs(andi.database, bookId, { today })).creditCardFaces).toBe(0);
  });

  it('a partner reads a card’s face defensively: an entry that is no catalogue id is dropped, the item still read', async () => {
    const { home, rina, andi, groupBookId, card } = await jointCard();
    await setJointAccount(rina.database, card, true);
    await applyCatalogEntry(rina.database, rina.ws, { cardAccountId: card, entry: findEntry(ENTRY)!, today, replaceManual: false });
    await settle(home);
    const itemId = await itemIdOf(groupBookId, card);
    const [row] = await andi.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE item_id = ${itemId}`);
    const stored = JSON.parse(row![0]) as Record<string, unknown>;
    await andi.database.db.run(sql`UPDATE nw_items SET summary_json = ${JSON.stringify({ ...stored, face: { entry: 'Not An Id!', other: 'x' } })} WHERE item_id = ${itemId}`);
    const read = await itemOn(andi, groupBookId, rina, card);
    expect(read?.joint).toBe(true);
    expect(read?.face).toBeUndefined();
  });
});
