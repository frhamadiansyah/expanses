import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, createBook, heldElsewhereOf, postTransaction } from '../../src/index';
import { HELD_PREFIX } from '../../src/sync/held';
import { categoryOf, copyBookUnderNewIdForTest, headOf, Household, projectBook, skipsOf, type Device } from './household';

/* Sharing resilience §4.2 D-A3, D-A4, D-A5: rows another copy on the phone holds never stall a join, and are never edited. */

async function balanceOf(d: Device, accountId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(
    sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${accountId} AND t.status = 'posted'`,
  );
  return Number(row![0]);
}

async function spend(d: Device, bookId: string, description: string, amountMinor: number): Promise<string> {
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: await categoryOf(d.database, bookId, 'Groceries'), paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

/** Every device syncs `bookId` twice: drained, then pulled. */
async function settleBook(devices: readonly Device[], bookId: string): Promise<void> {
  for (let round = 0; round < 2; round += 1) for (const d of devices) await d.engine.syncOnce(bookId);
}

/**
 * The couple's shape (spec §1 note): Dewi shares book A, Fandri joins, both record. Dewi's phone then holds a second book
 * B under a new id with the very same rows; she shares it and invites Fandri, who joins beside his copy of A.
 */
async function joinBeside(options: { stopOldFirst: boolean }) {
  const home = new Household();
  const dewi = await home.device('Dewi');
  const fandri = await home.device('Fandri');
  const oldBook = await home.share(dewi);
  await home.join(fandri, dewi);
  await spend(dewi, oldBook, 'Dewi market', 41_300);
  await spend(fandri, oldBook, 'Fandri market', 27_500);
  await home.settle();
  if (options.stopOldFirst) {
    await dewi.engine.stopSharing(oldBook);
    await fandri.engine.syncOnce(oldBook);
    const state = (await fandri.database.db.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${oldBook}`))[0]![0];
    expect(state).toBe('unshared');
  }
  const oldBefore = await projectBook(fandri.database, oldBook);
  const bankBefore = await balanceOf(fandri, fandri.bank);
  expect(bankBefore).toBe(-27_500);

  const newBook = await copyBookUnderNewIdForTest(dewi, oldBook);
  await dewi.engine.shareBook(newBook, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
  const { code } = await dewi.engine.createInvite(newBook, { inviterName: dewi.name });
  const { result } = await fandri.engine.joinBook(code, { ws: fandri.ws, memberName: fandri.name, deviceName: `${fandri.name}'s phone`, memberId: fandri.memberId });
  await settleBook([dewi, fandri], newBook);
  return { home, dewi, fandri, oldBook, newBook, result, oldBefore, bankBefore };
}

async function expectHeldBy(fandri: Device, newBook: string, oldBook: string): Promise<number> {
  const skips = await fandri.database.db.values<[string]>(sql`SELECT error FROM sync_skipped WHERE book_id = ${newBook}`);
  // Every skip is the held one, naming the old copy; nothing else was refused.
  expect(skips.length).toBeGreaterThan(0);
  for (const [error] of skips) expect(error).toBe(`${HELD_PREFIX}: ${oldBook}`);
  const held = await heldElsewhereOf(fandri.database, newBook);
  expect(held.every((h) => h.holderBookId === oldBook && h.holderExists)).toBe(true);
  // Both purchases and the categories they are filed under are among them.
  expect(held.filter((h) => h.entity === 'purchase')).toHaveLength(2);
  expect(held.some((h) => h.entity === 'category')).toBe(true);
  return held.length;
}

describe('rows another copy on the phone holds (D-A3, D-A4)', () => {
  it('a live old copy: the join completes, the old copy is untouched, the held rows are counted', async () => {
    const { fandri, oldBook, newBook, result, oldBefore, bankBefore } = await joinBeside({ stopOldFirst: false });
    expect(result.stopped).toBeUndefined();
    const heldCount = await expectHeldBy(fandri, newBook, oldBook);
    expect(heldCount).toBeGreaterThan(0);
    expect(await projectBook(fandri.database, oldBook)).toEqual(oldBefore); // old copy unchanged
    expect(await balanceOf(fandri, fandri.bank)).toBe(bankBefore); // to the unit
    // The new share's own rows did land: its book row and Dewi as its owner.
    const name = (await fandri.database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${newBook}`))[0]![0];
    expect(name).toBeTruthy();
    const role = (await fandri.database.db.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${newBook} AND member_id = 'member-Dewi'`))[0]![0];
    expect(role).toBe('owner');
    // The old share still syncs, untouched.
    const again = await fandri.engine.syncOnce(oldBook);
    expect(again.stopped).toBeUndefined();
    expect(await skipsOf(fandri.database).then((rows) => rows.filter((r) => !(r as unknown[])[3]!.toString().startsWith(HELD_PREFIX)))).toEqual([]);
  });

  it('a kept old copy (its share stopped, read-only here) holds rows the same way', async () => {
    const { fandri, oldBook, newBook, result, oldBefore, bankBefore } = await joinBeside({ stopOldFirst: true });
    expect(result.stopped).toBeUndefined();
    await expectHeldBy(fandri, newBook, oldBook);
    expect(await projectBook(fandri.database, oldBook)).toEqual(oldBefore);
    expect(await balanceOf(fandri, fandri.bank)).toBe(bankBefore);
  });

  // After the old copy is deleted (erase, Task A5), Place them now (Task A6) brings every row: in A6's test file.
  it.todo('after the old copy is deleted, Place them now brings every row and leaves no skip');

  it('a dead leftover category (archived, out of every workspace) is adopted into the joined book', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    const leftoverId = await categoryOf(dewi.database, bookId, 'Groceries');
    await spend(dewi, bookId, 'Dewi market', 41_300);
    // The old deleteBook way: the category archived under another name, its book_categories row gone.
    await fandri.database.db.run(sql`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, system_key, sort_order, archived_at, created_at)
      VALUES (${leftoverId}, ${fandri.ws.workspaceId}, NULL, 'expense', 'category', 'Old groceries', NULL, NULL, NULL, 0, '2026-05-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z')`);
    await home.join(fandri, dewi);
    await home.settle();
    expect(await categoryOf(fandri.database, bookId, 'Groceries')).toBe(leftoverId);
    expect(await skipsOf(fandri.database)).toEqual([]);
    const archivedAt = (await fandri.database.db.values<[string | null]>(sql`SELECT archived_at FROM accounts WHERE id = ${leftoverId}`))[0]![0];
    expect(archivedAt).toBeNull();
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
    // Dewi's purchase is filed under the adopted category on Fandri's phone, to the unit.
    const spent = (await fandri.database.db.values<[number]>(
      sql`SELECT sum(e.amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${leftoverId} AND t.status = 'posted'`,
    ))[0]![0];
    expect(Number(spent)).toBe(41_300);
  });

  it('a lineage of another book is never edited in this book’s name (D-A5)', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    const lineage = await spend(dewi, bookId, 'Dewi market', 41_300);
    // Fandri's own book holds a lineage row under the same id, headed by his own purchase.
    const food = await createAccount(fandri.database, fandri.ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
    const own = await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-03-01',
      description: 'own',
      lines: expenseLines({ categoryAccountId: food.id, paymentAccountId: fandri.bank, amountMinor: 9_900, currency: 'IDR' }),
    });
    const oldBook = await createBook(fandri.database, fandri.ws, { name: 'Old household', kind: 'family', baseCurrency: 'IDR' });
    await fandri.database.db.run(sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${lineage}, ${oldBook}, ${own}, 'member-Fandri', 'Fandri Bank')`);
    await home.join(fandri, dewi);
    await home.settle();
    expect(await fandri.database.db.values(sql`SELECT entity, id, error FROM sync_skipped`)).toEqual(
      Array.from({ length: (await fandri.database.db.values(sql`SELECT 1 FROM sync_skipped`)).length }, () => ['purchase', lineage, `${HELD_PREFIX}: ${oldBook}`]),
    );
    expect((await skipsOf(fandri.database)).length).toBeGreaterThan(0);
    expect(await headOf(fandri.database, lineage)).toBe(own);
    expect(await fandri.database.db.values(sql`SELECT book_id FROM sync_lineage WHERE lineage_id = ${lineage}`)).toEqual([[oldBook]]);
    expect(await fandri.database.db.values(sql`SELECT description, status FROM transactions WHERE id = ${own}`)).toEqual([['own', 'posted']]);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-9_900);
    expect(await heldElsewhereOf(fandri.database, bookId)).toEqual([{ entity: 'purchase', id: lineage, holderBookId: oldBook, holderName: 'Old household', holderExists: true }]);
  });
});
