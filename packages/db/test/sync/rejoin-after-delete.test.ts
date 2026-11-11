import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, deleteBook, heldElsewhereOf, inBook, personalBook, planBookDelete, postTransaction } from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { HELD_PREFIX } from '../../src/sync/held';
import { categoryOf, copyBookUnderNewIdForTest, Household, memberOf, projectBook, skipsOf, type Device } from './household';

/*
 * Sharing resilience Task A9, the acceptance test: the couple's whole path (spec §1, §11, §12), with invented figures.
 *
 * Dewi records a few purchases, then shares her workspace (share 1) and Fandri joins; both record six purchases. Her
 * phone then goes back to a copy taken before the share, on the same device, with no share record (as on a pre-A
 * build): the incident. Two ways her share 2 can come:
 *
 * (i) the same book id: Fandri's copy of it is live, so the join refuses `STILL_SHARED` before the claim.
 * (ii) the couple's case, a new book id with the same rows: the join completes with `HELD_ELSEWHERE` skips, no stall.
 *
 * From (ii), the cleanup in the §11 order: she stops share 2, he deletes its empty copy; she records two new purchases
 * and shares again (share 3), inviting him as the same member; he joins first, then Leave and delete of the share-1
 * copy (Keep them in Personal on), then Place them now. A second case swaps join and delete, and its figures are kept.
 *
 * What is gone for good, and accepted (the owner does not need it back, §2): Dewi's six purchases made after share 1.
 * Her phone lost them with the restore; his copy of share 1 had them, and they go with it.
 */

const DEWI_PRE: readonly [string, string, number][] = [
  ['Dewi pre groceries', 'Groceries', 15_200],
  ['Dewi pre pharmacy', 'Pharmacy', 8_750],
  ['Dewi pre restaurant', 'Restaurants', 32_100],
];
const DEWI_SHARE1: readonly [string, string, number][] = [
  ['Dewi s1 groceries a', 'Groceries', 21_400],
  ['Dewi s1 pharmacy', 'Pharmacy', 9_900],
  ['Dewi s1 restaurant a', 'Restaurants', 47_250],
  ['Dewi s1 groceries b', 'Groceries', 5_600],
  ['Dewi s1 restaurant b', 'Restaurants', 13_800],
  ['Dewi s1 groceries c', 'Groceries', 26_300],
];
const FANDRI_SHARE1: readonly [string, string, number][] = [
  ['Fandri s1 groceries a', 'Groceries', 27_500],
  ['Fandri s1 restaurant a', 'Restaurants', 12_300],
  ['Fandri s1 pharmacy', 'Pharmacy', 6_450],
  ['Fandri s1 groceries b', 'Groceries', 18_900],
  ['Fandri s1 restaurant b', 'Restaurants', 33_700],
  ['Fandri s1 groceries c', 'Groceries', 7_150],
];
const sum = (rows: readonly [string, string, number][]) => rows.reduce((total, [, , amount]) => total + amount, 0);
const DEWI_NEW_GROCERIES = 4_400; // on Groceries, a category his share-1 copy holds
const DEWI_NEW_PET = 6_600; // on a category made after the restore, which no copy of his holds
const FANDRI_NEW = 3_300;

async function balanceOf(d: Device, accountId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(
    sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${accountId} AND t.status = 'posted'`,
  );
  return Number(row![0]);
}

/** How many posted transactions carry each description, in every workspace on the phone. */
async function postedByDescription(d: Device): Promise<Record<string, number>> {
  const rows = await d.database.db.values<[string, number]>(
    sql`SELECT description, count(*) FROM transactions WHERE status = 'posted' AND description IS NOT NULL GROUP BY description ORDER BY description`,
  );
  return Object.fromEntries(rows.map(([description, n]) => [description, Number(n)]));
}

/** The posted descriptions filed in a book, in order. */
async function filedIn(d: Device, bookId: string): Promise<string[]> {
  const rows = await d.database.db.values<[string]>(sql`
    SELECT t.description FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id
    WHERE bt.book_id = ${bookId} AND t.status = 'posted' ORDER BY t.description`);
  return rows.map(([description]) => description);
}

/** The book's hidden account for `memberId` in IDR on this phone; 0 when none. */
async function placeholderBalance(d: Device, bookId: string, memberId: string): Promise<number> {
  const [row] = await d.database.db.values<[string]>(
    sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${memberId} AND currency = 'IDR'`,
  );
  return row ? balanceOf(d, row[0]) : 0;
}

async function spend(d: Device, bookId: string, description: string, category: string, amountMinor: number): Promise<string> {
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-14',
    description,
    lines: expenseLines({ categoryAccountId: await categoryOf(d.database, bookId, category), paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

async function settleBook(devices: readonly Device[], bookId: string): Promise<void> {
  for (let round = 0; round < 2; round += 1) for (const d of devices) await d.engine.syncOnce(bookId);
}

async function stateOf(d: Device, bookId: string): Promise<string | null> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${bookId}`);
  return row?.[0] ?? null;
}

async function cursorOf(d: Device, bookId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`);
  return Number(row?.[0] ?? -1);
}

async function relayOf(d: Device, bookId: string): Promise<string> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${bookId}`);
  return row![0];
}

async function relayHead(d: Device, bookId: string): Promise<number> {
  return (await d.transport.pull(await relayOf(d, bookId), 0)).latest;
}

async function join(dewi: Device, fandri: Device, bookId: string, sameMemberId?: string) {
  const { code } = await dewi.engine.createInvite(
    bookId,
    sameMemberId === undefined ? { inviterName: dewi.name } : { inviterName: dewi.name, sameMember: true, memberId: sameMemberId },
  );
  return fandri.engine.joinBook(code, { ws: fandri.ws, memberName: fandri.name, deviceName: `${fandri.name}'s phone`, memberId: fandri.memberId });
}

/** Steps 1–2: share 1 with both recording, then the incident on her phone. */
async function incident() {
  const home = new Household();
  const dewi = await home.device('Dewi');
  const fandri = await home.device('Fandri');
  const personal = (await personalBook(dewi.database, dewi.ws)).id;
  for (const [description, category, amount] of DEWI_PRE) await spend(dewi, personal, description, category, amount);
  const preShareCopy = await dewi.database.exportBytes();

  const r1 = await home.share(dewi);
  expect(r1).toBe(personal);
  await home.join(fandri, dewi);
  for (const [description, category, amount] of DEWI_SHARE1) await spend(dewi, r1, description, category, amount);
  for (const [description, category, amount] of FANDRI_SHARE1) await spend(fandri, r1, description, category, amount);
  await home.settle();
  expect(await filedIn(fandri, r1)).toEqual(await filedIn(dewi, r1));
  expect((await filedIn(fandri, r1)).length).toBe(15);
  expect(await balanceOf(fandri, fandri.bank)).toBe(-sum(FANDRI_SHARE1));
  expect(await balanceOf(dewi, dewi.bank)).toBe(-(sum(DEWI_PRE) + sum(DEWI_SHARE1)));

  // The incident: the same phone, its database back to the copy from before the share, and no share record (a pre-A
  // build kept none). The app opens again: a new engine on the same keys checks the records and finds nothing.
  await dewi.database.importBytes(preShareCopy);
  for (const record of await dewi.records.list()) await dewi.records.remove(record.bookId);
  dewi.engine = new SyncEngine(dewi.database, dewi.transport, dewi.keys, undefined, { appVersion: '0.3.0', shareRecords: dewi.records });
  expect(await dewi.engine.checkShareRecords()).toEqual([]);
  expect(await stateOf(dewi, personal)).toBeNull();
  expect(await balanceOf(dewi, dewi.bank)).toBe(-sum(DEWI_PRE));
  // His copy stays active on share 1 with all fifteen.
  expect(await stateOf(fandri, r1)).toBe('active');
  return { home, dewi, fandri, personal, r1 };
}

/** Steps 4–7 of variant (ii): share 2 joined beside share 1 and cleaned away, two new purchases, share 3 made. */
async function toShare3() {
  const { home, dewi, fandri, personal, r1 } = await incident();
  const r1Before = await projectBook(fandri.database, r1);

  // Her workspace under a new book id with the same rows; the old book row goes.
  const b = await copyBookUnderNewIdForTest(dewi, personal);
  await dewi.database.db.run(sql`DELETE FROM books WHERE id = ${personal}`);
  expect((await personalBook(dewi.database, dewi.ws)).id).toBe(b);

  // Share 2: the join completes, rows his share-1 copy holds are set aside, nothing else is refused.
  await dewi.engine.shareBook(b, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
  const joined2 = await join(dewi, fandri, b);
  expect(joined2.result.stopped).toBeUndefined();
  await settleBook([dewi, fandri], b);
  const skips2 = await fandri.database.db.values<[string]>(sql`SELECT error FROM sync_skipped WHERE book_id = ${b}`);
  expect(skips2.length).toBeGreaterThan(0);
  for (const [error] of skips2) expect(error).toBe(`${HELD_PREFIX}: ${r1}`);
  const held2 = await heldElsewhereOf(fandri.database, b);
  expect(held2.filter((h) => h.entity === 'purchase')).toHaveLength(DEWI_PRE.length);
  expect(held2.some((h) => h.entity === 'category')).toBe(true);
  expect(await filedIn(fandri, b)).toEqual([]);
  expect(await projectBook(fandri.database, r1)).toEqual(r1Before); // never edited
  expect(await balanceOf(fandri, fandri.bank)).toBe(-sum(FANDRI_SHARE1));
  const share2Member = await memberOf(fandri.database, b);

  // Step 5: she stops share 2; his copy reads unshared, and he deletes it (empty). Nothing of his moves.
  await dewi.engine.stopSharing(b);
  await fandri.engine.syncOnce(b);
  expect(await stateOf(fandri, b)).toBe('unshared');
  expect(await planBookDelete(fandri.database, fandri.ws, b)).toMatchObject({ refusal: null, transactions: 0, ownPurchases: 0 });
  await deleteBook(fandri.database, fandri.ws, b);
  expect(await balanceOf(fandri, fandri.bank)).toBe(-sum(FANDRI_SHARE1));
  expect(await projectBook(fandri.database, r1)).toEqual(r1Before);

  // Step 6: two new purchases of hers, one on a category his share-1 copy holds, one on a category made since.
  await spend(dewi, b, 'Dewi new groceries', 'Groceries', DEWI_NEW_GROCERIES);
  await createAccount(dewi.database, inBook(dewi.ws, b), { name: 'Pet care', kind: 'expense', subtype: 'category', currency: null });
  await spend(dewi, b, 'Dewi new pet care', 'Pet care', DEWI_NEW_PET);

  // Step 7: share 3, the same workspace of hers, as the same member of hers.
  await dewi.engine.shareBook(b, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
  return { home, dewi, fandri, r1, b, share2Member };
}

/** Every purchase that should be on his phone at the end, once each. */
const EVERY_ONCE = Object.fromEntries(
  [...DEWI_PRE, ...FANDRI_SHARE1].map(([description]) => [description, 1] as const).concat([
    ['Dewi new groceries', 1],
    ['Dewi new pet care', 1],
  ]),
);

describe('the couple’s path, two phones (Task A9)', () => {
  it('variant (i): share 2 under the same book id is refused STILL_SHARED before the claim, and the relay is unchanged', async () => {
    const { home, dewi, fandri, personal, r1 } = await incident();
    const r1Relay = await relayOf(fandri, r1);
    const r1Seq = home.relay.peek(r1Relay)!.seq;
    const { relayBookId: r2 } = await dewi.engine.shareBook(personal, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
    expect(r2).not.toBe(r1Relay);
    const { code, inviteId } = await dewi.engine.createInvite(personal, { inviterName: dewi.name });
    const before = home.relay.peek(r2)!;
    const r2Seq = before.seq;
    const r2Devices = [...before.devices.keys()].sort();

    // The preview is read only and names the live copy's state; the join refuses before anything is claimed.
    const preview = await fandri.engine.previewInvite(code);
    expect(preview).toMatchObject({ bookId: personal, claimed: false, replaces: null });
    await expect(
      fandri.engine.joinBook(code, { ws: fandri.ws, memberName: fandri.name, deviceName: `${fandri.name}'s phone`, memberId: fandri.memberId }),
    ).rejects.toMatchObject({ code: 'STILL_SHARED' });

    const after = home.relay.peek(r2)!;
    expect(after.invites.get(inviteId)!.claimedAt).toBeUndefined();
    expect((await fandri.engine.previewInvite(code)).claimed).toBe(false);
    expect(after.seq).toBe(r2Seq);
    expect([...after.devices.keys()].sort()).toEqual(r2Devices);
    expect(home.relay.peek(r1Relay)!.seq).toBe(r1Seq);
    // His copy is untouched and still on share 1.
    expect(await stateOf(fandri, r1)).toBe('active');
    expect(await relayOf(fandri, r1)).toBe(r1Relay);
    expect((await filedIn(fandri, r1)).length).toBe(15);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-sum(FANDRI_SHARE1));
    expect(await skipsOf(fandri.database)).toEqual([]);
  });

  it('variant (ii), join first, then Leave and delete (Keep them in Personal on), then Place them now: every purchase once, banks exact', async () => {
    const { dewi, fandri, r1, b, share2Member } = await toShare3();
    expect(share2Member).toBe(fandri.memberId);

    // Step 7: he joins share 3 first, as the same member; rows his share-1 copy holds are set aside.
    const joined = await join(dewi, fandri, b, share2Member);
    expect(joined.result.stopped).toBeUndefined();
    expect(joined.memberId).toBe(share2Member);
    await settleBook([dewi, fandri], b);
    const held = await heldElsewhereOf(fandri.database, b);
    expect(held.filter((h) => h.entity === 'purchase')).toHaveLength(DEWI_PRE.length);
    expect(held.every((h) => h.holderBookId === r1 && h.holderExists)).toBe(true);
    // Her two new purchases are in at once, filed in share 3, the one on a held category too.
    expect(await filedIn(fandri, b)).toEqual(['Dewi new groceries', 'Dewi new pet care']);

    // Step 8: Leave and delete of the share-1 copy, checked first as if left.
    const plan = await planBookDelete(fandri.database, fandri.ws, r1, { asIfLeft: true });
    expect(plan).toMatchObject({ refusal: null, erases: true, ownPurchases: FANDRI_SHARE1.length, arrivingInShare: 0 });
    await fandri.engine.leave(r1);
    const deleted = await deleteBook(fandri.database, fandri.ws, r1);
    expect(deleted.keptInPersonal).toBe(FANDRI_SHARE1.length);
    // The sheet's count is what the erase takes: her new purchase on a held category is share 3's, spared, not counted.
    expect(plan.transactions).toBe(deleted.transactions + deleted.keptInPersonal);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-sum(FANDRI_SHARE1));

    // Step 9: Place them now.
    const placed = await fandri.engine.placeHeldRows(b);
    expect(placed).toMatchObject({ placed: held.length, stillHeld: 0 });
    expect(placed.result.needsAccount ?? 0).toBe(0);
    await settleBook([dewi, fandri], b);
    await spend(fandri, b, 'Fandri new', 'Groceries', FANDRI_NEW);
    await settleBook([dewi, fandri], b);

    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await skipsOf(dewi.database)).toEqual([]);
    expect(await heldElsewhereOf(fandri.database, b)).toEqual([]);
    // Every purchase once on his phone, across Personal and share 3.
    expect(await postedByDescription(fandri)).toEqual({ ...EVERY_ONCE, 'Fandri new': 1 });
    const personal = await personalBook(fandri.database, fandri.ws);
    expect(await filedIn(fandri, personal.id)).toEqual(FANDRI_SHARE1.map(([d]) => d).sort());
    const inShare = ['Dewi new groceries', 'Dewi new pet care', 'Fandri new', ...DEWI_PRE.map(([d]) => d)].sort();
    expect(await filedIn(fandri, b)).toEqual(inShare);
    expect(await filedIn(dewi, b)).toEqual(inShare);
    expect(await projectBook(fandri.database, b)).toEqual(await projectBook(dewi.database, b));
    expect(await cursorOf(fandri, b)).toBe(await relayHead(fandri, b));
    // Banks to the unit: his holds exactly his own purchases, hers exactly hers (what her phone still had, plus new).
    expect(await balanceOf(fandri, fandri.bank)).toBe(-(sum(FANDRI_SHARE1) + FANDRI_NEW));
    expect(await placeholderBalance(fandri, b, fandri.memberId)).toBe(0);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-(sum(DEWI_PRE) + DEWI_NEW_GROCERIES + DEWI_NEW_PET));
    expect(await placeholderBalance(dewi, b, fandri.memberId)).toBe(-FANDRI_NEW);
  });

  it('variant (ii), delete first, then join: nothing is lost and the banks stay right', async () => {
    const { dewi, fandri, r1, b, share2Member } = await toShare3();

    // Steps 7 and 8 swapped: Leave and delete before joining. Nothing is set aside yet, so all six are kept in Personal.
    expect(await planBookDelete(fandri.database, fandri.ws, r1, { asIfLeft: true })).toMatchObject({
      refusal: null,
      ownPurchases: FANDRI_SHARE1.length,
      arrivingInShare: 0,
    });
    await fandri.engine.leave(r1);
    expect((await deleteBook(fandri.database, fandri.ws, r1)).keptInPersonal).toBe(FANDRI_SHARE1.length);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-sum(FANDRI_SHARE1));

    const joined = await join(dewi, fandri, b, share2Member);
    expect(joined.result.stopped).toBeUndefined();
    await settleBook([dewi, fandri], b);
    // No copy holds anything now: the join brings every row and Place has nothing to do.
    expect(await heldElsewhereOf(fandri.database, b)).toEqual([]);
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await projectBook(fandri.database, b)).toEqual(await projectBook(dewi.database, b));
    expect(await cursorOf(fandri, b)).toBe(await relayHead(fandri, b));

    // The figures of this order. Her copy predates share 1, so none of his purchases come back through share 3 and
    // nothing is doubled here; the double the sheet warns of needs a copy of hers holding his purchases
    // (place-held-couple.test.ts, "delete the old copy first").
    expect(await postedByDescription(fandri)).toEqual(EVERY_ONCE);
    const personal = await personalBook(fandri.database, fandri.ws);
    expect(await filedIn(fandri, personal.id)).toEqual(FANDRI_SHARE1.map(([d]) => d).sort());
    expect(await filedIn(fandri, b)).toEqual(await filedIn(dewi, b));
    expect(await balanceOf(fandri, fandri.bank)).toBe(-sum(FANDRI_SHARE1));
    expect(await placeholderBalance(fandri, b, fandri.memberId)).toBe(0);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-(sum(DEWI_PRE) + DEWI_NEW_GROCERIES + DEWI_NEW_PET));
  });
});
