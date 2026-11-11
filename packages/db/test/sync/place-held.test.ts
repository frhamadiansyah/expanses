import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { archiveAccount, deleteBook, heldElsewhereOf, personalBook, planBookDelete, postTransaction } from '../../src/index';
import { categoryOf, copyBookUnderNewIdForTest, Household, projectBook, skipsOf, type Device } from './household';

/*
 * Sharing resilience §4.3, Place them now: rows a share sent while another copy on this phone held them (D-A3) come in
 * once that copy is gone. Invented names and figures: Dewi shares A, Fandri joins, both record; Dewi's phone then holds a
 * second book B with the very same rows, shares it, and Fandri joins B beside his copy of A.
 */

async function balanceOf(d: Device, accountId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(
    sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${accountId} AND t.status = 'posted'`,
  );
  return Number(row![0]);
}

/** How many posted transactions on the phone carry each description, in every workspace: a purchase counted twice shows. */
async function postedByDescription(d: Device): Promise<Record<string, number>> {
  const rows = await d.database.db.values<[string, number]>(
    sql`SELECT description, count(*) FROM transactions WHERE status = 'posted' AND description IS NOT NULL GROUP BY description ORDER BY description`,
  );
  return Object.fromEntries(rows.map(([description, n]) => [description, Number(n)]));
}

/**
 * What the share's purchases add up to on this phone (the heads of the book's lineages, posted and filed in it), by
 * description: the money to the unit. By lineage, because on Dewi's phone A and B hold the very same categories (the
 * copy moved them), so a purchase that reaches A there is filed under B's categories without being B's.
 */
async function spentIn(d: Device, bookId: string): Promise<Record<string, number>> {
  const rows = await d.database.db.values<[string, number]>(sql`
    SELECT t.description, sum(e.amount_minor) FROM transactions t
    JOIN sync_lineage l ON l.head_transaction_id = t.id AND l.book_id = ${bookId}
    JOIN book_transactions bt ON bt.transaction_id = t.id AND bt.book_id = ${bookId}
    JOIN entries e ON e.transaction_id = t.id
    JOIN accounts a ON a.id = e.account_id AND a.kind = 'expense'
    WHERE t.status = 'posted' GROUP BY t.description ORDER BY t.description`);
  return Object.fromEntries(rows.map(([description, sum]) => [description, Number(sum)]));
}

/** The book's hidden account for `memberId` in IDR on this phone (a placeholder, household spec §4.4); 0 when none. */
async function placeholderBalance(d: Device, bookId: string, memberId: string): Promise<number> {
  const [row] = await d.database.db.values<[string]>(
    sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${memberId} AND currency = 'IDR'`,
  );
  return row ? balanceOf(d, row[0]) : 0;
}

/**
 * Money to the unit on both phones once B's rows are placed. Dewi's bank is unchanged throughout. Fandri's own purchase
 * was erased with A; it comes back once, from B's log, onto the own account its label names (D-B6: "Fandri Bank"), so
 * his bank is back where it was before the delete and nothing sits on his own placeholder.
 */
async function expectMoney(dewi: Device, fandri: Device, newBook: string, oldBook: string): Promise<void> {
  expect(await balanceOf(dewi, dewi.bank)).toBe(-41_300);
  expect(await balanceOf(fandri, fandri.bank)).toBe(-27_500);
  expect(await placeholderBalance(fandri, newBook, fandri.memberId)).toBe(0);
  expect(await placeholderBalance(fandri, newBook, dewi.memberId)).toBe(-41_300);
  // Dewi's phone keeps Fandri's money where it always was (the copy into B moved only the filing rows), to the unit.
  expect(await placeholderBalance(dewi, oldBook, fandri.memberId)).toBe(-27_500);
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

/** A3's live-holder shape: Fandri joins B while his copy of A, the same rows under the same ids, is still live. */
async function joinBeside() {
  const home = new Household();
  const dewi = await home.device('Dewi');
  const fandri = await home.device('Fandri');
  const oldBook = await home.share(dewi);
  await home.join(fandri, dewi);
  await spend(dewi, oldBook, 'Dewi market', 41_300);
  await spend(fandri, oldBook, 'Fandri market', 27_500);
  await home.settle();
  const newBook = await copyBookUnderNewIdForTest(dewi, oldBook);
  // On Dewi's phone B is the copy that is shared now: its purchases' lineages are B's, as a seed of it records them.
  await dewi.database.db.run(sql`UPDATE sync_lineage SET book_id = ${newBook} WHERE book_id = ${oldBook}`);
  await dewi.engine.shareBook(newBook, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
  const { code } = await dewi.engine.createInvite(newBook, { inviterName: dewi.name });
  const joined = await fandri.engine.joinBook(code, { ws: fandri.ws, memberName: fandri.name, deviceName: `${fandri.name}'s phone`, memberId: fandri.memberId });
  expect(joined.result.stopped).toBeUndefined();
  await settleBook([dewi, fandri], newBook);
  const held = await heldElsewhereOf(fandri.database, newBook);
  expect(held.length).toBeGreaterThan(0);
  expect(held.every((h) => h.holderBookId === oldBook && h.holderExists)).toBe(true);
  expect(held.filter((h) => h.entity === 'purchase')).toHaveLength(2);
  return { home, dewi, fandri, oldBook, newBook, held };
}

/**
 * Fandri leaves A and deletes it here. With Keep them in Personal on (the default), his own purchases that B set aside
 * as held by A are not kept (A6 fix round 1): B's log brings them back, so they are erased with A; any other own purchase
 * of A moves to Personal. With it off, every one of them goes with A.
 */
async function leaveAndDelete(fandri: Device, oldBook: string, keepOwnInPersonal?: boolean): Promise<void> {
  await fandri.engine.leave(oldBook);
  await deleteBook(fandri.database, fandri.ws, oldBook, keepOwnInPersonal === undefined ? {} : { keepOwnInPersonal });
  expect(await fandri.database.db.values(sql`SELECT id FROM books WHERE id = ${oldBook}`)).toEqual([]);
}

async function expectPlaced(dewi: Device, fandri: Device, newBook: string): Promise<void> {
  expect(await skipsOf(fandri.database)).toEqual([]);
  expect(await heldElsewhereOf(fandri.database, newBook)).toEqual([]);
  expect(await cursorOf(fandri, newBook)).toBe(await relayHead(fandri, newBook));
  expect(await projectBook(fandri.database, newBook)).toEqual(await projectBook(dewi.database, newBook));
  // Both purchases are in B on Fandri's phone, once each, to the unit, as on Dewi's.
  expect(await spentIn(fandri, newBook)).toEqual({ 'Dewi market': 41_300, 'Fandri market': 27_500 });
  expect(await spentIn(dewi, newBook)).toEqual({ 'Dewi market': 41_300, 'Fandri market': 27_500 });
}

describe('Place them now (§4.3)', () => {
  it('refuses while the old copy still holds the rows, and brings every row once it is deleted', async () => {
    const { dewi, fandri, oldBook, newBook, held } = await joinBeside();
    expect(await balanceOf(fandri, fandri.bank)).toBe(-27_500);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-41_300);

    await expect(fandri.engine.placeHeldRows(newBook)).rejects.toMatchObject({ code: 'HELD_ELSEWHERE' });
    expect((await heldElsewhereOf(fandri.database, newBook)).length).toBe(held.length); // the refusal touched nothing

    // Keep them in Personal on: his one own purchase comes back through B, so it is not kept as well.
    await fandri.engine.leave(oldBook);
    expect(await planBookDelete(fandri.database, fandri.ws, oldBook)).toMatchObject({ refusal: null, erases: true, ownPurchases: 0, arrivingInShare: 1 });
    await deleteBook(fandri.database, fandri.ws, oldBook);
    expect(await balanceOf(fandri, fandri.bank)).toBe(0); // his purchase left with the copy, to come back through B

    const placed = await fandri.engine.placeHeldRows(newBook);
    expect(placed.stillHeld).toBe(0);
    expect(placed.placed).toBe(held.length);
    expect(placed.result.stopped).toBeUndefined();
    expect(placed.result.needsAccount).toBe(0); // his purchase found its own account
    await settleBook([dewi, fandri], newBook);
    await expectPlaced(dewi, fandri, newBook);
    await expectMoney(dewi, fandri, newBook, oldBook);
    expect(await postedByDescription(fandri)).toEqual({ 'Dewi market': 1, 'Fandri market': 1 });

    // The share carries on as normal after it: each records once more, and both phones agree.
    await spend(dewi, newBook, 'Dewi bakery', 8_200);
    await spend(fandri, newBook, 'Fandri bakery', 6_450);
    await settleBook([dewi, fandri], newBook);
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await projectBook(fandri.database, newBook)).toEqual(await projectBook(dewi.database, newBook));
    expect(await balanceOf(dewi, dewi.bank)).toBe(-49_500);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-33_950);
    expect(await spentIn(fandri, newBook)).toEqual(await spentIn(dewi, newBook));
  });

  it('a second Place them now places nothing and changes nothing', async () => {
    const { dewi, fandri, oldBook, newBook, held } = await joinBeside();
    await leaveAndDelete(fandri, oldBook, false); // Keep them in Personal off: every row of A goes
    expect((await fandri.engine.placeHeldRows(newBook)).placed).toBe(held.length);
    await settleBook([dewi, fandri], newBook);
    const before = await projectBook(fandri.database, newBook);
    const posted = await fandri.database.db.values(sql`SELECT id, status FROM transactions ORDER BY id`);

    const again = await fandri.engine.placeHeldRows(newBook);
    expect(again).toMatchObject({ placed: 0, stillHeld: 0 });
    await settleBook([dewi, fandri], newBook);
    expect(await projectBook(fandri.database, newBook)).toEqual(before);
    expect(await fandri.database.db.values(sql`SELECT id, status FROM transactions ORDER BY id`)).toEqual(posted);
    await expectPlaced(dewi, fandri, newBook);
    await expectMoney(dewi, fandri, newBook, oldBook);
  });

  it('an old copy deleted by an older build, its lineages left behind, holds nothing', async () => {
    const { dewi, fandri, oldBook, newBook, held } = await joinBeside();
    const lineages = await fandri.database.db.values<[string, string, string | null, string, string]>(
      sql`SELECT lineage_id, book_id, head_transaction_id, paid_by, paid_label FROM sync_lineage WHERE book_id = ${oldBook}`,
    );
    expect(lineages.length).toBe(2);
    await leaveAndDelete(fandri, oldBook);
    // What an older build left: the copy is gone, its lineage rows are not.
    for (const [lineageId, bookId, head, paidBy, paidLabel] of lineages) {
      await fandri.database.db.run(
        sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${lineageId}, ${bookId}, ${head}, ${paidBy}, ${paidLabel})`,
      );
    }
    const stillNamed = await heldElsewhereOf(fandri.database, newBook);
    expect(stillNamed.every((h) => !h.holderExists)).toBe(true);

    const placed = await fandri.engine.placeHeldRows(newBook);
    expect(placed).toMatchObject({ placed: held.length, stillHeld: 0 });
    await settleBook([dewi, fandri], newBook);
    await expectPlaced(dewi, fandri, newBook);
    // The leftover lineages went; every lineage here is B's.
    expect(await fandri.database.db.values(sql`SELECT DISTINCT book_id FROM sync_lineage`)).toEqual([[newBook]]);
    await expectMoney(dewi, fandri, newBook, oldBook);
  });

  it('a purchase only the old copy held still moves to Personal; each own purchase is counted once', async () => {
    const { dewi, fandri, oldBook, newBook } = await joinBeside();
    // Recorded in A after B was made from it: B never has it, so nothing brings it back but Personal.
    const pharmacy = await spend(fandri, oldBook, 'Fandri pharmacy', 12_300);
    await settleBook([dewi, fandri], oldBook);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-39_800);
    await fandri.engine.leave(oldBook);
    expect(await planBookDelete(fandri.database, fandri.ws, oldBook)).toMatchObject({ refusal: null, ownPurchases: 1, arrivingInShare: 1 });
    const deleted = await deleteBook(fandri.database, fandri.ws, oldBook);
    expect(deleted.keptInPersonal).toBe(1);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-12_300);
    expect(await fandri.database.db.values(sql`SELECT id FROM transactions WHERE id = ${pharmacy}`)).toEqual([]); // kept under a new id

    expect(await fandri.engine.placeHeldRows(newBook)).toMatchObject({ stillHeld: 0 });
    await settleBook([dewi, fandri], newBook);
    await expectPlaced(dewi, fandri, newBook);
    // Every own purchase once across Personal and B; the bank to the unit: the pharmacy in Personal, the market in B.
    expect(await postedByDescription(fandri)).toEqual({ 'Dewi market': 1, 'Fandri market': 1, 'Fandri pharmacy': 1 });
    const personal = await personalBook(fandri.database, fandri.ws);
    expect(await fandri.database.db.values(sql`
      SELECT t.description FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id
      WHERE bt.book_id = ${personal.id} AND t.status = 'posted'`)).toEqual([['Fandri pharmacy']]);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-39_800); // as before the delete, to the unit
    expect(await placeholderBalance(fandri, newBook, fandri.memberId)).toBe(0);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-41_300);
  });

  it('an ordinary sync asked for while the log is pulled again waits for it', async () => {
    const { dewi, fandri, oldBook, newBook, held } = await joinBeside();
    await leaveAndDelete(fandri, oldBook);
    let placedFirst = false;
    const placing = fandri.engine.placeHeldRows(newBook).then((r) => {
      placedFirst = true;
      return r;
    });
    const sync = fandri.engine.syncOnce(newBook).then(() => placedFirst);
    const drained = fandri.engine.drain(newBook).then(() => placedFirst);
    expect((await placing).placed).toBe(held.length);
    expect(await sync).toBe(true);
    expect(await drained).toBe(true);
    await settleBook([dewi, fandri], newBook);
    await expectPlaced(dewi, fandri, newBook);
    await expectMoney(dewi, fandri, newBook, oldBook);
  });

  it('a sync already waiting on the relay when Place starts finishes first, and every row is placed', async () => {
    const { dewi, fandri, oldBook, newBook, held } = await joinBeside();
    await leaveAndDelete(fandri, oldBook);
    // Something new in the log for the ordinary sync to bring.
    await spend(dewi, newBook, 'Dewi late', 1_100);
    await dewi.engine.syncOnce(newBook);
    const cursorBefore = await cursorOf(fandri, newBook);
    // The ordinary sync's first pull answers only when let go: it is in flight when Place is asked for.
    const transport = fandri.transport as { pull: typeof fandri.transport.pull };
    const realPull = transport.pull.bind(fandri.transport);
    let letGo!: () => void;
    const gate = new Promise<void>((resolve) => (letGo = resolve));
    let pulledOnce: () => void;
    const pulled = new Promise<void>((resolve) => (pulledOnce = resolve));
    let first = true;
    transport.pull = async (relayBookId, since) => {
      const answer = await realPull(relayBookId, since);
      if (first) {
        first = false;
        pulledOnce();
        await gate;
      }
      return answer;
    };
    try {
      const ordinary = fandri.engine.syncOnce(newBook);
      await pulled;
      const placing = fandri.engine.placeHeldRows(newBook);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(await cursorOf(fandri, newBook)).toBe(cursorBefore); // Place has not reset under the waiting pull
      letGo();
      const [, placed] = await Promise.all([ordinary, placing]);
      expect(placed).toMatchObject({ placed: held.length, stillHeld: 0 });
    } finally {
      transport.pull = realPull;
    }
    await settleBook([dewi, fandri], newBook);
    expect(await cursorOf(fandri, newBook)).toBe(await relayHead(fandri, newBook));
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await projectBook(fandri.database, newBook)).toEqual(await projectBook(dewi.database, newBook));
    expect(await spentIn(fandri, newBook)).toEqual({ 'Dewi late': 1_100, 'Dewi market': 41_300, 'Fandri market': 27_500 });
    expect(await balanceOf(fandri, fandri.bank)).toBe(-27_500);
  });

  it('a purchase that came on a set-aside category between the delete and Place is filed under it once placed', async () => {
    const { dewi, fandri, oldBook, newBook } = await joinBeside();
    await leaveAndDelete(fandri, oldBook);
    // The scheduler's ordinary sync brings Dewi's new purchase before Place: its category is not here yet.
    await spend(dewi, newBook, 'Dewi late', 1_100);
    await settleBook([dewi, fandri], newBook);
    const fallback = await fandri.database.db.values<[string]>(sql`
      SELECT a.system_key FROM transactions t JOIN entries e ON e.transaction_id = t.id JOIN accounts a ON a.id = e.account_id
      WHERE t.description = 'Dewi late' AND t.status = 'posted' AND a.kind = 'expense'`);
    expect(fallback).toEqual([['uncategorised']]);

    expect(await fandri.engine.placeHeldRows(newBook)).toMatchObject({ stillHeld: 0 });
    await settleBook([dewi, fandri], newBook);
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await projectBook(fandri.database, newBook)).toEqual(await projectBook(dewi.database, newBook));
    expect(await spentIn(fandri, newBook)).toEqual({ 'Dewi late': 1_100, 'Dewi market': 41_300, 'Fandri market': 27_500 });
    const groceries = await categoryOf(fandri.database, newBook, 'Groceries');
    const [[onGroceries]] = (await fandri.database.db.values<[number]>(sql`
      SELECT sum(e.amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ${groceries} AND t.status = 'posted'`)) as [[number]];
    expect(Number(onGroceries)).toBe(41_300 + 27_500 + 1_100);
    expect(await placeholderBalance(fandri, newBook, dewi.memberId)).toBe(-(41_300 + 1_100));
    expect(await balanceOf(fandri, fandri.bank)).toBe(-27_500);
  });

  it('an own purchase whose recorded account is gone lands on his placeholder and is counted as needing an account', async () => {
    const { dewi, fandri, oldBook, newBook } = await joinBeside();
    await fandri.engine.leave(oldBook);
    await deleteBook(fandri.database, fandri.ws, oldBook); // Keep them in Personal on: his purchase is recorded, then erased
    expect(await fandri.database.db.values(sql`SELECT 1 FROM settings WHERE key = ${`sharing.arriving.${newBook}`}`)).toHaveLength(1);
    await archiveAccount(fandri.database, fandri.ws, fandri.bank); // the account it was paid from, closed since
    const placed = await fandri.engine.placeHeldRows(newBook);
    expect(placed).toMatchObject({ stillHeld: 0 });
    expect(placed.result.needsAccount).toBe(1);
    await settleBook([dewi, fandri], newBook);
    expect(await placeholderBalance(fandri, newBook, fandri.memberId)).toBe(-27_500);
    expect(await balanceOf(fandri, fandri.bank)).toBe(0);
    expect(await projectBook(fandri.database, newBook)).toEqual(await projectBook(dewi.database, newBook));
    // Done with once nothing is held.
    expect(await fandri.database.db.values(sql`SELECT 1 FROM settings WHERE key = ${`sharing.arriving.${newBook}`}`)).toEqual([]);
  });

  it('the record of where arriving purchases were paid from goes when its share is left, or its copy erased', async () => {
    const { fandri, oldBook, newBook } = await joinBeside();
    const key = (book: string) => `sharing.arriving.${book}`;
    await fandri.database.db.run(sql`INSERT INTO settings (key, value) VALUES (${key(newBook)}, '{}'), (${key(oldBook)}, '{}')`);
    await fandri.engine.leave(newBook);
    expect(await fandri.database.db.values(sql`SELECT 1 FROM settings WHERE key = ${key(newBook)}`)).toEqual([]);
    await fandri.engine.leave(oldBook);
    await deleteBook(fandri.database, fandri.ws, oldBook, { keepOwnInPersonal: false });
    expect(await fandri.database.db.values(sql`SELECT 1 FROM settings WHERE key = ${key(oldBook)}`)).toEqual([]);
  });

  it('a net-worth group log is not a share Place them now pulls again', async () => {
    const { fandri, newBook } = await joinBeside();
    await fandri.database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at)
      VALUES ('group-log-test', 'relay-group-test', 1, ${fandri.memberId}, 'active', '2026-09-12T00:00:00.000Z')`);
    await fandri.database.db.run(sql`INSERT INTO nw_group_books (group_book_id, book_id) VALUES ('group-log-test', ${newBook})`);
    // Its sync removes devices and syncs itself again inside: a whole-log pull holding it would wait on itself.
    await expect(fandri.engine.placeHeldRows('group-log-test')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a book that is not shared and active here is NOT_FOUND', async () => {
    const { fandri, oldBook } = await joinBeside();
    await fandri.engine.leave(oldBook);
    await expect(fandri.engine.placeHeldRows(oldBook)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(fandri.engine.placeHeldRows('no-such-book')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
