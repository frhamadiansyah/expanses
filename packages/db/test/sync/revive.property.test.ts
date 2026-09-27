import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../../src/database';
import { withCapture } from '../../src/sync/capture';
import { Household, projectBook, type Device } from './household';

/*
 * A revivable row (a member, keyed by another row's id) deleted, made again and re-roled by the owner's device and
 * renamed on all three (only an owner writes a role — task 5 fix round 1),
 * with push-only drain steps so one device's change-sets reach the relay long before it pulls anyone else's (§7.2,
 * task 4 fix round 2: every carried field merges by its own hlc, and a delete keeps the row's last values). Whatever
 * the order, every device ends with the same member row, or none.
 */

type Action = 'rename' | 'role' | 'toggle' | 'drain' | 'sync';
type Step = { d: number; a: Action; n: number };

const MEMBER = 'member-X';
const pause = () => new Promise((resolve) => setTimeout(resolve, 2));

async function act(device: Device, bookId: string, step: Step): Promise<void> {
  if (step.a === 'drain') return void (await device.engine.drain(bookId));
  if (step.a === 'sync') return void (await device.engine.syncOnce(bookId));
  // Only an owner writes a role, and making the row again writes one (§8.5): the members' devices only rename.
  if ((step.a === 'role' || step.a === 'toggle') && step.d !== 0) return;
  const [row] = await device.database.db.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${bookId} AND member_id = ${MEMBER}`);
  await device.database.transaction((tx: Tx) =>
    withCapture(tx, { entity: 'member', id: MEMBER, bookId }, async () => {
      if (step.a === 'toggle') {
        if (row) await tx.run(sql`DELETE FROM book_members WHERE book_id = ${bookId} AND member_id = ${MEMBER}`);
        else
          await tx.run(
            sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${MEMBER}, ${`N${step.n}`}, 'member', '2026-09-01')`,
          );
      } else if (row && step.a === 'rename') {
        await tx.run(sql`UPDATE book_members SET name = ${`N${step.n}`} WHERE book_id = ${bookId} AND member_id = ${MEMBER}`);
      } else if (row) {
        await tx.run(sql`UPDATE book_members SET role = ${row[0] === 'owner' ? 'member' : 'owner'} WHERE book_id = ${bookId} AND member_id = ${MEMBER}`);
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
  it('three devices end with the same member row, or none', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 4, maxLength: 24 }), async (steps) => {
        const home = new Household();
        const devices = [await home.device('A'), await home.device('B'), await home.device('C')];
        const bookId = await home.share(devices[0]!);
        await home.join(devices[1]!, devices[0]!);
        await home.join(devices[2]!, devices[0]!);
        await home.settle();
        await act(devices[0]!, bookId, { d: 0, a: 'toggle', n: 0 });
        await home.settle();
        for (const s of steps) await act(devices[s.d]!, bookId, s);
        await home.settle();
        await home.settle();
        const views = await Promise.all(devices.map(async (d) => (await projectBook(d.database, bookId)).member?.[MEMBER] ?? null));
        expect(views[1]).toEqual(views[0]);
        expect(views[2]).toEqual(views[0]);
      }),
      { numRuns: 100 },
    );
  }, 600_000);
});
