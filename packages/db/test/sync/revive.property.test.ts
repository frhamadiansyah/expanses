import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../../src/database';
import { withCapture } from '../../src/sync/capture';
import { Household, projectBook, type Device } from './household';

/*
 * A revivable row (a member, keyed by another row's id) deleted, made again and re-roled by the owner's device, and
 * renamed by both of its own member's devices — the second linked as the same member (only an owner writes a role —
 * task 5 fix round 1; only a member renames themselves — D-D2), with push-only drain steps so one device's
 * change-sets reach the relay long before it pulls anyone else's (§7.2, task 4 fix round 2: every carried field merges
 * by its own hlc, and a delete keeps the row's last values). Whatever the order, every device ends with the same member
 * rows.
 */

type Action = 'rename' | 'role' | 'toggle' | 'drain' | 'sync';
type Step = { d: number; a: Action; n: number };

const pause = () => new Promise((resolve) => setTimeout(resolve, 2));

/** `subject` is the member of devices 1 and 2: the owner (device 0) toggles and re-roles it; both its devices rename it. */
async function act(device: Device, bookId: string, step: Step, subject: string): Promise<void> {
  if (step.a === 'drain') return void (await device.engine.drain(bookId));
  if (step.a === 'sync') return void (await device.engine.syncOnce(bookId));
  // Only an owner writes a role, and making the row again writes one (§8.5): the members' devices only rename.
  if ((step.a === 'role' || step.a === 'toggle') && step.d !== 0) return;
  // A rename is of the device's own member (D-D2): the owner's device does not rename.
  if (step.a === 'rename' && step.d === 0) return;
  const id = subject;
  const [row] = await device.database.db.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${bookId} AND member_id = ${id}`);
  await device.database.transaction((tx: Tx) =>
    withCapture(tx, { entity: 'member', id, bookId }, async () => {
      if (step.a === 'toggle') {
        if (row) await tx.run(sql`DELETE FROM book_members WHERE book_id = ${bookId} AND member_id = ${id}`);
        else
          await tx.run(
            sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${id}, ${`N${step.n}`}, 'member', '2026-09-01')`,
          );
      } else if (row && step.a === 'rename') {
        await tx.run(sql`UPDATE book_members SET name = ${`N${step.n}`} WHERE book_id = ${bookId} AND member_id = ${id}`);
      } else if (row) {
        await tx.run(sql`UPDATE book_members SET role = ${row[0] === 'owner' ? 'member' : 'owner'} WHERE book_id = ${bookId} AND member_id = ${id}`);
      }
    }),
  );
  // Distinct wall-clock milliseconds between writes, so the three clocks interleave the way real devices do.
  await pause();
}

const step = fc.record({
  d: fc.nat({ max: 2 }),
  a: fc.constantFrom<Action>('rename', 'role', 'toggle', 'toggle', 'drain', 'drain', 'sync'),
  n: fc.nat({ max: 9 }),
});

describe('a revivable row converges under push-only drains (property)', () => {
  it('three devices end with the same member rows', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 4, maxLength: 24 }), async (steps) => {
        const home = new Household();
        const a = await home.device('A');
        const b = await home.device('B');
        const bookId = await home.share(a);
        await home.join(b, a);
        // B's second phone, linked as the same member (§8.3).
        const b2 = await home.device('B2', b.memberId);
        const { code } = await a.engine.createInvite(bookId, { inviterName: 'A', sameMember: true, memberId: b.memberId });
        await b2.engine.joinBook(code, { ws: b2.ws, memberName: 'B', deviceName: 'B tablet' });
        const devices = [a, b, b2];
        await home.settle();
        const subject = devices[1]!.memberId;
        for (const s of steps) await act(devices[s.d]!, bookId, s, subject);
        await home.settle();
        await home.settle();
        const views = await Promise.all(devices.map(async (d) => (await projectBook(d.database, bookId)).member ?? null));
        expect(views[1]).toEqual(views[0]);
        expect(views[2]).toEqual(views[0]);
      }),
      { numRuns: 100 },
    );
  }, 600_000);
});
