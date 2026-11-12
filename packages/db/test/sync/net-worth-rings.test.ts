import { resolveRings } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activeNetWorthGroup, NetWorthError, ringPicks, setOwnRing } from '../../src/index';
import { entityOf, type RowEntity } from '../../src/sync/shared-entities';
import { Household, type Device } from './household';

/*
 * Owner rings (owner, 12 Nov): each member picks their own ring colour, and the pick travels in the group log on the
 * member's own `nw_pending` row, so the same person is the same colour on every phone. Rina and Andi file in one
 * group; Sari is in the workspace and never in it.
 */

/**
 * A build from before rings, on one phone: its nw_pending row synced only `count`, and its table had no ring columns.
 * Only that phone's own syncs run under the older field map; every other phone runs this build.
 */
const older = new Set<Device>();

async function asOlderBuild<T>(run: () => Promise<T>): Promise<T> {
  const entity = entityOf('nw_pending') as RowEntity;
  const fields = entity.fields;
  (entity as { fields: Record<string, string> }).fields = { count: 'count' };
  try {
    return await run();
  } finally {
    (entity as { fields: Record<string, string> }).fields = fields;
  }
}

async function syncAll(home: Household, devices: readonly Device[] = home.devices) {
  for (let round = 0; round < 2; round += 1)
    for (const d of devices) await (older.has(d) ? asOlderBuild(() => d.engine.syncOnce(home.bookId)) : d.engine.syncOnce(home.bookId));
}

async function settle(home: Household, devices?: readonly Device[]) {
  for (let i = 0; i < 3; i += 1) await syncAll(home, devices);
}

async function group(mode: 'joint' | 'separate' = 'joint', options: { olderAndi?: boolean } = {}) {
  older.clear();
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari');
  if (options.olderAndi) {
    await andi.database.execScript('ALTER TABLE nw_pending DROP COLUMN ring_json; ALTER TABLE nw_pending DROP COLUMN ring_devices_json;');
    older.add(andi);
  }
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await syncAll(home);
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode, members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  const active = (await activeNetWorthGroup(rina.database))!;
  return { home, rina, andi, sari, bookId, groupBookId: active.groupBookId, members: active.members };
}

/** The older phone updates to this build: migration 0110 runs, and its syncs read rings from now on. */
async function update(d: Device) {
  await d.database.execScript('ALTER TABLE nw_pending ADD COLUMN ring_json TEXT; ALTER TABLE nw_pending ADD COLUMN ring_devices_json TEXT;');
  older.delete(d);
}

/** The colours a phone draws, from its own copy of the group log. */
async function ringsOn(d: Device, groupBookId: string, members: readonly string[]) {
  return resolveRings(members, await ringPicks(d.database, groupBookId));
}

const T0 = new Date('2026-11-12T03:00:00.000Z');
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('ring colours (owner rings, 12 Nov)', () => {
  it('nobody picked: both phones draw each person by their place in the group, as before', async () => {
    const { rina, andi, groupBookId, members } = await group();
    const expected = { [rina.memberId]: 'blue', [andi.memberId]: 'purple' };
    expect(await ringsOn(rina, groupBookId, members)).toEqual(expected);
    expect(await ringsOn(andi, groupBookId, members)).toEqual(expected);
  });

  it('Rina picks teal: it reaches Andi’s phone, and both draw her teal', async () => {
    const { home, rina, andi, sari, groupBookId, members } = await group();
    await setOwnRing(rina.database, 'teal', T0);
    await settle(home);
    expect(await ringPicks(andi.database, groupBookId)).toEqual({ [rina.memberId]: { colour: 'teal', at: T0.toISOString() } });
    const expected = { [rina.memberId]: 'teal', [andi.memberId]: 'purple' };
    expect(await ringsOn(rina, groupBookId, members)).toEqual(expected);
    expect(await ringsOn(andi, groupBookId, members)).toEqual(expected);
    // Sari is not in the group: the group log, and so the pick, never reaches her.
    expect(await sari.database.db.values(sql`SELECT * FROM nw_pending`)).toEqual([]);
    // The count beside it is untouched: a ring is not an item still to share.
    const [count] = await andi.database.db.values<[number]>(sql`SELECT count FROM nw_pending WHERE book_id = ${groupBookId} AND member_id = ${rina.memberId}`);
    expect(Number(count![0])).toBe(0);
  });

  it('a pick works with separate tax IDs too', async () => {
    const { home, rina, andi, groupBookId, members } = await group('separate');
    await setOwnRing(andi.database, 'brown', T0);
    await settle(home);
    expect((await ringsOn(rina, groupBookId, members))[andi.memberId]).toBe('brown');
  });

  it('a colour the other holds is refused, and so is one outside the palette', async () => {
    const { rina } = await group();
    // Andi holds purple by his place in the group.
    await expect(setOwnRing(rina.database, 'purple', T0)).rejects.toMatchObject({ code: 'ring-taken' });
    await expect(setOwnRing(rina.database, 'red' as never, T0)).rejects.toBeInstanceOf(NetWorthError);
  });

  it('two picks of one colour race: the earlier wins on both phones, the later falls back to the first free colour', async () => {
    const { home, rina, andi, groupBookId, members } = await group();
    // Neither phone has heard the other's pick when it makes its own.
    await setOwnRing(andi.database, 'orange', later(5));
    await setOwnRing(rina.database, 'orange', T0);
    await settle(home);
    const expected = { [rina.memberId]: 'orange', [andi.memberId]: 'blue' };
    expect(await ringsOn(rina, groupBookId, members)).toEqual(expected);
    expect(await ringsOn(andi, groupBookId, members)).toEqual(expected);
  });

  it('a later pick replaces the earlier one on both phones', async () => {
    const { home, rina, andi, groupBookId, members } = await group();
    await setOwnRing(rina.database, 'teal', T0);
    await settle(home);
    await setOwnRing(rina.database, 'magenta', later(60));
    await settle(home);
    expect((await ringsOn(andi, groupBookId, members))[rina.memberId]).toBe('magenta');
  });

  it('without a group there is nothing to pick for', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    await expect(setOwnRing(rina.database, 'teal', T0)).rejects.toMatchObject({ code: 'not-listed' });
  });

  it('settling again with nothing new writes nothing more: a phone does not resend its ring on every sync', async () => {
    const { home, rina, groupBookId } = await group();
    await setOwnRing(rina.database, 'teal', T0);
    await settle(home);
    const outbox = async () => Number((await rina.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${groupBookId}`))[0]![0]);
    await settle(home);
    const [before] = await rina.database.db.values<[string]>(sql`SELECT ring_json FROM nw_pending WHERE book_id = ${groupBookId} AND member_id = ${rina.memberId}`);
    await settle(home);
    const [after] = await rina.database.db.values<[string]>(sql`SELECT ring_json FROM nw_pending WHERE book_id = ${groupBookId} AND member_id = ${rina.memberId}`);
    expect(after).toEqual(before);
    expect(await outbox()).toBe(0);
  });
});

describe('an older build in the household', () => {
  it('ignores the ring it does not know and keeps syncing; once it updates, the pick it missed is sent again', async () => {
    const { home, rina, andi, groupBookId, members } = await group('joint', { olderAndi: true });
    await setOwnRing(rina.database, 'teal', T0);
    await settle(home);

    // The older phone applies Rina's row — its count — and records no refusal: the unknown fields are passed over.
    expect(await andi.database.db.values(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
    const [count] = await andi.database.db.values<[number]>(sql`SELECT count FROM nw_pending WHERE book_id = ${groupBookId} AND member_id = ${rina.memberId}`);
    expect(Number(count![0])).toBe(0);

    // Andi's phone updates: the ring it passed over is not in its copy yet...
    await update(andi);
    expect(await ringPicks(andi.database, groupBookId)).toEqual({});
    // ...and the next syncs bring it: his phone says it now reads rings, and Rina's phone sends her pick again.
    await settle(home);
    expect(await ringPicks(andi.database, groupBookId)).toEqual({ [rina.memberId]: { colour: 'teal', at: T0.toISOString() } });
    expect(await ringsOn(andi, groupBookId, members)).toEqual(await ringsOn(rina, groupBookId, members));
    expect(await andi.database.db.values(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
  });

  it('a pick sent again keeps its first time, so a race it won stays won', async () => {
    const { home, rina, andi, groupBookId, members } = await group('joint', { olderAndi: true });
    await setOwnRing(rina.database, 'teal', T0);
    await settle(home);
    await update(andi);
    // Andi, updated but not yet synced, picks teal himself — later than Rina did.
    await setOwnRing(andi.database, 'teal', later(600));
    await settle(home);
    const expected = { [rina.memberId]: 'teal', [andi.memberId]: 'blue' };
    expect(await ringsOn(rina, groupBookId, members)).toEqual(expected);
    expect(await ringsOn(andi, groupBookId, members)).toEqual(expected);
  });
});

describe('two devices of one member', () => {
  /** What waits to go out in a group log, on every phone: zero once nothing is left to send. */
  async function waiting(home: Household, groupBookId: string) {
    let n = 0;
    for (const d of home.devices) n += Number((await d.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${groupBookId}`))[0]![0]);
    return n;
  }

  it('Rina’s tablet on an older build updates: all three phones agree, and the syncs fall quiet', async () => {
    older.clear();
    const home = new Household();
    const rina = await home.device('Rina');
    const tablet = await home.device('Tablet', 'member-Rina');
    const andi = await home.device('Andi');
    await tablet.database.execScript('ALTER TABLE nw_pending DROP COLUMN ring_json; ALTER TABLE nw_pending DROP COLUMN ring_devices_json;');
    older.add(tablet);
    const bookId = await home.share(rina);
    const { code } = await rina.engine.linkDevice(bookId, { inviterName: 'Rina' });
    await tablet.engine.joinBook(code, { ws: tablet.ws, memberName: 'Rina', deviceName: 'Tablet' });
    await home.join(andi, rina);
    await settle(home);
    const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
    await settle(home);
    await settle(home);
    const active = (await activeNetWorthGroup(rina.database))!;
    expect((await activeNetWorthGroup(tablet.database))?.groupBookId).toBe(active.groupBookId);

    await setOwnRing(rina.database, 'teal', T0);
    await setOwnRing(andi.database, 'orange', later(1));
    await settle(home);
    await settle(home);
    // The older tablet passed both picks over.
    expect(await ringPicks(tablet.database, active.groupBookId)).toEqual({});

    await update(tablet);
    const rounds: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      await syncAll(home);
      rounds.push(await waiting(home, active.groupBookId));
    }
    const want = { [rina.memberId]: 'teal', [andi.memberId]: 'orange' };
    for (const d of home.devices) expect(await ringsOn(d, active.groupBookId, active.members)).toEqual(want);
    // Nothing keeps going back and forth: the last syncs send nothing.
    expect(rounds.slice(-3)).toEqual([0, 0, 0]);
  });
});
