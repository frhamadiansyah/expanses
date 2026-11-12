import { isRingColour, parseRingPick, type RingColour, type RingPick, takenRings } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { Database, Db } from '../../database';
import { activeNetWorthGroup, NetWorthError } from '../../repos/net-worth-sharing';
import { withCapture } from '../capture';

/*
 * Owner rings (owner, 12 Nov): each member's own ring colour travels in the net-worth group log, on the member's own
 * `nw_pending` row — the one row of the group log each member alone writes (its `writer` is the member it is keyed
 * by), so nobody sets another's colour, and only the group's members ever hold it. Two fields (migration 0110):
 *
 * - `ring` (`ring_json`): the pick, `{ colour, at, sent }`. `at` is when it was picked and settles a race for one
 *   colour (`resolveRings`: the earlier pick wins); `sent` is when it was last written, so sending the same pick again
 *   is a change capture carries.
 * - `ringDevices` (`ring_devices_json`): `{ devices, seen }` — the member's devices that run a build which reads rings
 *   (each adds itself on its first sync), and, per member, the devices this member's pick was last sent with.
 *
 * Why the second field: a build from before rings applies the row's `count` and passes the ring over (apply writes
 * only the fields it knows), and records that it has seen it, so once that phone updates it would never hear the pick.
 * The updated phone adds itself to its member's `devices`; every phone holding a pick sees a member's devices change
 * from what it last sent with and sends its pick again — with its first `at`, so a race it won stays won.
 */

interface RingDevices {
  devices: string[];
  seen: Record<string, string>;
}

function parseDevices(json: string | null | undefined): RingDevices | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as { devices?: unknown; seen?: unknown } | null;
    if (!value) return null;
    const devices = Array.isArray(value.devices) ? value.devices.filter((d): d is string => typeof d === 'string') : [];
    const seen: Record<string, string> = {};
    if (value.seen && typeof value.seen === 'object') for (const [member, list] of Object.entries(value.seen)) if (typeof list === 'string') seen[member] = list;
    return { devices, seen };
  } catch {
    return null;
  }
}

/** Whether migration 0110 has run here: a database stopped before it has no rings to read or write. */
async function ringColumnsExist(db: Db): Promise<boolean> {
  const columns = await db.values<[string]>(sql`SELECT name FROM pragma_table_info('nw_pending') WHERE name IN ('ring_json', 'ring_devices_json')`);
  return columns.length === 2;
}

interface RingRow {
  member: string;
  pick: RingPick | null;
  /** The pick as stored, `sent` and all, to write back unchanged. */
  ringJson: string | null;
  devices: RingDevices | null;
}

async function ringRows(db: Db, groupBookId: string): Promise<RingRow[]> {
  if (!(await ringColumnsExist(db))) return [];
  const rows = await db.values<[string, string | null, string | null]>(sql`SELECT member_id, ring_json, ring_devices_json FROM nw_pending WHERE book_id = ${groupBookId}`);
  return rows.map(([member, ringJson, devicesJson]) => ({ member, pick: parseRingPick(ringJson), ringJson, devices: parseDevices(devicesJson) }));
}

/** Each member's own pick in a group log, as this phone holds it; a member who never picked is absent. */
export async function ringPicks(source: Database | Db, groupBookId: string): Promise<Record<string, RingPick>> {
  const db = 'exportBytes' in source ? source.db : source;
  const out: Record<string, RingPick> = {};
  for (const row of await ringRows(db, groupBookId)) if (row.pick) out[row.member] = row.pick;
  return out;
}

/** A member's devices as one comparable string: sorted, joined. Empty for a member whose devices never said. */
const devicesKey = (devices: RingDevices | null) => [...(devices?.devices ?? [])].sort().join(',');

/** Writes this member's own row: the pick and the devices field, through capture, so the group log carries them. */
async function writeOwnTx(tx: Db, groupBookId: string, me: string, ringJson: string | null, devices: RingDevices): Promise<void> {
  const devicesJson = JSON.stringify({ devices: [...devices.devices].sort(), seen: devices.seen });
  await withCapture(tx, { entity: 'nw_pending', id: me, bookId: groupBookId }, async () => {
    await tx.run(sql`
      INSERT INTO nw_pending (book_id, member_id, count, ring_json, ring_devices_json) VALUES (${groupBookId}, ${me}, 0, ${ringJson}, ${devicesJson})
      ON CONFLICT (book_id, member_id) DO UPDATE SET ring_json = excluded.ring_json, ring_devices_json = excluded.ring_devices_json`);
  });
}

const TAKEN = 'That colour is someone else’s in the household, so two people never share one.';

/**
 * This member picks their own ring colour, in the active group (either mode). Refused with no group (`not-listed`),
 * for a colour outside the palette (`invalid`), or for one another member holds here (`ring-taken`). Picking the
 * colour already held changes nothing. `now` stands in for the clock in tests.
 */
export async function setOwnRing(database: Database, colour: RingColour, now: Date = new Date()): Promise<void> {
  if (!isRingColour(colour)) throw new NetWorthError('invalid', 'That is not one of the ring colours.');
  await database.transaction(async (tx) => {
    const group = await activeNetWorthGroup(tx);
    if (!group) throw new NetWorthError('not-listed', 'There is no household group to pick a ring colour for.');
    if (!(await ringColumnsExist(tx))) throw new NetWorthError('invalid', 'This database cannot keep a ring colour yet.');
    const rows = await ringRows(tx, group.groupBookId);
    const picks = Object.fromEntries(rows.filter((row) => row.pick).map((row) => [row.member, row.pick!]));
    if (picks[group.me]?.colour === colour) return;
    if (takenRings(group.members, picks, group.me)[colour]) throw new NetWorthError('ring-taken', TAKEN);
    const at = now.toISOString();
    const mine = rows.find((row) => row.member === group.me)?.devices ?? { devices: [], seen: {} };
    // What the pick is sent with: every member's devices as this phone knows them now.
    const seen = Object.fromEntries(group.members.map((member) => [member, devicesKey(rows.find((row) => row.member === member)?.devices ?? null)]));
    await writeOwnTx(tx, group.groupBookId, group.me, JSON.stringify({ colour, at, sent: at }), { devices: mine.devices, seen });
  });
}

/**
 * After a sync (`afterWorkspaceSync`): this device adds itself to its member's `devices` when it is not there yet,
 * and this member's pick is sent again when any member's devices differ from what it was last sent with — a phone
 * updated from a build that passed rings over. Writes nothing when neither holds, so a quiet sync stays quiet.
 */
export async function refreshRing(database: Database, deviceId: string, now: Date = new Date()): Promise<void> {
  await database.transaction(async (tx) => {
    const group = await activeNetWorthGroup(tx);
    if (!group || !(await ringColumnsExist(tx))) return;
    const rows = await ringRows(tx, group.groupBookId);
    const own = rows.find((row) => row.member === group.me) ?? null;
    const mine: RingDevices = own?.devices ?? { devices: [], seen: {} };
    const joins = !mine.devices.includes(deviceId);
    const devices: RingDevices = { devices: joins ? [...mine.devices, deviceId] : mine.devices, seen: mine.seen };
    const current = Object.fromEntries(
      group.members.map((member) => [member, member === group.me ? devicesKey(devices) : devicesKey(rows.find((row) => row.member === member)?.devices ?? null)]),
    );
    const pick = own?.pick ?? null;
    const resend = pick !== null && group.members.some((member) => (mine.seen[member] ?? '') !== current[member]);
    if (!joins && !resend) return;
    const ringJson = resend ? JSON.stringify({ colour: pick!.colour, at: pick!.at, sent: now.toISOString() }) : (own?.ringJson ?? null);
    await writeOwnTx(tx, group.groupBookId, group.me, ringJson, resend ? { devices: devices.devices, seen: current } : devices);
  });
}
