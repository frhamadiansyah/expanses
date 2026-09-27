import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { pullAndApply } from '../../src/sync/apply';
import { encodeHlc } from '../../src/sync/hlc';
import type { ChangeSet, LogEntry, SequencedEntry, SyncTransport } from '../../src/sync/types';
import { Household, type Device } from './household';

/*
 * Who may do what (spec §5.4, §8.2, §8.4, §8.5; task 5 fix round 1). A removal of another device needs an owner; an
 * invitee joins only on the terms an owner signed, as a new member or as the member the invite names, once per invite;
 * only an owner writes a member's role; and a device's entries after its own removal count for nothing. A refusal is a
 * recorded skip, the same on every device, never applied and never a reason to rotate.
 */

async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const budi = await home.device('Budi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.join(budi, fandri);
  await home.settle();
  return { home, fandri, dewi, budi, bookId };
}

/** A relay that slips `extra` into `reader`'s next pull, after the real entries. */
function injecting(reader: Device, extra: LogEntry[], signJwkOf: (e: LogEntry) => JsonWebKey): SyncTransport {
  let done = false;
  return Object.assign(Object.create(reader.transport) as SyncTransport, {
    pull: async (relayBookId: string, since: number) => {
      const real = await reader.transport.pull(relayBookId, since);
      if (done) return real;
      done = true;
      const injected = extra.map((e, i): SequencedEntry => ({ ...e, seq: real.latest + 1 + i, signJwk: signJwkOf(e) }));
      return { entries: [...real.entries, ...injected], latest: real.latest + extra.length };
    },
  });
}

const removedAt = async (d: Device, bookId: string, deviceId: string) =>
  (await d.database.db.values<[string | null]>(sql`SELECT removed_at FROM book_devices WHERE book_id = ${bookId} AND device_id = ${deviceId}`))[0]?.[0];
const skips = async (d: Device, bookId: string) =>
  d.database.db.values<[string, string, string]>(sql`SELECT entity, id, error FROM sync_skipped WHERE book_id = ${bookId} ORDER BY seq`);
const epochOf = async (d: Device, bookId: string) => (await d.database.db.values<[number]>(sql`SELECT epoch FROM shared_books WHERE book_id = ${bookId}`))[0]![0];
const roleOf = async (d: Device, bookId: string, memberId: string) =>
  (await d.database.db.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`))[0]?.[0];

describe('removal authority (§8.4, C2)', () => {
  it('the relay refuses a member who is not an owner removing another device', async () => {
    const { home, dewi, budi, bookId } = await household();
    const removal = await dewi.engine.sealer.sign(bookId, { kind: 'removal' as const, deviceId: dewi.deviceId, epoch: 1, hlc: encodeHlc(Date.now(), 0, dewi.deviceId), target: budi.deviceId });
    await expect(dewi.transport.append(home.relayBookId, removal)).rejects.toMatchObject({ status: 403 });
  });

  it("a relay that lets it through anyway: every device skips it, nobody is removed, nobody rotates", async () => {
    const { fandri, dewi, budi, bookId } = await household();
    const removal = await dewi.engine.sealer.sign(bookId, { kind: 'removal' as const, deviceId: dewi.deviceId, epoch: 1, hlc: encodeHlc(Date.now(), 0, dewi.deviceId), target: budi.deviceId });
    const result = await pullAndApply(fandri.database, injecting(fandri, [removal], () => dewi.public.signJwk), fandri.engine.sealer, bookId);
    expect(result.stopped).toBeUndefined();
    expect(result.removals).toEqual([]);
    expect(result.skipped.map((s) => [s.entity, s.id])).toEqual([['removal', budi.deviceId]]);
    expect(await removedAt(fandri, bookId, budi.deviceId)).toBeNull();
    expect(await epochOf(fandri, bookId)).toBe(1);
  });
});

describe('joining on the terms an owner signed (§8.2, C3)', () => {
  /** Eve claims a real invite for a new member, then introduces herself as she likes. */
  async function eveWithInvite(home: Household, owner: Device, bookId: string, sameMember = false) {
    const eve = await home.device('Eve');
    const { code } = await owner.engine.createInvite(bookId, { inviterName: owner.name, sameMember });
    const preview = await eve.engine.previewInvite(code);
    const claim = await eve.transport.claimInvite(preview.inviteId, eve.public);
    const key = (await owner.engine.sealer.epochKey(bookId, 1))!; // what eve opens from claim.keys
    await eve.database.transaction((tx) => eve.engine.sealer.storeEpochKeyTx(tx, bookId, 1, key));
    home.devices.splice(home.devices.indexOf(eve), 1);
    return { eve, terms: preview.terms, claim };
  }

  const introduce = (eve: Device, memberId: string, extra: Partial<ChangeSet> = {}): ChangeSet => ({
    v: 1,
    hlc: encodeHlc(Date.now(), 0, eve.deviceId),
    member: memberId,
    ops: [
      { entity: 'device', id: eve.deviceId, op: 'upsert', fields: { memberId, name: 'Eve', signJwk: JSON.stringify(eve.public.signJwk), agreeJwk: JSON.stringify(eve.public.agreeJwk), addedAt: '2026-09-27', removedAt: null } },
    ],
    ...extra,
  });

  it('an invitee naming the owner member as its own is refused, and cannot become an owner on the relay', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const { eve, terms } = await eveWithInvite(home, fandri, bookId);
    await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, introduce(eve, fandri.memberId, { invite: terms })));
    const result = await fandri.engine.syncOnce(bookId);
    expect(result.introduced).toEqual([]);
    expect((await skips(fandri, bookId)).map(([e, id]) => [e, id])).toEqual([['device', eve.deviceId]]);
    expect(home.relay.peek(home.relayBookId)!.owners.has(eve.deviceId)).toBe(false);
    await expect(eve.transport.removeDevice(home.relayBookId, dewi.deviceId)).rejects.toMatchObject({ status: 403 });
  });

  it('an introduction with no signed terms, after the first entry of the log, is refused', async () => {
    const { home, fandri, bookId } = await household();
    const { eve } = await eveWithInvite(home, fandri, bookId);
    await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, introduce(eve, 'member-eve')));
    const result = await fandri.engine.syncOnce(bookId);
    expect(result.introduced).toEqual([]);
    expect((await skips(fandri, bookId)).map(([e]) => e)).toEqual(['device']);
    // Her later entries are skipped too, not a stop that would block the book.
    const later: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 5, 0, eve.deviceId), member: 'member-eve', ops: [{ entity: 'book', id: bookId, op: 'upsert', fields: { name: 'Owned' } }] };
    await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, later));
    const again = await fandri.engine.syncOnce(bookId);
    expect(again.stopped).toBeUndefined();
    expect((await fandri.database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`))[0]![0]).toBe('Personal');
  });

  it('terms signed for another memberId, or forged, are refused', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const { eve, terms } = await eveWithInvite(home, fandri, bookId, true);
    // A link invite names Fandri's member; Eve claims to be Dewi.
    await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, introduce(eve, dewi.memberId, { invite: terms })));
    expect((await fandri.engine.syncOnce(bookId)).introduced).toEqual([]);
    const { eve: eve2, terms: terms2 } = await eveWithInvite(home, fandri, bookId);
    await eve2.transport.append(home.relayBookId, await eve2.engine.sealer.seal(bookId, 1, introduce(eve2, 'member-eve2', { invite: { ...terms2, sameMember: true, memberId: fandri.memberId } })));
    expect((await fandri.engine.syncOnce(bookId)).introduced).toEqual([]);
    expect((await skips(fandri, bookId)).map(([e]) => e)).toEqual(['device', 'device']);
  });

  it('one invite introduces one device: a second device on the same terms is refused', async () => {
    const { home, fandri, bookId } = await household();
    const { eve, terms } = await eveWithInvite(home, fandri, bookId);
    await eve.transport.append(home.relayBookId, await eve.engine.sealer.seal(bookId, 1, introduce(eve, 'member-eve', { invite: terms })));
    expect((await fandri.engine.syncOnce(bookId)).introduced).toEqual([eve.deviceId]);
    const { eve: mallory } = await eveWithInvite(home, fandri, bookId);
    await mallory.transport.append(home.relayBookId, await mallory.engine.sealer.seal(bookId, 1, introduce(mallory, 'member-mallory', { invite: terms })));
    const result = await fandri.engine.syncOnce(bookId);
    expect(result.introduced).toEqual([]);
    expect((await skips(fandri, bookId)).map(([e, id]) => [e, id])).toEqual([['device', mallory.deviceId]]);
  });
});

describe('only an owner writes a role (§8.5, C3)', () => {
  it("a member making themselves owner is skipped; the owner making them owner is not", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const self: ChangeSet = { v: 1, hlc: encodeHlc(Date.now(), 0, dewi.deviceId), member: dewi.memberId, ops: [{ entity: 'member', id: dewi.memberId, op: 'upsert', fields: { role: 'owner' } }] };
    await dewi.transport.append(home.relayBookId, await dewi.engine.sealer.seal(bookId, 1, self));
    await fandri.engine.syncOnce(bookId);
    expect(await roleOf(fandri, bookId, dewi.memberId)).toBe('member');
    expect((await skips(fandri, bookId)).map(([e, id]) => [e, id])).toEqual([['member', dewi.memberId]]);
    const byOwner: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 10, 0, fandri.deviceId), member: fandri.memberId, ops: [{ entity: 'member', id: dewi.memberId, op: 'upsert', fields: { role: 'owner' } }] };
    await fandri.transport.append(home.relayBookId, await fandri.engine.sealer.seal(bookId, 1, byOwner));
    await home.settle([fandri, dewi]);
    expect(await roleOf(dewi, bookId, dewi.memberId)).toBe('owner');
  });
});

describe("a removed device's later entries count for nothing (I2)", () => {
  it('an entry after its removal, however it reached the log, is a recorded skip on every device', async () => {
    const { fandri, dewi, budi, bookId } = await household();
    await fandri.engine.removeDevice(bookId, budi.deviceId);
    const late: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 60_000, 0, budi.deviceId), member: budi.memberId, ops: [{ entity: 'book', id: bookId, op: 'upsert', fields: { name: 'Budi was here' } }] };
    const entry = await budi.engine.sealer.seal(bookId, 1, late);
    const result = await pullAndApply(dewi.database, injecting(dewi, [entry], () => budi.public.signJwk), dewi.engine.sealer, bookId);
    expect(result.stopped).toBeUndefined();
    expect(result.skipped.map((s) => [s.entity, s.id])).toEqual([['change', budi.deviceId]]);
    expect((await dewi.database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`))[0]![0]).toBe('Personal');
  });
});

/* ------------------------------------------------------------------ fix round 2 */

async function writeMember(d: Device, bookId: string, memberId: string, statement: string) {
  const { withCapture } = await import('../../src/sync/capture');
  await d.database.transaction((tx) => withCapture(tx, { entity: 'member', id: memberId, bookId }, async () => void (await tx.run(sql.raw(statement)))));
}

describe('a member row is an owner’s to delete or make again (N1, fix round 2)', () => {
  it("a plain member's delete of the owner's member row is skipped everywhere; the owner keeps every power", async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    const del: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 1000, 0, dewi.deviceId), member: dewi.memberId, ops: [{ entity: 'member', id: fandri.memberId, op: 'delete' }] };
    await dewi.transport.append(home.relayBookId, await dewi.engine.sealer.seal(bookId, 1, del));
    await home.settle();
    for (const d of [fandri, budi]) expect(await roleOf(d, bookId, fandri.memberId)).toBe('owner');
    expect((await skips(budi, bookId)).map(([e, id]) => [e, id])).toEqual([['member', fandri.memberId]]);
    await fandri.engine.removeDevice(bookId, budi.deviceId);
    await home.settle([fandri, dewi]);
    expect(await removedAt(dewi, bookId, budi.deviceId)).not.toBeNull();
    expect(await epochOf(dewi, bookId)).toBe(2);
  });

  it("a plain member's delete of any member row is skipped, even one that is not the last owner", async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await writeMember(fandri, bookId, budi.memberId, `UPDATE book_members SET role = 'owner' WHERE member_id = '${budi.memberId}'`);
    await home.settle();
    const del: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 1000, 0, dewi.deviceId), member: dewi.memberId, ops: [{ entity: 'member', id: budi.memberId, op: 'delete' }] };
    await dewi.transport.append(home.relayBookId, await dewi.engine.sealer.seal(bookId, 1, del));
    await fandri.engine.syncOnce(bookId);
    expect(await roleOf(fandri, bookId, budi.memberId)).toBe('owner');
    expect((await skips(fandri, bookId)).map(([e, id]) => [e, id])).toEqual([['member', budi.memberId]]);
  });

  it('a plain member cannot make a deleted member row again', async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await writeMember(fandri, bookId, budi.memberId, `DELETE FROM book_members WHERE member_id = '${budi.memberId}'`);
    await home.settle();
    const remake: ChangeSet = {
      v: 1,
      hlc: encodeHlc(Date.now() + 1000, 0, dewi.deviceId),
      member: dewi.memberId,
      ops: [{ entity: 'member', id: budi.memberId, op: 'upsert', fields: { name: 'Budi', role: 'member', joinedAt: '2026-09-01' } }],
    };
    await dewi.transport.append(home.relayBookId, await dewi.engine.sealer.seal(bookId, 1, remake));
    await fandri.engine.syncOnce(bookId);
    expect(await roleOf(fandri, bookId, budi.memberId)).toBeUndefined();
    expect((await skips(fandri, bookId)).map(([e, id]) => [e, id])).toEqual([['member', budi.memberId]]);
  });

  it('the last owner cannot be deleted or demoted: on this device the write is refused, and on apply it is skipped', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await expect(writeMember(fandri, bookId, fandri.memberId, `UPDATE book_members SET role = 'member' WHERE member_id = '${fandri.memberId}'`)).rejects.toThrow(/last owner/);
    await expect(writeMember(fandri, bookId, fandri.memberId, `DELETE FROM book_members WHERE member_id = '${fandri.memberId}'`)).rejects.toThrow(/last owner/);
    const demote: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 1000, 0, fandri.deviceId), member: fandri.memberId, ops: [{ entity: 'member', id: fandri.memberId, op: 'upsert', fields: { role: 'member' } }] };
    await fandri.transport.append(home.relayBookId, await fandri.engine.sealer.seal(bookId, 1, demote));
    await dewi.engine.syncOnce(bookId);
    expect(await roleOf(dewi, bookId, fandri.memberId)).toBe('owner');
    expect((await skips(dewi, bookId)).map(([e, id]) => [e, id])).toEqual([['member', fandri.memberId]]);
  });
});

describe('authority follows the log, never a local edit not yet synced (N2, fix round 2)', () => {
  it('an owner demoting a co-owner locally while that co-owner removes a device: every device agrees on the removal', async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await writeMember(fandri, bookId, budi.memberId, `UPDATE book_members SET role = 'owner' WHERE member_id = '${budi.memberId}'`);
    await home.settle();
    expect(home.relay.peek(home.relayBookId)!.owners.has(budi.deviceId)).toBe(true); // relay owners follow the log
    await budi.engine.removeDevice(bookId, dewi.deviceId);
    await new Promise((r) => setTimeout(r, 3));
    await writeMember(fandri, bookId, budi.memberId, `UPDATE book_members SET role = 'member' WHERE member_id = '${budi.memberId}'`);
    await fandri.engine.syncOnce(bookId);
    await home.settle([fandri, budi]);
    await home.settle([fandri, budi]);
    expect(await removedAt(fandri, bookId, dewi.deviceId)).not.toBeNull();
    expect(await removedAt(budi, bookId, dewi.deviceId)).toBe(await removedAt(fandri, bookId, dewi.deviceId));
    expect(await roleOf(budi, bookId, budi.memberId)).toBe('member');
    expect(home.relay.peek(home.relayBookId)!.owners.has(budi.deviceId)).toBe(false); // and a demotion leaves them
    await fandri.engine.removeDevice(bookId, budi.deviceId);
    const rotations = [...home.relay.peek(home.relayBookId)!.log.values()].filter((e): e is Extract<LogEntry, { kind: 'rotation' }> => e.kind === 'rotation');
    for (const rotation of rotations) expect(rotation.sealed.map((s) => s.deviceId)).not.toContain(dewi.deviceId);
  });
});

describe('a removed device is removed at its place in the log, whatever hlc it picks (N4b, fix round 2)', () => {
  it('an entry backdated just under its removal, but after it in the log, is skipped', async () => {
    const { fandri, dewi, budi, bookId } = await household();
    await fandri.engine.removeDevice(bookId, budi.deviceId);
    await dewi.engine.syncOnce(bookId);
    const [[removalHlc]] = (await dewi.database.db.values<[string]>(
      sql`SELECT hlc FROM sync_field_clocks WHERE entity = 'device' AND id = ${budi.deviceId} AND field = 'removedAt'`,
    )) as [[string]];
    const { decodeHlc } = await import('../../src/sync/hlc');
    const late: ChangeSet = { v: 1, hlc: encodeHlc(decodeHlc(removalHlc).ms - 1, 0, budi.deviceId), member: budi.memberId, ops: [{ entity: 'book', id: bookId, op: 'upsert', fields: { name: 'Budi was here' } }] };
    const entry = await budi.engine.sealer.seal(bookId, 1, late);
    const result = await pullAndApply(dewi.database, injecting(dewi, [entry], () => budi.public.signJwk), dewi.engine.sealer, bookId);
    expect(result.skipped.map((s) => [s.entity, s.id])).toEqual([['change', budi.deviceId]]);
    expect((await dewi.database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`))[0]![0]).toBe('Personal');
  });
});
