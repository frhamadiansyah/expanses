import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteBook, heldElsewhereOf, personalBook, planBookDelete, postTransaction } from '../../src/index';
import { categoryOf, copyBookUnderNewIdForTest, Household, projectBook, skipsOf, type Device } from './household';

/*
 * The couple's cleanup (sharing resilience §1, §4.3, plan Task A6 fix round 2), with invented figures. Dewi shares R1,
 * Fandri joins, both record. Her phone loses the share and comes back with the workspace under a new book id B (here a
 * copy of R1, its lineages B's), and her old phone never syncs again, so a purchase Fandri records in R1 after that
 * reaches only his copy. She shares B (R2), he joins beside R1, rows are held; she stops R2 and he deletes that copy. She
 * shares B again (R3, inviting him as the same member) and the cleanup runs in one of two orders.
 */

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

async function spend(d: Device, bookId: string, description: string, amountMinor: number): Promise<string> {
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-12',
    description,
    lines: expenseLines({ categoryAccountId: await categoryOf(d.database, bookId, 'Groceries'), paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

async function settleBook(devices: readonly Device[], bookId: string): Promise<void> {
  for (let round = 0; round < 2; round += 1) for (const d of devices) await d.engine.syncOnce(bookId);
}

async function cursorOf(d: Device, bookId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`);
  return Number(row?.[0] ?? -1);
}

async function relayHead(d: Device, bookId: string): Promise<number> {
  const [[relayBookId]] = (await d.database.db.values<[string]>(sql`SELECT relay_book_id FROM shared_books WHERE book_id = ${bookId}`)) as [[string]];
  return (await d.transport.pull(relayBookId, 0)).latest;
}

async function invite(dewi: Device, fandri: Device, bookId: string, sameMember: boolean) {
  const { code } = await dewi.engine.createInvite(bookId, sameMember ? { inviterName: dewi.name, sameMember: true, memberId: fandri.memberId } : { inviterName: dewi.name });
  const joined = await fandri.engine.joinBook(code, { ws: fandri.ws, memberName: fandri.name, deviceName: `${fandri.name}'s phone`, memberId: fandri.memberId });
  expect(joined.result.stopped).toBeUndefined();
}

/** Up to R3 being shared: R1 on both phones, R2 shared, joined, stopped and deleted on his. */
async function couple() {
  const home = new Household();
  const dewi = await home.device('Dewi');
  const fandri = await home.device('Fandri');
  const r1 = await home.share(dewi);
  await home.join(fandri, dewi);
  await spend(dewi, r1, 'Dewi pre', 41_300);
  await spend(fandri, r1, 'Fandri early', 27_500);
  await home.settle();
  const b = await copyBookUnderNewIdForTest(dewi, r1);
  await dewi.database.db.run(sql`UPDATE sync_lineage SET book_id = ${b} WHERE book_id = ${r1}`);
  await spend(fandri, r1, 'Fandri late', 12_300); // only his copy ever hears of it
  await fandri.engine.syncOnce(r1);
  expect(await balanceOf(fandri, fandri.bank)).toBe(-39_800);

  // R2: shared, joined beside R1 (held), stopped, and its copy deleted on his phone; nothing of his moves.
  await dewi.engine.shareBook(b, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
  await invite(dewi, fandri, b, false);
  await settleBook([dewi, fandri], b);
  expect((await heldElsewhereOf(fandri.database, b)).length).toBeGreaterThan(0);
  await dewi.engine.stopSharing(b);
  await fandri.engine.syncOnce(b);
  await deleteBook(fandri.database, fandri.ws, b);
  expect(await balanceOf(fandri, fandri.bank)).toBe(-39_800);

  // R3: the same workspace of hers, shared again.
  await dewi.engine.shareBook(b, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
  return { home, dewi, fandri, r1, b };
}

describe('the couple’s cleanup', () => {
  it('join first, then leave and delete the old copy (Keep them in Personal on), then Place them now: every purchase once, banks exact', async () => {
    const { dewi, fandri, r1, b } = await couple();
    await invite(dewi, fandri, b, true);
    await settleBook([dewi, fandri], b);
    expect((await heldElsewhereOf(fandri.database, b)).filter((h) => h.entity === 'purchase')).toHaveLength(2);
    // A purchase of hers on a category R1 holds here is set aside with it, never filed into R1 (it would go with R1).
    await spend(dewi, b, 'Dewi new', 4_400);
    await settleBook([dewi, fandri], b);
    const held = await heldElsewhereOf(fandri.database, b);
    expect(held.filter((h) => h.entity === 'purchase')).toHaveLength(3);
    expect(await postedByDescription(fandri)).toEqual({ 'Dewi pre': 1, 'Fandri early': 1, 'Fandri late': 1 }); // R1's, untouched

    await fandri.engine.leave(r1);
    expect(await planBookDelete(fandri.database, fandri.ws, r1)).toMatchObject({ refusal: null, ownPurchases: 1, arrivingInShare: 1 });
    expect((await deleteBook(fandri.database, fandri.ws, r1)).keptInPersonal).toBe(1);
    const placed = await fandri.engine.placeHeldRows(b);
    expect(placed).toMatchObject({ placed: held.length, stillHeld: 0 });
    expect(placed.result.needsAccount).toBe(0);
    await settleBook([dewi, fandri], b);
    await spend(fandri, b, 'Fandri new', 3_300);
    await settleBook([dewi, fandri], b);

    // Counted once, each where it belongs: the late one in his Personal, the rest in R3.
    expect(await postedByDescription(fandri)).toEqual({ 'Dewi new': 1, 'Dewi pre': 1, 'Fandri early': 1, 'Fandri late': 1, 'Fandri new': 1 });
    const personal = await personalBook(fandri.database, fandri.ws);
    expect(await filedIn(fandri, personal.id)).toEqual(['Fandri late']);
    expect(await filedIn(fandri, b)).toEqual(['Dewi new', 'Dewi pre', 'Fandri early', 'Fandri new']);
    // Banks to the unit: his holds exactly his own purchases, hers exactly hers.
    expect(await balanceOf(fandri, fandri.bank)).toBe(-(27_500 + 12_300 + 3_300));
    expect(await balanceOf(dewi, dewi.bank)).toBe(-(41_300 + 4_400));
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await cursorOf(fandri, b)).toBe(await relayHead(fandri, b));
    expect(await projectBook(fandri.database, b)).toEqual(await projectBook(dewi.database, b));
  });

  it('delete the old copy first (Keep them in Personal on), then join: nothing is lost, his early purchase shows twice', async () => {
    const { dewi, fandri, r1, b } = await couple();
    await fandri.engine.leave(r1);
    // Nothing set aside yet, so nothing reads as arriving: both his purchases are kept in Personal.
    expect(await planBookDelete(fandri.database, fandri.ws, r1)).toMatchObject({ refusal: null, ownPurchases: 2, arrivingInShare: 0 });
    expect((await deleteBook(fandri.database, fandri.ws, r1)).keptInPersonal).toBe(2);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-39_800);

    await invite(dewi, fandri, b, true);
    await settleBook([dewi, fandri], b);
    // No copy holds anything now: the join brings every row, no Place needed.
    expect(await heldElsewhereOf(fandri.database, b)).toEqual([]);
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await projectBook(fandri.database, b)).toEqual(await projectBook(dewi.database, b));

    // The double (Drop A, A8's sheet warns of it): the kept copy in Personal and R3's, both on his bank by its label.
    // No purchase is lost; the early one is there twice, and his bank shows it twice.
    expect(await postedByDescription(fandri)).toEqual({ 'Dewi pre': 1, 'Fandri early': 2, 'Fandri late': 1 });
    const personal = await personalBook(fandri.database, fandri.ws);
    expect(await filedIn(fandri, personal.id)).toEqual(['Fandri early', 'Fandri late']);
    expect(await filedIn(fandri, b)).toEqual(['Dewi pre', 'Fandri early']);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-(27_500 + 12_300 + 27_500));
    expect(await balanceOf(dewi, dewi.bank)).toBe(-41_300);
  });
});
