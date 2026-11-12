import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { MemberNameError, withCapture } from '../../src/sync/capture';
import { FrozenBookError } from '../../src/sync/engine';
import { encodeHlc } from '../../src/sync/hlc';
import { SharingError } from '../../src/sync/seed';
import type { ChangeSet } from '../../src/sync/types';
import { Household, type Device } from './household';
import { clearOutbox, outboxOps } from './sync-helpers';

/*
 * Rename self (sharing resilience §10.2, D-D2): a member changes the name the others see, from their own member page.
 * Only their own row, only its `name`, through capture (so it never makes a member, `makesMember` false); an owner
 * renaming someone else is refused at capture and, for an op made by hand, skipped on apply; a rename that crossed an
 * owner's delete of the member stays dead on every device (NO_REVIVE).
 */

async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  return { home, fandri, dewi, bookId };
}

const nameOf = async (d: Device, bookId: string, memberId: string) =>
  (await d.database.db.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`))[0]?.[0];
const skips = async (d: Device, bookId: string) =>
  d.database.db.values<[string, string, string]>(sql`SELECT entity, id, error FROM sync_skipped WHERE book_id = ${bookId} ORDER BY seq`);
const code = (error: unknown) => (error instanceof SharingError ? error.code : String(error));

describe('renameSelf (engine)', () => {
  it('trims, writes one captured member op naming only name, and the owner sees the new name after sync', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await clearOutbox(dewi.database);
    // No sync from here: the outbox is looked at before it drains.
    const engine = dewi.engine as unknown as { syncSoon: (bookId: string) => Promise<void> };
    const real = engine.syncSoon.bind(dewi.engine);
    engine.syncSoon = async () => undefined;
    await dewi.engine.renameSelf(bookId, '  Dewi Ratna  ');
    expect(await nameOf(dewi, bookId, dewi.memberId)).toBe('Dewi Ratna');
    const ops = (await outboxOps(dewi.database)).filter((op) => op.entity === 'member');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: 'member', id: dewi.memberId, op: 'upsert', fields: { name: 'Dewi Ratna' } });
    const named = ops[0]!.op === 'upsert' ? (ops[0]!.changed ?? Object.keys(ops[0]!.fields)) : [];
    expect(named).toEqual(['name']);
    engine.syncSoon = real;
    await home.settle();
    expect(await nameOf(fandri, bookId, dewi.memberId)).toBe('Dewi Ratna');
    expect(await nameOf(dewi, bookId, dewi.memberId)).toBe('Dewi Ratna');
    expect(await skips(fandri, bookId)).toEqual([]);
  });

  it('syncs soon: the owner pulls the new name without the member syncing again', async () => {
    const { fandri, dewi, bookId } = await household();
    await dewi.engine.renameSelf(bookId, 'Dewi R');
    await fandri.engine.syncOnce(bookId);
    expect(await nameOf(fandri, bookId, dewi.memberId)).toBe('Dewi R');
  });

  it('an owner renames their own row the same way', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await fandri.engine.renameSelf(bookId, 'Fandri H');
    await home.settle();
    expect(await nameOf(dewi, bookId, fandri.memberId)).toBe('Fandri H');
  });

  it('refuses an empty or whitespace name (NAME_REQUIRED) and one over 40 characters (NAME_TOO_LONG); 40 is fine', async () => {
    const { dewi, bookId } = await household();
    for (const bad of ['', '   ', '\t\n']) {
      expect(code(await dewi.engine.renameSelf(bookId, bad).catch((e: unknown) => e))).toBe('NAME_REQUIRED');
    }
    expect(code(await dewi.engine.renameSelf(bookId, 'x'.repeat(41)).catch((e: unknown) => e))).toBe('NAME_TOO_LONG');
    expect(await nameOf(dewi, bookId, dewi.memberId)).toBe('Dewi');
    // The limit is on the trimmed name.
    await dewi.engine.renameSelf(bookId, `  ${'y'.repeat(40)}  `);
    expect(await nameOf(dewi, bookId, dewi.memberId)).toBe('y'.repeat(40));
  });

  it('the same name again writes nothing', async () => {
    const { dewi, bookId } = await household();
    await clearOutbox(dewi.database);
    const engine = dewi.engine as unknown as { syncSoon: (bookId: string) => Promise<void> };
    engine.syncSoon = async () => undefined;
    await dewi.engine.renameSelf(bookId, ' Dewi ');
    expect((await outboxOps(dewi.database)).filter((op) => op.entity === 'member')).toEqual([]);
  });

  it('is refused on a book not shared here (NOT_FOUND), one this member left (NOT_FOUND), and a frozen book', async () => {
    const { home, fandri, dewi, bookId } = await household();
    expect(code(await dewi.engine.renameSelf('no-such-book', 'Dewi R').catch((e: unknown) => e))).toBe('NOT_FOUND');

    // Frozen: the only owner's only device is gone behind the engine's back (as edges.test.ts does).
    const hlc = encodeHlc(Date.now(), 0, fandri.deviceId);
    const removal = await fandri.engine.sealer.sign(bookId, { kind: 'removal' as const, deviceId: fandri.deviceId, epoch: 1, hlc, target: fandri.deviceId });
    await fandri.transport.append(home.relayBookId, removal);
    await fandri.transport.removeDevice(home.relayBookId, fandri.deviceId);
    await home.settle([dewi]);
    await expect(dewi.engine.renameSelf(bookId, 'Dewi R')).rejects.toBeInstanceOf(FrozenBookError);
    expect(await nameOf(dewi, bookId, dewi.memberId)).toBe('Dewi');

    await dewi.engine.leave(bookId);
    expect(code(await dewi.engine.renameSelf(bookId, 'Dewi R').catch((e: unknown) => e))).toBe('NOT_FOUND');
  });
});

describe('only self (D-D2)', () => {
  it("an owner's write of another member's name is refused on the owner's device, and nothing is emitted", async () => {
    const { dewi, fandri, bookId } = await household();
    await clearOutbox(fandri.database);
    await expect(
      fandri.database.transaction((tx) =>
        withCapture(tx, { entity: 'member', id: dewi.memberId, bookId }, async () => {
          await tx.run(sql`UPDATE book_members SET name = 'Someone else' WHERE book_id = ${bookId} AND member_id = ${dewi.memberId}`);
        }),
      ),
    ).rejects.toBeInstanceOf(MemberNameError);
    expect(await nameOf(fandri, bookId, dewi.memberId)).toBe('Dewi');
    expect(await outboxOps(fandri.database)).toEqual([]);
  });

  it("a forged op renaming another member is skipped by authority on every device, the owner's included", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const forged: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now() + 1000, 0, fandri.deviceId),
      member: fandri.memberId,
      ops: [{ entity: 'member', id: dewi.memberId, op: 'upsert', fields: { name: 'Relabelled' }, changed: ['name'] }],
    };
    await fandri.transport.append(home.relayBookId, await fandri.engine.sealer.seal(bookId, 1, forged));
    await home.settle();
    for (const d of [fandri, dewi]) {
      expect(await nameOf(d, bookId, dewi.memberId)).toBe('Dewi');
      expect((await skips(d, bookId)).map(([e, id, error]) => [e, id, /name/.test(error)])).toEqual([['member', dewi.memberId, true]]);
    }
  });

  it("a plain member's forged rename of the owner is skipped too", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const forged: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now() + 1000, 0, dewi.deviceId),
      member: dewi.memberId,
      ops: [{ entity: 'member', id: fandri.memberId, op: 'upsert', fields: { name: 'Relabelled' } }],
    };
    await dewi.transport.append(home.relayBookId, await dewi.engine.sealer.seal(bookId, 1, forged));
    await home.settle();
    for (const d of [fandri, dewi]) expect(await nameOf(d, bookId, fandri.memberId)).toBe('Fandri');
  });

  it("an owner's op carrying another member's role and name keeps the role and drops the name", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const mixed: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now() + 1000, 0, fandri.deviceId),
      member: fandri.memberId,
      ops: [{ entity: 'member', id: dewi.memberId, op: 'upsert', fields: { name: 'Relabelled', role: 'owner' }, changed: ['name', 'role'] }],
    };
    await fandri.transport.append(home.relayBookId, await fandri.engine.sealer.seal(bookId, 1, mixed));
    await home.settle();
    for (const d of [fandri, dewi]) {
      expect(await nameOf(d, bookId, dewi.memberId)).toBe('Dewi');
      const [role] = (await d.database.db.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${bookId} AND member_id = ${dewi.memberId}`))[0]!;
      expect(role).toBe('owner');
    }
  });
});

describe('a name carried at its own clock is no claim (fix round 1)', () => {
  it("an owner's whole-row op naming only role, carrying another member's name at a clock, merges by last writer on every device, no skip", async () => {
    const { home, fandri, dewi, bookId } = await household();
    // A third phone, an owner's, sends it, so Fandri's and Dewi's phones both apply it (a phone takes its own entries as
    // already true).
    const budi = await home.device('Budi');
    await home.join(budi, fandri);
    await home.settle();
    await fandri.engine.makeOwner(bookId, budi.memberId);
    await home.settle();
    await home.settle();
    // The shape a rejoin (emitNewerTx), or an older build's whole-row edit, sends: role named, name carried at its clock.
    const at = encodeHlc(Date.now() + 500, 0, budi.deviceId);
    const carry: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now() + 1000, 0, budi.deviceId),
      member: budi.memberId,
      ops: [{ entity: 'member', id: dewi.memberId, op: 'upsert', fields: { name: 'Dewi Lama', role: 'member', joinedAt: '2026-09-01' }, changed: ['role'], clocks: { name: at, joinedAt: at } }],
    };
    await budi.transport.append(home.relayBookId, await budi.engine.sealer.seal(bookId, 1, carry));
    await home.settle();
    for (const d of [fandri, dewi]) {
      expect(await nameOf(d, bookId, dewi.memberId)).toBe('Dewi Lama');
      expect(await skips(d, bookId)).toEqual([]);
    }
    // Dewi's own later rename wins over the carried one, on both.
    await dewi.engine.renameSelf(bookId, 'Dewi Baru');
    await home.settle();
    for (const d of [fandri, dewi]) expect(await nameOf(d, bookId, dewi.memberId)).toBe('Dewi Baru');
  });

  it('a carried name with no claim at all (changed empty) merges the same way, and an older clock loses', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await dewi.engine.renameSelf(bookId, 'Dewi Baru');
    await home.settle();
    const carry: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now() + 1000, 0, fandri.deviceId),
      member: fandri.memberId,
      ops: [{ entity: 'member', id: dewi.memberId, op: 'upsert', fields: { name: 'Dewi' }, changed: [], clocks: { name: encodeHlc(1, 0, fandri.deviceId) } }],
    };
    await fandri.transport.append(home.relayBookId, await fandri.engine.sealer.seal(bookId, 1, carry));
    await home.settle();
    for (const d of [fandri, dewi]) {
      expect(await nameOf(d, bookId, dewi.memberId)).toBe('Dewi Baru');
      expect(await skips(d, bookId)).toEqual([]);
    }
  });
});

describe('a rename racing a removal (NO_REVIVE)', () => {
  it("a member's rename that crossed the owner's delete of her row stays dead on both devices", async () => {
    const { home, fandri, dewi, bookId } = await household();
    // The owner deletes Dewi's member row; Dewi, not having pulled it, renames herself (a later clock).
    await fandri.database.transaction((tx) =>
      withCapture(tx, { entity: 'member', id: dewi.memberId, bookId }, async () => {
        await tx.run(sql`DELETE FROM book_members WHERE book_id = ${bookId} AND member_id = ${dewi.memberId}`);
      }),
    );
    await fandri.engine.syncOnce(bookId);
    await new Promise((r) => setTimeout(r, 3));
    const engine = dewi.engine as unknown as { syncSoon: (bookId: string) => Promise<void> };
    const real = engine.syncSoon.bind(dewi.engine);
    engine.syncSoon = async () => undefined;
    await dewi.engine.renameSelf(bookId, 'Dewi R');
    engine.syncSoon = real;
    await home.settle();
    await home.settle();
    for (const d of [fandri, dewi]) expect(await nameOf(d, bookId, dewi.memberId)).toBeUndefined();
  });

  it("an owner's self-rename that crossed another owner's delete of their row stays dead too", async () => {
    const { home, fandri, dewi, bookId } = await household();
    await fandri.engine.makeOwner(bookId, dewi.memberId);
    await home.settle();
    await home.settle();
    await fandri.database.transaction((tx) =>
      withCapture(tx, { entity: 'member', id: dewi.memberId, bookId }, async () => {
        await tx.run(sql`DELETE FROM book_members WHERE book_id = ${bookId} AND member_id = ${dewi.memberId}`);
      }),
    );
    await fandri.engine.syncOnce(bookId);
    await new Promise((r) => setTimeout(r, 3));
    const engine = dewi.engine as unknown as { syncSoon: (bookId: string) => Promise<void> };
    const real = engine.syncSoon.bind(dewi.engine);
    engine.syncSoon = async () => undefined;
    await dewi.engine.renameSelf(bookId, 'Dewi R');
    engine.syncSoon = real;
    await home.settle();
    await home.settle();
    for (const d of [fandri, dewi]) expect(await nameOf(d, bookId, dewi.memberId)).toBeUndefined();
  });
});
