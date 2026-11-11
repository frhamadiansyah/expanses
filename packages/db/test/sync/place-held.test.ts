import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteBook, heldElsewhereOf, postTransaction } from '../../src/index';
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

/** What the book's purchases add up to on this phone, posted only, by description: the money to the unit. */
async function spentIn(d: Device, bookId: string): Promise<Record<string, number>> {
  const rows = await d.database.db.values<[string, number]>(sql`
    SELECT t.description, sum(e.amount_minor) FROM transactions t
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
 * was erased with A; it comes back once, from B's log: on this build onto his own placeholder in B (an own purchase
 * with no head here has no account to land on until Task B1 matches its label), so his bank stays where the delete
 * left it and the purchase is counted exactly once.
 */
async function expectMoney(dewi: Device, fandri: Device, newBook: string, oldBook: string): Promise<void> {
  expect(await balanceOf(dewi, dewi.bank)).toBe(-41_300);
  expect(await balanceOf(fandri, fandri.bank)).toBe(0);
  expect(await placeholderBalance(fandri, newBook, fandri.memberId)).toBe(-27_500);
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

/** Fandri leaves A and deletes it here, his own purchases going with it (the log of B brings them back). */
async function leaveAndDelete(fandri: Device, oldBook: string): Promise<void> {
  await fandri.engine.leave(oldBook);
  await deleteBook(fandri.database, fandri.ws, oldBook, { keepOwnInPersonal: false });
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

    await leaveAndDelete(fandri, oldBook);
    expect(await balanceOf(fandri, fandri.bank)).toBe(0); // his purchase left with the copy

    const placed = await fandri.engine.placeHeldRows(newBook);
    expect(placed.stillHeld).toBe(0);
    expect(placed.placed).toBe(held.length);
    expect(placed.result.stopped).toBeUndefined();
    await settleBook([dewi, fandri], newBook);
    await expectPlaced(dewi, fandri, newBook);
    await expectMoney(dewi, fandri, newBook, oldBook);

    // The share carries on as normal after it: each records once more, and both phones agree.
    await spend(dewi, newBook, 'Dewi bakery', 8_200);
    await spend(fandri, newBook, 'Fandri bakery', 6_450);
    await settleBook([dewi, fandri], newBook);
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await projectBook(fandri.database, newBook)).toEqual(await projectBook(dewi.database, newBook));
    expect(await balanceOf(dewi, dewi.bank)).toBe(-49_500);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-6_450);
    expect(await spentIn(fandri, newBook)).toEqual(await spentIn(dewi, newBook));
  });

  it('a second Place them now places nothing and changes nothing', async () => {
    const { dewi, fandri, oldBook, newBook, held } = await joinBeside();
    await leaveAndDelete(fandri, oldBook);
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

  it('a book that is not shared and active here is NOT_FOUND', async () => {
    const { fandri, oldBook } = await joinBeside();
    await fandri.engine.leave(oldBook);
    await expect(fandri.engine.placeHeldRows(oldBook)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(fandri.engine.placeHeldRows('no-such-book')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
