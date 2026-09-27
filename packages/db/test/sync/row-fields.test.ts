import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withCapture } from '../../src/sync/capture';
import { encodeHlc } from '../../src/sync/hlc';
import { Household, projectBook, type Device } from './household';

/*
 * Rule 1 is per field for every entity, revivable ones included (task 4 fix round 1): a revivable row travels whole,
 * but its op names the fields that changed, and only those win and take a clock. A removal stamps `removedAt`'s clock,
 * so a later edit of another field by a device that has not seen the removal cannot undo it.
 */
async function editRow(d: Device, bookId: string, entity: 'member' | 'device', id: string, set: string) {
  await d.database.transaction((tx) =>
    withCapture(tx, { entity, id, bookId }, async () => {
      const table = entity === 'member' ? 'book_members' : 'book_devices';
      const key = entity === 'member' ? 'member_id' : 'device_id';
      await tx.run(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(set)} WHERE book_id = ${bookId} AND ${sql.raw(key)} = ${id}`);
    }),
  );
}

describe('per-field merge on rows that travel whole', () => {
  it('a name edited on one device and a role on another, offline: both survive everywhere', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    await editRow(fandri, bookId, 'member', dewi.memberId, "role = 'owner'");
    await editRow(dewi, bookId, 'member', dewi.memberId, "name = 'Dewi R.'");
    await home.settle();
    for (const d of [fandri, dewi]) expect((await projectBook(d.database, bookId)).member![dewi.memberId]).toMatchObject({ name: 'Dewi R.', role: 'owner' });
  });

  it('a device renamed after its removal, by a device that had not seen it, stays removed', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    await fandri.transport.append(home.relayBookId, await fandri.engine.sealer.sign({ kind: 'removal' as const, deviceId: fandri.deviceId, epoch: 1, hlc: encodeHlc(Date.now(), 0, fandri.deviceId), target: dewi.deviceId }));
    await new Promise((r) => setTimeout(r, 5));
    await editRow(dewi, bookId, 'device', dewi.deviceId, "name = 'Dewi iPad'");
    await home.settle();
    const views = await Promise.all([fandri, dewi].map((d) => projectBook(d.database, bookId)));
    for (const view of views) {
      const row = view.device![dewi.deviceId] as { name: string; removedAt: string | null };
      expect(row.name).toBe('Dewi iPad');
      expect(row.removedAt).not.toBeNull();
    }
    expect(views[0]).toEqual(views[1]);
  });

  it('a removal moves the clock past its hlc, so the next local write sorts after it (fix round 2)', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    const ahead = Date.now() + 60 * 60 * 1000;
    await fandri.transport.append(home.relayBookId, await fandri.engine.sealer.sign({ kind: 'removal' as const, deviceId: fandri.deviceId, epoch: 1, hlc: encodeHlc(ahead, 5, fandri.deviceId), target: dewi.deviceId }));
    await dewi.engine.syncOnce(bookId);
    const [[clock]] = (await dewi.database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = 'sync.hlc'`)) as [[string]];
    expect(JSON.parse(clock)).toEqual({ ms: ahead, counter: 5 });
  });
});
