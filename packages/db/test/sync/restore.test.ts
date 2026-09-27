import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { postTransaction } from '../../src/index';
import { categoryOf, Household, projectBook, type Device } from './household';

/*
 * A restored backup (spec §8.7, §13 `restore.test.ts`): the database comes back with `shared_books` and `sync_*` but
 * none of the keys — the phone is a new device. At open the book goes to `needs_invite` and its outbox is cleared;
 * recording carries on locally. A fresh invite rejoins it: the book row and member are kept, the log is pulled from 0,
 * and every local row the log never mentioned goes out as new. Then every device agrees.
 */

async function spend(d: Device, bookId: string, description: string, amountMinor = 25_000): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

const state = async (d: Device, bookId: string) => (await d.database.db.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${bookId}`))[0]![0];
const outbox = async (d: Device, bookId: string) => (await d.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${bookId}`))[0]![0];
const descriptions = async (d: Device, bookId: string) =>
  Object.values((await projectBook(d.database, bookId)).purchase!)
    .filter((p) => p !== 'void')
    .map((p) => (p as { description: string }).description)
    .sort();

describe('a restored backup (§8.7)', () => {
  it('goes to needs_invite with its outbox cleared, keeps recording locally, and a rejoin converges', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    await spend(fandri, bookId, 'synced before the backup');
    await home.settle();
    await spend(fandri, bookId, 'in the backup, never drained');
    const backup = await fandri.database.exportBytes();
    expect(await outbox(fandri, bookId)).toBeGreaterThan(0);
    await spend(dewi, bookId, 'Dewi, while the phone was away');
    await dewi.engine.syncOnce(bookId);

    const restored = await home.restore(fandri, backup);
    expect(restored.deviceId).not.toBe(fandri.deviceId);
    expect(await restored.engine.checkRestore()).toEqual([bookId]);
    expect(await state(restored, bookId)).toBe('needs_invite');
    expect(await outbox(restored, bookId)).toBe(0);

    // Recording works, locally; nothing is captured while the book waits.
    await spend(restored, bookId, 'recorded while waiting');
    expect(await outbox(restored, bookId)).toBe(0);
    expect(await restored.engine.syncOnce(bookId)).toMatchObject({ pushed: 0, applied: 0 });

    const [[memberBefore]] = (await restored.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`)) as [[string]];
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi' });
    const { memberId } = await restored.engine.joinBook(code, { ws: restored.ws, memberName: 'Fandri', deviceName: 'new phone' });
    expect(memberId).toBe(memberBefore);
    expect(await state(restored, bookId)).toBe('active');
    const books = await restored.database.db.values(sql`SELECT 1 FROM books WHERE id = ${bookId}`);
    expect(books).toHaveLength(1);

    await home.settle();
    const expected = ['Dewi, while the phone was away', 'in the backup, never drained', 'recorded while waiting', 'synced before the backup'];
    expect(await descriptions(restored, bookId)).toEqual(expected);
    expect(await descriptions(dewi, bookId)).toEqual(expected);
    expect(await projectBook(restored.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });

  it('a book whose keys still open on this device is left alone', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    expect(await fandri.engine.checkRestore()).toEqual([]);
    expect(await state(fandri, bookId)).toBe('active');
  });
});
