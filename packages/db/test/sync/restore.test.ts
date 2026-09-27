import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { postTransaction } from '../../src/index';
import { withCapture } from '../../src/sync/capture';
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
    // The status line asks an owner by name (§11, task 9a).
    expect(await restored.engine.bookSyncStatus(bookId)).toEqual({ state: 'needs_invite', askName: 'Dewi' });

    // Recording works, locally; nothing is captured while the book waits.
    await spend(restored, bookId, 'recorded while waiting');
    expect(await outbox(restored, bookId)).toBe(0);
    expect(await restored.engine.syncOnce(bookId)).toMatchObject({ pushed: 0, applied: 0 });

    const [[memberBefore]] = (await restored.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`)) as [[string]];
    // A restored phone rejoins as the member it was: the owner's invite names that member (§8.7, task 5 fix round 1).
    const { code: wrong } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi' });
    await expect(restored.engine.joinBook(wrong, { ws: restored.ws, memberName: 'Fandri', deviceName: 'new phone' })).rejects.toMatchObject({ code: 'INVITE_MISMATCH' });
    await expect(restored.transport.previewInvite((await restored.engine.previewInvite(wrong)).inviteId)).resolves.toMatchObject({ claimed: false });
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: memberBefore });
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

  it('a refused member edit drained before the backup is put back to the log’s after the rejoin (S4, task 9a)', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    // Fandri, a plain member, makes himself an owner: the log refuses it (§8.5). It is drained, but the backup is taken
    // before this phone pulls its own entry back, which is when a device puts a refused edit of its own back.
    await fandri.database.transaction((tx) =>
      withCapture(tx, { entity: 'member', id: fandri.memberId, bookId }, async () => {
        await tx.run(sql`UPDATE book_members SET role = 'owner' WHERE book_id = ${bookId} AND member_id = ${fandri.memberId}`);
      }),
    );
    expect(await fandri.engine.drain(bookId)).toBe(1);
    const backup = await fandri.database.exportBytes();

    const restored = await home.restore(fandri, backup);
    await restored.engine.checkRestore();
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId });
    await restored.engine.joinBook(code, { ws: restored.ws, memberName: 'Fandri', deviceName: 'new phone' });
    await home.settle();

    const role = async (d: Device) => (await d.database.db.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${bookId} AND member_id = ${fandri.memberId}`))[0]![0];
    expect(await role(dewi)).toBe('member');
    expect(await role(restored)).toBe('member');
    expect(await projectBook(restored.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });
});
