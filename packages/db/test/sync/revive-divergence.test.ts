import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withCapture } from '../../src/sync/capture';
import { Household, projectBook, type Device } from './household';

/*
 * Regression (task 4 fix round 2, found by re-review): a revivable row renamed then deleted on one device, while the
 * other — not having pulled — edits another field. Every carried field merges by its own hlc against the values the
 * delete kept beside the tombstone, so both devices end with the rename and the edit.
 */
async function write(d: Device, bookId: string, id: string, statement: string) {
  await d.database.transaction((tx) => withCapture(tx, { entity: 'member', id, bookId }, async () => void (await tx.run(sql.raw(statement)))));
}

const pause = () => new Promise((r) => setTimeout(r, 3));

describe('reviving a row keeps what each field last said', () => {
  it('rename then delete on one device, a role edit on the other: both end with the rename and the role', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    // Only a member renames themselves (D-D2), and only an owner deletes a member row or writes a role (§8.5): Dewi is
    // made an owner, renames herself and deletes her row; Fandri, an owner too, edits her role unaware.
    const id = dewi.memberId;
    await write(fandri, bookId, id, `UPDATE book_members SET role = 'owner' WHERE member_id = '${id}'`);
    await home.settle();
    await home.settle();
    await write(dewi, bookId, id, `UPDATE book_members SET name = 'Dewi renamed' WHERE member_id = '${id}'`);
    await pause();
    await write(dewi, bookId, id, `DELETE FROM book_members WHERE member_id = '${id}'`);
    await dewi.engine.syncOnce(bookId);
    await pause();
    await write(fandri, bookId, id, `UPDATE book_members SET role = 'member' WHERE member_id = '${id}'`);
    await home.settle();
    await home.settle();
    const f = (await projectBook(fandri.database, bookId)).member![id];
    const d = (await projectBook(dewi.database, bookId)).member![id];
    expect(f).toEqual(d);
    expect(f).toMatchObject({ name: 'Dewi renamed', role: 'member' });
  });
});
