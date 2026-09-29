import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { Database, Tx } from '../../database';
import { CLOSED_LINK_PREFIX, GROUP_LINK_NS, groupLogWorkspaceOf, isClosedLink, OWN_LINK_PENDING_KEY, viewActiveDevices, viewDevice } from '../authority';
import { captureConfigOf, rowUpsertsTx, withCapture, writeChangeSetsTx } from '../capture';
import { fromUtf8, hkdf, openSealedKey, randomBytes, sealKeyFor, utf8 } from '../crypto';
import type { SyncOnceResult } from '../engine';
import { encodeInviteCode, inviteAad, INVITE_TTL_MS, inviteKeyOf, newInviteSecret, openInviteJson, parseInviteCode, sealInviteJson, type InviteKey } from '../invite';
import type { DeviceKeys } from '../keys';
import { base64UrlToBytes, bytesToBase64Url, inviteSigningBytes } from '../relay-signing';
import type { Sealer } from '../seal';
import { SharingError } from '../seed';
import type { InviteRecord, SyncTransport } from '../types';
import { SyncTransportError } from '../types';
import { uuidv5 } from '../uuidv5';
import { meetsMinVersion } from './version';

/*
 * The net-worth group's own log (joint-net-worth spec §4, task 4). The workspace log is read by every workspace member,
 * so what only the group may read goes into a second shared book on the relay — the group log — whose epoch keys only
 * the group members' devices ever hold. It is the sharing machinery unchanged (HLC, change-sets, sealing, signing,
 * pinning, removal, rotation); what differs is how a device gets in.
 *
 * - The group log is a `shared_books` row with no `books` row, under an id every device shares (`groupBookId`),
 *   announced in the workspace log by the row `net_worth_group` (`group_logs`). Which group logs this device holds, and
 *   for which workspace, is its own local record (`nw_group_books`), written when it makes or joins one: any workspace
 *   member may rewrite the synced link, and a rewrite must never move a device off the group log it is in, nor make a
 *   workspace book read as a group log. The link only tells a device what to join. `bookContextTx` reads the workspace
 *   for a group log from the local record; every workspace reader skips the group logs it names.
 * - No seeding: the log starts with its creator's introduction and nothing else.
 * - No invite code (task 4 ruling). The relay admits a device only by an invite claim, and a device can read a log
 *   only with the epoch key of its first entry — which no rotation in the log can hand it before it reads that entry.
 *   So admitting a member makes one relay invite per device of theirs the workspace has pinned, carrying every epoch
 *   key as §8.1's invites do, and seals that invite's code to the device's own pinned agreement key (§5.3's ECDH
 *   sealing, `sealKeyFor`). The sealed codes travel in the `net_worth_group` row, with no device id beside them: each
 *   device tries each one, and only its own opens. A member outside the group sees how many invites wait, nothing
 *   more, and can open none.
 * - Admission (authority.ts `introductionRefusal`): in a group log, a device is admitted when the linked workspace's
 *   view pinned it as the same member — no invite terms. Every group member is an owner, on the relay too (the view's
 *   owners are handed to it as for any book, `followOwners`), so any of them can admit a device or remove a member.
 * - Leaving: this member's devices remove themselves (a `leave` removal, §8.4), the others rotate, and the phone
 *   forgets every row of the group log. Every phone deletes the summaries of a member with no device left in it.
 */

/** HKDF `info` for an invite code sealed to one device's agreement key. */
const GROUP_INVITE_INFO = 'cicis-group-invite-v1';

/** An invite code sealed to one device (`sealKeyFor` without its `deviceId`, which each device supplies as its own). */
interface SealedInvite {
  epoch: number;
  ephJwk: JsonWebKey;
  iv: string;
  ct: string;
  expiresAt: string;
}

interface SharedRow {
  relayBookId: string;
  epoch: number;
  memberId: string;
  state: string;
}

/** What the engine lends the group log: its keys, relay, and the sync steps it already has. */
export interface GroupLogHost {
  database: Database;
  transport: SyncTransport;
  device: DeviceKeys;
  sealer: Sealer;
  now: () => number;
  appVersion?: string;
  /** The engine's `syncOnce`: one book, and for a workspace its group log. */
  syncOnce(bookId: string): Promise<SyncOnceResult>;
  removeDevice(bookId: string, target: string): Promise<void>;
  /** The engine's leave of one book: the signed removal of this device, then the book ends here. */
  leaveNow(bookId: string, leave: boolean): Promise<void>;
}

async function sharedRowOf(database: Database, bookId: string): Promise<SharedRow | undefined> {
  const [row] = await database.db.values<[string, number, string, string]>(
    sql`SELECT relay_book_id, epoch, member_id, state FROM shared_books WHERE book_id = ${bookId}`,
  );
  return row ? { relayBookId: row[0], epoch: Number(row[1]), memberId: row[2], state: row[3] } : undefined;
}

interface Link {
  groupBookId: string;
  relayBookId: string;
  invites: SealedInvite[];
}

/** The workspace's link to its group log, or null: none, or closed when its group dissolved (task 5). */
export async function linkOf(database: Database, workspaceBookId: string): Promise<Link | null> {
  const [row] = await database.db.values<[string, string, string]>(
    sql`SELECT group_book_id, invites_json, relay_book_id FROM group_logs WHERE book_id = ${workspaceBookId}`,
  );
  if (!row || isClosedLink({ relayBookId: row[2] })) return null;
  let invites: SealedInvite[] = [];
  try {
    const parsed = JSON.parse(row[1]) as unknown;
    if (Array.isArray(parsed)) invites = parsed as SealedInvite[];
  } catch {
    // Malformed peer data opens nothing.
  }
  return { groupBookId: row[0], relayBookId: row[2], invites };
}

/**
 * The group log of the workspace this device reads and writes, or null: none, or one this device is not in (any more).
 * From this device's own record, never the synced link.
 */
export async function groupLogOf(host: GroupLogHost, workspaceBookId: string): Promise<string | null> {
  const [row] = await host.database.db.values<[string]>(sql`
    SELECT g.group_book_id FROM nw_group_books g JOIN shared_books s ON s.book_id = g.group_book_id
    WHERE g.book_id = ${workspaceBookId} AND s.state = 'active' ORDER BY s.shared_at DESC, g.group_book_id LIMIT 1`);
  return row?.[0] ?? null;
}

/** Whether this device ever held this group log: one it left, or was removed from, is never joined again. */
async function heldBefore(database: Database, groupBookId: string): Promise<boolean> {
  return (await database.db.values(sql`SELECT 1 FROM nw_group_books WHERE group_book_id = ${groupBookId}`)).length > 0;
}

/** Records, on this device only, that it holds `groupBookId` as the group log of `workspaceBookId`. */
async function recordGroupBookTx(tx: Tx, groupBookId: string, workspaceBookId: string): Promise<void> {
  await tx.run(sql`INSERT INTO nw_group_books (group_book_id, book_id) VALUES (${groupBookId}, ${workspaceBookId}) ON CONFLICT (group_book_id) DO NOTHING`);
}

async function requireWorkspace(host: GroupLogHost, workspaceBookId: string): Promise<SharedRow> {
  const shared = await sharedRowOf(host.database, workspaceBookId);
  if (!shared || shared.state !== 'active') throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
  return shared;
}

async function requireGroup(host: GroupLogHost, workspaceBookId: string): Promise<{ groupBookId: string; shared: SharedRow }> {
  await requireWorkspace(host, workspaceBookId);
  const groupBookId = await groupLogOf(host, workspaceBookId);
  const shared = groupBookId ? await sharedRowOf(host.database, groupBookId) : undefined;
  if (!groupBookId || !shared) throw new SharingError('NOT_FOUND', "This device is not in this workspace's net-worth group");
  return { groupBookId, shared };
}

/** A sync that may fail on the relay: the scheduler's next run does it then. */
export async function quietly(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (error) {
    if (!(error instanceof SyncTransportError)) throw error;
  }
}

/**
 * This device's introduction into the group log (§5.4): its device row and its member row, both as the workspace names
 * them. A group member is an owner of the group log (task 4 ruling).
 */
async function introduceTx(host: GroupLogHost, tx: Tx, workspaceBookId: string, groupBookId: string, memberId: string, epoch: number): Promise<void> {
  const self = host.device.deviceId;
  const now = new Date(host.now()).toISOString();
  const [member] = await tx.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${workspaceBookId} AND member_id = ${memberId}`);
  const [device] = await tx.values<[string]>(sql`SELECT name FROM book_devices WHERE book_id = ${workspaceBookId} AND device_id = ${self}`);
  await tx.run(sql`
    INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${groupBookId}, ${memberId}, ${member?.[0] ?? ''}, 'owner', ${now})
    ON CONFLICT (book_id, member_id) DO NOTHING`);
  await tx.run(sql`
    INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
    VALUES (${groupBookId}, ${self}, ${memberId}, ${device?.[0] ?? ''}, ${JSON.stringify(host.device.public.signJwk)}, ${JSON.stringify(host.device.public.agreeJwk)}, ${now}, NULL, ${host.appVersion ?? null})
    ON CONFLICT (book_id, device_id) DO NOTHING`);
  const book = { bookId: groupBookId, memberId, epoch };
  const ops = [
    ...(await rowUpsertsTx(tx, book, 'device')).filter((op) => op.id === self),
    ...(await rowUpsertsTx(tx, book, 'member')).filter((op) => op.id === memberId),
  ];
  await writeChangeSetsTx(tx, captureConfigOf(host.database), book, ops);
}

/**
 * Makes the workspace's group log, or returns the one this device is already in. A group log another member made and
 * this device was invited to is joined by the workspace sync first; one this device is not in is `GROUP_EXISTS` (one
 * group per workspace, §4). On a new one: the relay book (this device its only device and owner), epoch 1's key, the
 * introduction, and the `net_worth_group` link in the workspace log, in one transaction; a failure deletes the relay
 * book again, as `shareBook` does. The introduction is drained at once, so it is the log's first entry.
 */
export async function openGroupLog(host: GroupLogHost, workspaceBookId: string): Promise<string> {
  const workspace = await requireWorkspace(host, workspaceBookId);
  const mine = await groupLogOf(host, workspaceBookId);
  if (mine) return mine;
  await quietly(host.syncOnce(workspaceBookId));
  const joined = await groupLogOf(host, workspaceBookId);
  if (joined) return joined;
  if (await linkOf(host.database, workspaceBookId)) throw new SharingError('GROUP_EXISTS', 'This workspace already has a net-worth group');
  const { bookId: relayBookId } = await host.transport.createBook(host.device.public);
  const key = randomBytes(32);
  // The id carries the group's close proof (authority.ts `GROUP_LINK_NS`): only who holds epoch 1's key can close it.
  const groupBookId = await uuidv5(GROUP_LINK_NS, await closeProofFrom(key));
  try {
    await host.database.transaction(async (tx) => {
      await recordGroupBookTx(tx, groupBookId, workspaceBookId);
      await host.sealer.storeEpochKeyTx(tx, groupBookId, 1, key);
      await tx.run(sql`
        INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at)
        VALUES (${groupBookId}, ${relayBookId}, 1, ${workspace.memberId}, 'active', ${new Date(host.now()).toISOString()})`);
      await introduceTx(host, tx, workspaceBookId, groupBookId, workspace.memberId, 1);
      // Over a closed link, if there is one: a group that dissolved leaves room for a new one (task 5).
      await withCapture(tx, { entity: 'net_worth_group', id: workspaceBookId, bookId: workspaceBookId }, async () => {
        await tx.run(sql`
          INSERT INTO group_logs (book_id, group_book_id, relay_book_id, invites_json) VALUES (${workspaceBookId}, ${groupBookId}, ${relayBookId}, '[]')
          ON CONFLICT (book_id) DO UPDATE SET group_book_id = excluded.group_book_id, relay_book_id = excluded.relay_book_id, invites_json = excluded.invites_json`);
      });
      // Until it is back from the log, a peer's link that differs was there first (authority.ts, task 5).
      await tx.run(sql`
        INSERT INTO settings (key, value) VALUES (${OWN_LINK_PENDING_KEY(workspaceBookId)}, ${groupBookId})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    });
  } catch (error) {
    host.sealer.forget();
    await host.transport.deleteBook(relayBookId).catch(() => undefined);
    throw error;
  }
  await quietly(host.syncOnce(groupBookId));
  return groupBookId;
}

/**
 * Lets the given members' devices into the group log: every device of theirs (and this member's other devices) that
 * the workspace's view has pinned and still has in, and the group log has never had. For each, a relay invite carrying
 * every epoch key this device holds, signed by this device (an owner of the group log's relay book), and its code
 * sealed to that device's pinned agreement key, added to the `net_worth_group` row. Invites that expired are dropped
 * from the row as it is written. The devices join on their next workspace sync.
 */
export async function admitToGroupLog(host: GroupLogHost, workspaceBookId: string, memberIds: readonly string[]): Promise<void> {
  const { groupBookId, shared } = await requireGroup(host, workspaceBookId);
  // The log holds this device's introduction before any invite exists, and the view is the log's now.
  const synced = await host.syncOnce(groupBookId);
  if (synced.ended) throw new SharingError('NOT_FOUND', "This device is not in this workspace's net-worth group");
  const epochKeys: InviteKey[] = (await host.sealer.epochKeysOf(groupBookId)).map(({ epoch, key }) => ({ epoch, key: bytesToBase64Url(key) }));
  if (epochKeys.length === 0) throw new SharingError('NO_KEYS', "This device can't open the net-worth group's keys");
  const wanted = new Set([...memberIds, shared.memberId]);
  const self = host.device.deviceId;
  const candidates = await host.database.db.values<[string, string, string]>(sql`
    SELECT d.device_id, d.member_id, d.agree_jwk FROM book_devices d
    JOIN sync_authority_devices a ON a.book_id = d.book_id AND a.device_id = d.device_id
    WHERE d.book_id = ${workspaceBookId} AND a.removed_seq IS NULL AND d.device_id <> ${self}
    ORDER BY d.device_id`);
  const sealed: SealedInvite[] = [];
  const invited = await invitedBy(host, groupBookId);
  for (const [deviceId, memberId, agreeJwk] of candidates) {
    if (!wanted.has(memberId)) continue;
    // An invite of this device's that has not expired is still waiting for that device (task 5: no second one).
    if ((invited[deviceId] ?? 0) > host.now()) continue;
    // A device the group log ever had is in, or was removed from it for good (§8.4): no second invite either way.
    if (await host.database.transaction((tx) => viewDevice(tx, groupBookId, deviceId))) continue;
    const inviteId = uuidv7();
    const secret = newInviteSecret();
    const key = await inviteKeyOf(secret, inviteId);
    const expiresAt = new Date(host.now() + INVITE_TTL_MS).toISOString();
    const unsigned: Omit<InviteRecord, 'sig'> = {
      inviteId,
      keys: await sealInviteJson(key, epochKeys, inviteAad('keys', inviteId)),
      preview: await sealInviteJson(key, { groupBookId, relayBookId: shared.relayBookId }, inviteAad('preview', inviteId)),
      expiresAt,
      sameMember: false,
    };
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, host.device.sign.privateKey, inviteSigningBytes(unsigned) as BufferSource);
    await host.transport.putInvite(shared.relayBookId, { ...unsigned, sig: bytesToBase64Url(new Uint8Array(sig)) });
    const { deviceId: _deviceId, ...code } = await sealKeyFor(
      { deviceId, agreeJwk: JSON.parse(agreeJwk) as JsonWebKey },
      groupBookId,
      0,
      utf8(encodeInviteCode(inviteId, secret)),
      GROUP_INVITE_INFO,
    );
    sealed.push({ ...code, expiresAt });
    invited[deviceId] = Date.parse(expiresAt);
  }
  if (sealed.length === 0) return;
  await host.database.transaction(async (tx) => {
    const [row] = await tx.values<[string]>(sql`SELECT invites_json FROM group_logs WHERE book_id = ${workspaceBookId}`);
    let kept: SealedInvite[] = [];
    try {
      kept = (JSON.parse(row?.[0] ?? '[]') as SealedInvite[]).filter((invite) => Date.parse(invite.expiresAt) > host.now());
    } catch {
      kept = [];
    }
    await withCapture(tx, { entity: 'net_worth_group', id: workspaceBookId, bookId: workspaceBookId }, async () => {
      await tx.run(sql`UPDATE group_logs SET invites_json = ${JSON.stringify([...kept, ...sealed])} WHERE book_id = ${workspaceBookId}`);
    });
    await tx.run(sql`
      INSERT INTO settings (key, value) VALUES (${INVITED_KEY(groupBookId)}, ${JSON.stringify(invited)})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  });
}

/** Local only: the devices this device invited into a group log, and when each invite expires (ms). */
const INVITED_KEY = (groupBookId: string) => `nw.invited.${groupBookId}`;

async function invitedBy(host: GroupLogHost, groupBookId: string): Promise<Record<string, number>> {
  const [row] = await host.database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${INVITED_KEY(groupBookId)}`);
  try {
    const parsed = JSON.parse(row?.[0] ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * Devices of the group's members that the workspace's view has in and the group log never had, with no invite of this
 * device's waiting for them (task 5: a member's later device is let in by any group member's device). Empty when this
 * device is in no group log of the workspace.
 */
export async function devicesToAdmit(host: GroupLogHost, workspaceBookId: string): Promise<{ deviceId: string; memberId: string }[]> {
  const groupBookId = await groupLogOf(host, workspaceBookId);
  if (!groupBookId) return [];
  const rows = await host.database.db.values<[string, string]>(sql`
    SELECT w.device_id, w.member_id FROM sync_authority_devices w
    WHERE w.book_id = ${workspaceBookId} AND w.removed_seq IS NULL AND w.device_id <> ${host.device.deviceId}
      AND w.member_id IN (SELECT g.member_id FROM sync_authority_devices g WHERE g.book_id = ${groupBookId} AND g.removed_seq IS NULL)
      AND NOT EXISTS (SELECT 1 FROM sync_authority_devices g WHERE g.book_id = ${groupBookId} AND g.device_id = w.device_id)
    ORDER BY w.device_id`);
  const invited = await invitedBy(host, groupBookId);
  return rows.filter(([deviceId]) => !((invited[deviceId] ?? 0) > host.now())).map(([deviceId, memberId]) => ({ deviceId, memberId }));
}

/** HKDF `info` of a group log's close proof. */
const GROUP_CLOSE_INFO = 'cicis-group-close-v1';

/** A group log's close proof, from its first epoch key: its id is `uuidv5(GROUP_LINK_NS, proof)`. */
export async function closeProofFrom(epochOneKey: Uint8Array): Promise<string> {
  return bytesToBase64Url(await hkdf(epochOneKey, new Uint8Array(0), utf8(GROUP_CLOSE_INFO)));
}

/**
 * Dissolves the workspace's group log from this device (§6: fewer than two members left; task 5 ruling): the link is
 * closed with the group's proof, the relay book is deleted, and the group log ends and is forgotten here. The other
 * members' devices find it gone on their next sync (`410`) and forget it too. A relay that cannot be reached leaves the
 * relay book behind; the link is closed all the same, and every member's device dissolves it on its own.
 */
export async function dissolveGroupLog(host: GroupLogHost, workspaceBookId: string): Promise<void> {
  const groupBookId = await groupLogOf(host, workspaceBookId);
  if (!groupBookId) return;
  const shared = await sharedRowOf(host.database, groupBookId);
  const key = await host.sealer.epochKey(groupBookId, 1);
  const proof = key ? await closeProofFrom(key) : null;
  if (proof && (await uuidv5(GROUP_LINK_NS, proof)) === groupBookId) {
    await host.database.transaction(async (tx) => {
      await withCapture(tx, { entity: 'net_worth_group', id: workspaceBookId, bookId: workspaceBookId }, async () => {
        await tx.run(sql`
          UPDATE group_logs SET relay_book_id = ${CLOSED_LINK_PREFIX + proof}, invites_json = '[]'
          WHERE book_id = ${workspaceBookId} AND group_book_id = ${groupBookId} AND relay_book_id NOT LIKE 'closed:%'`);
      });
    });
  }
  if (shared) await host.transport.deleteBook(shared.relayBookId).catch(() => undefined);
  await host.database.db.run(sql`UPDATE shared_books SET state = 'unshared', unshared_reason = 'stopped' WHERE book_id = ${groupBookId}`);
  await forgetGroup(host, groupBookId);
}

/**
 * A live group's link someone closed (review round 1, finding 2: any device ever in the group holds the proof, so a
 * former member can): this device, in the group log the closed link names, writes it open again — the same log, the
 * same relay book — so the group's later devices can still be let in, and no new group takes its place. The caller
 * decides that the group lives (something active or waiting in it). True when it wrote.
 */
export async function reopenClosedLink(host: GroupLogHost, workspaceBookId: string): Promise<boolean> {
  const mine = await groupLogOf(host, workspaceBookId);
  if (!mine) return false;
  const shared = await sharedRowOf(host.database, mine);
  if (!shared) return false;
  const [row] = await host.database.db.values<[string, string]>(sql`SELECT group_book_id, relay_book_id FROM group_logs WHERE book_id = ${workspaceBookId}`);
  if (!row || row[0] !== mine || !isClosedLink({ relayBookId: row[1] })) return false;
  await host.database.transaction((tx) =>
    withCapture(tx, { entity: 'net_worth_group', id: workspaceBookId, bookId: workspaceBookId }, async () => {
      await tx.run(sql`UPDATE group_logs SET relay_book_id = ${shared.relayBookId}, invites_json = '[]' WHERE book_id = ${workspaceBookId}`);
    }),
  );
  // Invites this device sealed into the closed link are gone with it: its later devices are invited afresh.
  await host.database.db.run(sql`DELETE FROM settings WHERE key = ${INVITED_KEY(mine)}`);
  return true;
}

/**
 * A group log this device made that lost to another member's, made at the same moment (task 5 ruling): the link names
 * the other. Nobody else is in this one, so it is deleted on the relay and forgotten here; the device joins the linked
 * one when a member of it lets it in.
 */
export async function abandonLostGroupLog(host: GroupLogHost, workspaceBookId: string): Promise<boolean> {
  const mine = await groupLogOf(host, workspaceBookId);
  const link = await linkOf(host.database, workspaceBookId);
  if (!mine || !link || link.groupBookId === mine) return false;
  const shared = await sharedRowOf(host.database, mine);
  const self = shared?.memberId;
  const others = await host.database.db.values(
    sql`SELECT 1 FROM sync_authority_devices WHERE book_id = ${mine} AND member_id <> ${self ?? ''} LIMIT 1`,
  );
  if (others.length > 0) return false; // a log someone else is in is never abandoned
  if (shared) await host.transport.deleteBook(shared.relayBookId).catch(() => undefined);
  await host.database.db.run(sql`UPDATE shared_books SET state = 'unshared', unshared_reason = 'stopped' WHERE book_id = ${mine}`);
  await forgetGroup(host, mine);
  return true;
}

/**
 * On a workspace sync, for a device the group log does not have yet: opens whichever sealed invite is its own, claims
 * it, keeps its epoch keys and introduces itself; the group log's sync that follows pulls it. False when no invite here
 * opens and claims.
 */
async function joinFromInvites(host: GroupLogHost, workspaceBookId: string, link: Link): Promise<boolean> {
  const workspace = await sharedRowOf(host.database, workspaceBookId);
  if (!workspace || workspace.state !== 'active' || !link.relayBookId) return false;
  const self = host.device.deviceId;
  for (const invite of link.invites) {
    if (!(Date.parse(invite.expiresAt) > host.now())) continue;
    let code: string;
    try {
      const opened = await openSealedKey(
        host.device.agree.privateKey,
        link.groupBookId,
        { deviceId: self, epoch: invite.epoch, ephJwk: invite.ephJwk, iv: invite.iv, ct: invite.ct },
        GROUP_INVITE_INFO,
      );
      code = fromUtf8(opened);
    } catch {
      continue; // sealed to another device
    }
    let inviteId: string;
    let secret: Uint8Array;
    try {
      ({ inviteId, secret } = parseInviteCode(code));
    } catch {
      continue;
    }
    const inviteKey = await inviteKeyOf(secret, inviteId);
    // Task 4 review round 1: anyone in the workspace can seal an invite to this device, so only an invite into the log
    // the (write-once) link names is claimed — its preview says so before the claim, and the relay's own answer, the
    // book it admitted this device to, says so before any key is kept or anything is introduced.
    let claim;
    try {
      const found = await host.transport.previewInvite(inviteId);
      const preview = await openInviteJson<{ groupBookId?: string; relayBookId?: string }>(inviteKey, found.preview, inviteAad('preview', inviteId)).catch(() => null);
      if (preview?.groupBookId !== link.groupBookId || preview?.relayBookId !== link.relayBookId) continue;
      claim = await host.transport.claimInvite(inviteId, host.device.public);
    } catch (error) {
      // Claimed already, expired, or its book deleted: another invite may still be this device's.
      if (error instanceof SyncTransportError && [404, 409, 410].includes(error.status)) continue;
      throw error;
    }
    if (claim.bookId !== link.relayBookId) continue;
    const keys = await openInviteJson<InviteKey[]>(inviteKey, claim.keys, inviteAad('keys', inviteId)).catch(() => [] as InviteKey[]);
    if (keys.length === 0) continue;
    // Review round 1, finding 5: the keys are the log's own only when epoch 1's derives the id the link names.
    const first = keys.find((k) => k.epoch === 1);
    if (!first || (await uuidv5(GROUP_LINK_NS, await closeProofFrom(base64UrlToBytes(first.key)))) !== link.groupBookId) continue;
    const held = new Set(keys.map((k) => k.epoch));
    const epoch = held.has(claim.epoch) ? claim.epoch : Math.max(...held);
    // The keys, the row and the introduction in one transaction: a device holding the log's keys always has its
    // introduction waiting in the outbox, so nothing it writes can reach the log before it (an entry from a device
    // nobody pinned stops every peer's pull, §5.4). Its member row goes with it every time: when another device of the
    // member was first, the log takes it as an owner's edit of an existing member (every group member is an owner).
    await host.database.transaction(async (tx) => {
      await recordGroupBookTx(tx, link.groupBookId, workspaceBookId);
      for (const k of keys) await host.sealer.storeEpochKeyTx(tx, link.groupBookId, k.epoch, base64UrlToBytes(k.key));
      await tx.run(sql`
        INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at)
        VALUES (${link.groupBookId}, ${claim.bookId}, ${epoch}, ${workspace.memberId}, 'active', ${new Date(host.now()).toISOString()})`);
      await introduceTx(host, tx, workspaceBookId, link.groupBookId, workspace.memberId, epoch);
    });
    return true;
  }
  return false;
}

/**
 * The group log's part of a sync (engine `syncOnce`, after the book's own sync):
 * - for a workspace: sync the group log this device is in; else, when the link names one this device never held and an
 *   invite here is this device's, join it and sync it. A device in a group log never follows a rewritten link to
 *   another (one group per workspace, §4);
 * - for a group log: when it ended here (left, removed, deleted), forget it; otherwise drop the summaries of members
 *   with no device left in it.
 * Returns the group log's own sync, when one ran.
 */
export async function syncGroupAfter(host: GroupLogHost, bookId: string, result: SyncOnceResult): Promise<SyncOnceResult | undefined> {
  if ((await groupLogWorkspaceOf(host.database.db, bookId)) !== null) {
    if (result.ended) await forgetGroup(host, bookId);
    else await host.database.transaction((tx) => dropDepartedTx(tx, bookId));
    return undefined;
  }
  // §6 (task 4 review round 1): this device is out of the workspace — it left, was removed, or the sharing stopped — so
  // it is out of the group log too.
  if (result.ended) {
    await exitGroupOf(host, bookId, result.ended === 'left');
    return undefined;
  }
  if (result.stopped) return undefined;
  let groupBookId = await groupLogOf(host, bookId);
  if (!groupBookId) {
    const link = await linkOf(host.database, bookId);
    if (!link || (await heldBefore(host.database, link.groupBookId))) return undefined;
    if ((await sharedRowOf(host.database, link.groupBookId)) !== undefined) return undefined;
    if (!(await joinFromInvites(host, bookId, link))) return undefined;
    groupBookId = link.groupBookId;
  }
  const synced = await host.syncOnce(groupBookId);
  if (!synced.ended) await followWorkspaceRemovals(host, bookId, groupBookId);
  return synced;
}

/**
 * §6 (task 4 review round 1): a device the workspace's view has removed — its member left the workspace, or an owner
 * removed it — is taken out of the group log by whichever group member's device sees it first, and the log rotates past
 * it (§8.4). Decided from state, not from the one sync that applied the removal, so a failed attempt is made again on
 * the next sync, and a device that already sees it done does nothing. A device that is not yet an owner on the group
 * log's relay book (`followOwners` has not caught up) leaves it to one that is.
 */
async function followWorkspaceRemovals(host: GroupLogHost, workspaceBookId: string, groupBookId: string): Promise<void> {
  const targets = await host.database.db.values<[string]>(sql`
    SELECT g.device_id FROM sync_authority_devices g
    JOIN sync_authority_devices w ON w.book_id = ${workspaceBookId} AND w.device_id = g.device_id
    WHERE g.book_id = ${groupBookId} AND g.removed_seq IS NULL AND w.removed_seq IS NOT NULL AND g.device_id <> ${host.device.deviceId}
    ORDER BY g.device_id`);
  for (const [target] of targets) {
    if ((await host.database.transaction((tx) => viewDevice(tx, groupBookId, target)))?.removedSeq != null) continue; // done meanwhile
    try {
      await host.removeDevice(groupBookId, target);
    } catch (error) {
      if (error instanceof SyncTransportError && error.status === 403) continue;
      throw error;
    }
  }
}

/**
 * This device leaves the workspace's group log, if it is in one (§6: out of the workspace is out of the group): a
 * removal of itself — as its member leaving when `leave` — then the group's rows and keys go. When the relay cannot be
 * reached, the log is ended and forgotten here all the same; the group's other members take this device out when they
 * see its removal from the workspace (`followWorkspaceRemovals`).
 */
export async function exitGroupOf(host: GroupLogHost, workspaceBookId: string, leave: boolean): Promise<void> {
  const groupBookId = await groupLogOf(host, workspaceBookId);
  if (!groupBookId) return;
  try {
    await host.leaveNow(groupBookId, leave);
  } catch (error) {
    if (!(error instanceof SyncTransportError)) throw error;
    await host.database.db.run(
      sql`UPDATE shared_books SET state = 'unshared', unshared_reason = ${leave ? 'left' : 'removed'} WHERE book_id = ${groupBookId}`,
    );
  }
  await forgetGroup(host, groupBookId);
}

/**
 * Every phone deletes the summaries of a member who left the group (§6): one whose every device is out of the group
 * log, per its view. Local and derived, like the view itself; their entries after the removal count for nothing.
 */
async function dropDepartedTx(tx: Tx, groupBookId: string): Promise<void> {
  await tx.run(sql`
    DELETE FROM nw_items WHERE book_id = ${groupBookId} AND owner IN (
      SELECT m.member_id FROM sync_authority m WHERE m.book_id = ${groupBookId} AND NOT EXISTS (
        SELECT 1 FROM sync_authority_devices d WHERE d.book_id = ${groupBookId} AND d.member_id = m.member_id AND d.removed_seq IS NULL))`);
}

/**
 * The group log ended on this device: its net-worth rows, its keys and every piece of its sync state go. The
 * `shared_books` row stays, not active, and so does `nw_group_books`: the workspace sync never tries this device's spent
 * invites again, and every workspace reader still skips it.
 */
export async function forgetGroup(host: GroupLogHost, groupBookId: string): Promise<void> {
  host.sealer.forget();
  await host.database.transaction(async (tx) => {
    for (const table of ['nw_proposals', 'nw_answers', 'nw_items', 'nw_pending']) {
      await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${groupBookId}`);
    }
    await tx.run(sql`DELETE FROM nw_sent WHERE item_id IN (SELECT item_id FROM nw_item_map WHERE group_book_id = ${groupBookId})`);
    await tx.run(sql`DELETE FROM nw_item_map WHERE group_book_id = ${groupBookId}`);
    for (const table of ['sync_outbox', 'sync_cursor', 'book_epoch_keys', 'sync_field_clocks', 'sync_tombstones', 'sync_skipped']) {
      await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${groupBookId}`);
    }
  });
}

/**
 * This member leaves the group log (§6: leaving is unilateral): what waits goes out first, then this device removes
 * itself as its member leaving (§8.4) — its other devices follow, the others rotate — and forgets the group's rows.
 */
export async function leaveGroupLog(host: GroupLogHost, workspaceBookId: string): Promise<void> {
  const { groupBookId } = await requireGroup(host, workspaceBookId);
  const synced = await host.syncOnce(groupBookId);
  if (synced.ended) return;
  await host.leaveNow(groupBookId, true);
  await forgetGroup(host, groupBookId);
}

/**
 * Takes a member who left out of the group log, by any other group member (§6): allowed when the member answered
 * `left`, or no device of theirs is still in the workspace (they left it, or were removed). Each of their devices is
 * removed, and each removal rotates (§8.4). `NOT_LEFT` otherwise.
 */
export async function removeFromGroupLog(host: GroupLogHost, workspaceBookId: string, memberId: string): Promise<void> {
  const { groupBookId, shared } = await requireGroup(host, workspaceBookId);
  if (memberId === shared.memberId) throw new SharingError('NOT_LEFT', 'To leave the net-worth group yourself, leave it from this device');
  const synced = await host.syncOnce(groupBookId);
  if (synced.ended) throw new SharingError('NOT_FOUND', "This device is not in this workspace's net-worth group");
  const database = host.database;
  const [answered] = await database.db.values(sql`SELECT 1 FROM nw_answers WHERE book_id = ${groupBookId} AND member_id = ${memberId} AND answer = 'left' LIMIT 1`);
  const inWorkspace = await database.transaction(async (tx) => {
    const devices = await viewActiveDevices(tx, workspaceBookId);
    for (const deviceId of devices) if ((await viewDevice(tx, workspaceBookId, deviceId))?.memberId === memberId) return true;
    return false;
  });
  if (!answered && inWorkspace) throw new SharingError('NOT_LEFT', 'They are still in the net-worth group');
  const targets = await database.transaction(async (tx) => {
    const out: string[] = [];
    for (const deviceId of await viewActiveDevices(tx, groupBookId)) if ((await viewDevice(tx, groupBookId, deviceId))?.memberId === memberId) out.push(deviceId);
    return out;
  });
  for (const target of targets) await host.removeDevice(groupBookId, target);
  await database.transaction((tx) => dropDepartedTx(tx, groupBookId));
}

/**
 * Whether every device of these members still in the workspace (per its view) runs an app that understands joint net
 * worth (§9): setup waits for `ready`, and names each `outdated` device ("Update the app on Andi's iPad").
 */
export async function groupMembersReady(
  host: GroupLogHost,
  workspaceBookId: string,
  memberIds: readonly string[],
): Promise<{ ready: boolean; outdated: { memberId: string; deviceName: string }[] }> {
  if (memberIds.length === 0) return { ready: true, outdated: [] };
  const rows = await host.database.db.values<[string, string, string | null]>(sql`
    SELECT d.member_id, d.name, d.app_version FROM book_devices d
    JOIN sync_authority_devices a ON a.book_id = d.book_id AND a.device_id = d.device_id
    WHERE d.book_id = ${workspaceBookId} AND a.removed_seq IS NULL AND d.member_id IN (${sql.join(
      memberIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    ORDER BY d.member_id, d.added_at, d.device_id`);
  const outdated = rows.filter(([, , version]) => !meetsMinVersion(version)).map(([memberId, deviceName]) => ({ memberId, deviceName }));
  return { ready: outdated.length === 0, outdated };
}
