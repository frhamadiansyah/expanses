import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Tx } from '../database';
import { pullAndApply, type PullResult } from './apply';
import { captureConfigOf, configureCapture, withCapture, writeChangeSetsTx } from './capture';
import { randomBytes, sealKeyFor } from './crypto';
import { localTick } from './hlc';
import {
  encodeInviteCode,
  INVITE_TTL_MS,
  inviteKeyOf,
  inviteLink,
  newInviteSecret,
  openInviteJson,
  parseInviteCode,
  sealInviteJson,
  type InviteKey,
  type InvitePreview,
} from './invite';
import type { DeviceKeys } from './keys';
import { base64UrlToBytes, bytesToBase64Url, inviteSigningBytes } from './relay-signing';
import { MissingEpochKeyError, Sealer } from './seal';
import { assertShareableTx, emitUnknownRowsTx, SharingError, seedBookTx } from './seed';
import type { ChangeSet, InviteRecord, LogEntry, SyncTransport } from './types';
import { SyncTransportError } from './types';

/*
 * The household-sharing engine: the one thing the app (task 7's SyncScheduler callback and screens) calls. It holds
 * this device's keys (spec §5), and does:
 *
 * - `shareBook` (§6.5 steps 0–3): the relay book, epoch 1's key, the seed. A seed that fails deletes the relay book.
 * - `drain` / `syncOnce` (§9.4, §7.1): the outbox is sealed here, at drain, under the book's epoch now (controller
 *   ruling); then pull and apply; then the rotation a removal calls for (§8.4) and the owner list a linked device of an
 *   owner joins (§8.3).
 * - `createInvite` / `linkDevice` (§8.1, §8.3), `previewInvite` / `joinBook` (§8.2).
 * - `removeDevice` and `maybeRotate` (§8.4).
 * - `checkRestore` and rejoining through `joinBook` (§8.7).
 */

export interface ShareInput {
  memberName: string;
  deviceName: string;
  /** This person's member id in the book. A fresh one when omitted. */
  memberId?: string;
}

export interface SyncOnceResult extends PullResult {
  /** Outbox entries appended to the relay by this call. */
  pushed: number;
  /** The epoch this device rotated the book to, when it did (§8.4). */
  rotated?: number;
}

export interface CreatedInvite {
  inviteId: string;
  /** 52 characters in groups of four (§8.1 step 6). */
  code: string;
  link: string;
  expiresAt: string;
}

export interface PreviewedInvite extends InvitePreview {
  inviteId: string;
  expiresAt: string;
  claimed: boolean;
  expired: boolean;
}

export interface JoinInput {
  /** The workspace the joined book goes into; its currency must be the book's (§8.2 step 3). */
  ws: WorkspaceContext;
  memberName: string;
  deviceName: string;
  /** This person's member id in the book, when joining as a new member. A fresh one when omitted (§8.2 step 6). */
  memberId?: string;
}

export class SyncEngine {
  readonly sealer: Sealer;

  constructor(
    private readonly database: Database,
    private readonly transport: SyncTransport,
    readonly device: DeviceKeys,
    private readonly now: () => number = Date.now,
  ) {
    this.sealer = new Sealer(database, device);
    // The one device-id seam (§5.1): every hlc and entry this database emits carries the KeyStore's id.
    configureCapture(database, { deviceId: device.deviceId });
  }

  get deviceId(): string {
    return this.device.deviceId;
  }

  /* ------------------------------------------------------------- sharing */

  /**
   * Shares a book (§6.5): refuses a book in another currency before anything is made (step 0), creates the relay book
   * and mints epoch 1 (step 1), then in one transaction writes `shared_books`, the key at rest, this member and device,
   * and seeds every row in scope into the outbox (steps 1–3). A failure after the relay book exists deletes it again,
   * so nothing is left behind on the relay. The caller drains (`syncOnce`) before showing an invite (step 4).
   */
  async shareBook(bookId: string, input: ShareInput): Promise<{ relayBookId: string; memberId: string; changeSets: number }> {
    await this.database.transaction((tx) => assertShareableTx(tx, bookId));
    const { bookId: relayBookId } = await this.transport.createBook(this.device.public);
    const memberId = input.memberId ?? uuidv7();
    const key = randomBytes(32);
    try {
      const changeSets = await this.database.transaction(async (tx) => {
        await this.sealer.storeEpochKeyTx(tx, bookId, 1, key);
        return seedBookTx(tx, captureConfigOf(this.database), {
          bookId,
          relayBookId,
          memberId,
          memberName: input.memberName,
          deviceId: this.deviceId,
          deviceName: input.deviceName,
          device: this.device.public,
        });
      });
      return { relayBookId, memberId, changeSets };
    } catch (error) {
      this.sealer.forget();
      await this.transport.deleteBook(relayBookId).catch(() => undefined);
      throw error;
    }
  }

  /* ---------------------------------------------------------------- sync */

  /**
   * Seals and appends every outbox change-set of the book, in hlc order, under the book's epoch now; each is removed
   * once the relay has it (§9.4). A retry after a lost answer seals again and the relay answers with the first seq.
   */
  async drain(bookId: string): Promise<number> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') return 0;
    const rows = await this.database.db.values<[string, string]>(sql`SELECT id, entry_json FROM sync_outbox WHERE book_id = ${bookId} ORDER BY hlc`);
    let pushed = 0;
    for (const [id, changeSetJson] of rows) {
      const entry = await this.sealer.seal(bookId, shared.epoch, JSON.parse(changeSetJson) as ChangeSet);
      await this.transport.append(shared.relayBookId, entry);
      await this.database.db.run(sql`DELETE FROM sync_outbox WHERE id = ${id}`);
      pushed += 1;
    }
    return pushed;
  }

  /**
   * One sync of one book: drain, then pull and apply, then rotate if a removal calls for it (§8.4) and add a linked
   * device of an owner to the relay's owners (§8.3). A transport failure throws; the outbox and cursor stay put.
   */
  async syncOnce(bookId: string, seen?: Set<string>): Promise<SyncOnceResult> {
    if (await this.checkBook(bookId)) return { pushed: 0, applied: 0, skipped: [], removals: [], introduced: [], stopped: { seq: 0, reason: 'needs invite' } };
    const pushed = await this.drain(bookId);
    let result = await this.pull(bookId, seen);
    let rotated: number | undefined;
    for (const removal of result.removals) {
      if (removal.target === this.deviceId) continue; // a device never rotates on its own removal
      const outcome = await this.maybeRotate(bookId, removal.epoch);
      if (outcome === 'skipped') continue;
      if (typeof outcome === 'number') rotated = outcome;
      // Our own rotation, or on a 409 the one that won: either way the next pull brings it (§8.4 step 3).
      result = merge(result, await this.pull(bookId, seen));
    }
    await this.addOwnerDevices(bookId, result.introduced);
    return rotated === undefined ? { pushed, ...result } : { pushed, rotated, ...result };
  }

  private pull(bookId: string, seen?: Set<string>): Promise<PullResult> {
    return pullAndApply(this.database, this.transport, this.sealer, bookId, this.now, seen);
  }

  /* ------------------------------------------------------------- invites */

  /**
   * §8.1: an invite to the book, sealing every epoch key this device holds and a preview under a key derived from a
   * fresh secret that only the code carries. `sameMember` links another device of this device's own member (§8.3).
   */
  async createInvite(bookId: string, input: { inviterName: string; sameMember?: boolean }): Promise<CreatedInvite> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
    const [book] = await this.database.db.values<[string, string]>(sql`SELECT name, base_currency FROM books WHERE id = ${bookId}`);
    if (!book) throw new SharingError('NOT_FOUND', 'That workspace is not here');
    const inviteId = uuidv7();
    const secret = newInviteSecret();
    const key = await inviteKeyOf(secret, inviteId);
    const epochKeys: InviteKey[] = (await this.sealer.epochKeysOf(bookId)).map(({ epoch, key: k }) => ({ epoch, key: bytesToBase64Url(k) }));
    const preview: InvitePreview = { bookId, bookName: book[0], inviterName: input.inviterName, baseCurrency: book[1] };
    const expiresAt = new Date(this.now() + INVITE_TTL_MS).toISOString();
    const sameMember = input.sameMember ?? false;
    const unsigned: Omit<InviteRecord, 'sig'> = {
      inviteId,
      keys: await sealInviteJson(key, epochKeys),
      preview: await sealInviteJson(key, preview),
      expiresAt,
      sameMember,
      ...(sameMember ? { memberId: shared.memberId } : {}),
    };
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.device.sign.privateKey, inviteSigningBytes(unsigned) as BufferSource);
    await this.transport.putInvite(shared.relayBookId, { ...unsigned, sig: bytesToBase64Url(new Uint8Array(sig)) });
    const code = encodeInviteCode(inviteId, secret);
    return { inviteId, code, link: inviteLink(code), expiresAt };
  }

  /** §8.3: an invite for another device of this device's own member. */
  linkDevice(bookId: string, input: { inviterName: string }): Promise<CreatedInvite> {
    return this.createInvite(bookId, { ...input, sameMember: true });
  }

  /** §8.2 steps 1–2: what the code invites to, before anything is claimed. Throws `BAD_CODE` for a code that opens nothing. */
  async previewInvite(code: string): Promise<PreviewedInvite> {
    const { inviteId, secret } = parseCode(code);
    const key = await inviteKeyOf(secret, inviteId);
    const found = await this.transport.previewInvite(inviteId).catch((error: unknown) => {
      if (error instanceof SyncTransportError && error.status === 404) throw new SharingError('BAD_CODE', 'That invite does not exist');
      if (error instanceof SyncTransportError && error.status === 410) throw new SharingError('INVITE_EXPIRED', 'That workspace is no longer shared');
      throw error;
    });
    const preview = await openInviteJson<InvitePreview>(key, found.preview).catch(() => {
      throw new SharingError('BAD_CODE', 'That is not the whole invite code');
    });
    return { ...preview, inviteId, expiresAt: found.expiresAt, claimed: found.claimed, expired: Date.parse(found.expiresAt) <= this.now() };
  }

  /**
   * §8.2 steps 1–8: preview, the currency check (nothing claimed on a mismatch), claim, every epoch key at rest, the
   * book and `shared_books`, the introduction (this device and, unless linking, this member), then a sync from 0.
   *
   * On a book in `needs_invite` (§8.7) this is the rejoin: the existing book row and member are kept, the cursor goes
   * back to 0, and after the pull every local row in scope the log never mentioned is emitted as new.
   */
  async joinBook(code: string, input: JoinInput): Promise<{ bookId: string; memberId: string; result: SyncOnceResult }> {
    const preview = await this.previewInvite(code);
    if (preview.claimed) throw new SharingError('INVITE_CLAIMED', 'Someone has already used this invite');
    if (preview.expired) throw new SharingError('INVITE_EXPIRED', 'This invite has expired');
    if (preview.baseCurrency !== input.ws.baseCurrency) {
      throw new SharingError(
        'CURRENCY',
        `This workspace keeps its money in ${preview.baseCurrency}; this app keeps yours in ${input.ws.baseCurrency}. Sharing across currencies isn't supported yet.`,
      );
    }
    const existing = await this.sharedRow(preview.bookId);
    if (existing && existing.state !== 'needs_invite') throw new SharingError('ALREADY_SHARED', 'This workspace is already here');
    const rejoin = existing !== undefined;

    const { inviteId, secret } = parseCode(code);
    const claim = await this.transport.claimInvite(inviteId, this.device.public);
    const keys = await openInviteJson<InviteKey[]>(await inviteKeyOf(secret, inviteId), claim.keys);
    const held = new Set(keys.map((k) => k.epoch));
    const epoch = held.has(claim.epoch) ? claim.epoch : Math.max(...held);
    const memberId = rejoin ? existing.memberId : claim.sameMember ? claim.memberId : (input.memberId ?? uuidv7());
    const bookId = preview.bookId;
    const now = new Date(this.now()).toISOString();

    this.sealer.forget();
    await this.database.transaction(async (tx) => {
      if (rejoin) {
        await tx.run(sql`DELETE FROM book_epoch_keys WHERE book_id = ${bookId}`);
        await tx.run(sql`UPDATE shared_books SET relay_book_id = ${claim.bookId}, epoch = ${epoch}, state = 'active' WHERE book_id = ${bookId}`);
        await tx.run(sql`INSERT INTO sync_cursor (book_id, applied_seq) VALUES (${bookId}, 0) ON CONFLICT (book_id) DO UPDATE SET applied_seq = 0`);
      } else {
        await tx.run(sql`
          INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, archived_at, created_at)
          VALUES (${bookId}, ${input.ws.workspaceId}, ${preview.bookName}, 'shared', ${preview.baseCurrency}, 0,
                  (SELECT coalesce(max(sort_order), 0) + 1 FROM books WHERE workspace_id = ${input.ws.workspaceId}), NULL, ${now})`);
        await tx.run(
          sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${claim.bookId}, ${epoch}, ${memberId}, 'active', ${now})`,
        );
      }
      for (const k of keys) await this.sealer.storeEpochKeyTx(tx, bookId, k.epoch, base64UrlToBytes(k.key));
    });
    // The introduction (§8.2 step 7, §5.4): its own transaction, so capture sees the book shared and emits it.
    await this.database.transaction(async (tx) => {
      const targets = [{ entity: 'device', id: this.deviceId, bookId }, ...(claim.sameMember || rejoin ? [] : [{ entity: 'member', id: memberId, bookId }])];
      await withCapture(tx, targets, async () => {
        if (!claim.sameMember && !rejoin) {
          await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${memberId}, ${input.memberName}, 'member', ${now})`);
        }
        await tx.run(sql`
          INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at)
          VALUES (${bookId}, ${this.deviceId}, ${memberId}, ${input.deviceName}, ${JSON.stringify(this.device.public.signJwk)}, ${JSON.stringify(this.device.public.agreeJwk)}, ${now}, NULL)`);
      });
    });

    const seen = rejoin ? new Set<string>() : undefined;
    let result = await this.syncOnce(bookId, seen);
    if (rejoin && !result.stopped) {
      // §8.7: what this device holds that the log never mentioned (made before the backup, never drained) goes out as new.
      const emitted = await this.database.transaction((tx) => emitUnknownRowsTx(tx, captureConfigOf(this.database), { bookId, memberId, epoch }, seen!));
      if (emitted > 0) result = { ...result, pushed: result.pushed + (await this.drain(bookId)) };
    }
    return { bookId, memberId, result };
  }

  /* ------------------------------------------------------- removal, rotation */

  /**
   * §8.4: a removal entry, then the relay drops the device. By an owner for any device; by any device for itself. For
   * another device, this device then applies its own removal and rotates; a device never rotates on its own removal.
   */
  async removeDevice(bookId: string, target: string): Promise<void> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
    const hlc = await this.database.transaction((tx) => localTick(tx, this.deviceId, this.now()));
    const entry = await this.sealer.sign({ kind: 'removal' as const, deviceId: this.deviceId, epoch: shared.epoch, hlc, target });
    await this.transport.append(shared.relayBookId, entry);
    await this.transport.removeDevice(shared.relayBookId, target);
    if (target !== this.deviceId) await this.syncOnce(bookId);
  }

  /**
   * §8.4: while this device still writes under the removal's epoch, mint the next key, seal it for every device of the
   * book not removed (never for a list the relay supplies, §5.4), and append the rotation. `201`: keep the key and move
   * to the new epoch. `409`: someone rotated first; their rotation arrives with the next pull.
   */
  async maybeRotate(bookId: string, removalEpoch: number): Promise<number | 'skipped' | 'conflict'> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active' || shared.epoch !== removalEpoch) return 'skipped';
    const [self] = await this.database.db.values<[string | null]>(sql`SELECT removed_at FROM book_devices WHERE book_id = ${bookId} AND device_id = ${this.deviceId}`);
    if (!self || self[0] !== null) return 'skipped'; // a removed device never seals
    const next = shared.epoch + 1;
    const key = randomBytes(32);
    const devices = await this.database.db.values<[string, string]>(
      sql`SELECT device_id, agree_jwk FROM book_devices WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY device_id`,
    );
    const sealed = await Promise.all(devices.map(([deviceId, agree]) => sealKeyFor({ deviceId, agreeJwk: JSON.parse(agree) as JsonWebKey }, bookId, next, key)));
    const hlc = await this.database.transaction((tx) => localTick(tx, this.deviceId, this.now()));
    const entry = await this.sealer.sign({ kind: 'rotation' as const, deviceId: this.deviceId, epoch: next, hlc, sealed });
    try {
      await this.transport.append(shared.relayBookId, entry);
    } catch (error) {
      if (error instanceof SyncTransportError && error.status === 409) return 'conflict';
      throw error;
    }
    await this.database.transaction(async (tx) => {
      await this.sealer.storeEpochKeyTx(tx, bookId, next, key);
      await tx.run(sql`UPDATE shared_books SET epoch = max(epoch, ${next}) WHERE book_id = ${bookId}`);
    });
    return next;
  }

  /** §8.3: a device newly introduced for an owner member joins the relay's owners, when this device is an owner's. */
  private async addOwnerDevices(bookId: string, introduced: readonly string[]): Promise<void> {
    if (introduced.length === 0) return;
    const shared = await this.sharedRow(bookId);
    if (!shared) return;
    const ownerDevices = await this.database.db.values<[string]>(sql`
      SELECT d.device_id FROM book_devices d JOIN book_members m ON m.book_id = d.book_id AND m.member_id = d.member_id
      WHERE d.book_id = ${bookId} AND d.removed_at IS NULL AND m.role = 'owner' ORDER BY d.device_id`);
    const ids = ownerDevices.map(([id]) => id);
    if (!ids.includes(this.deviceId) || !introduced.some((id) => ids.includes(id))) return;
    await this.transport.setOwners(shared.relayBookId, ids);
  }

  /* ---------------------------------------------------------------- restore */

  /**
   * §8.7, at app open: a book whose device is not this device, or whose epoch key does not open here, came from a
   * backup. It goes to `needs_invite` and its outbox is cleared; its rows stay, and recording works locally. Returns
   * the books it switched.
   */
  async checkRestore(): Promise<string[]> {
    const rows = await this.database.db.values<[string]>(sql`SELECT book_id FROM shared_books WHERE state = 'active'`);
    const switched: string[] = [];
    for (const [bookId] of rows) if (await this.checkBook(bookId)) switched.push(bookId);
    return switched;
  }

  /** Whether the book had to go to `needs_invite` (§8.7). */
  private async checkBook(bookId: string): Promise<boolean> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') return false;
    const [mine] = await this.database.db.values(sql`SELECT 1 FROM book_devices WHERE book_id = ${bookId} AND device_id = ${this.deviceId} AND removed_at IS NULL`);
    if (mine && (await this.sealer.epochKey(bookId, shared.epoch))) return false;
    await this.database.transaction(async (tx: Tx) => {
      await tx.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
      await tx.run(sql`DELETE FROM sync_outbox WHERE book_id = ${bookId}`);
    });
    return true;
  }

  private async sharedRow(bookId: string): Promise<{ relayBookId: string; epoch: number; memberId: string; state: string } | undefined> {
    const [row] = await this.database.db.values<[string, number, string, string]>(
      sql`SELECT relay_book_id, epoch, member_id, state FROM shared_books WHERE book_id = ${bookId}`,
    );
    return row ? { relayBookId: row[0], epoch: Number(row[1]), memberId: row[2], state: row[3] } : undefined;
  }
}

function parseCode(code: string): { inviteId: string; secret: Uint8Array } {
  try {
    return parseInviteCode(code);
  } catch {
    throw new SharingError('BAD_CODE', 'That is not an invite code');
  }
}

function merge(a: PullResult, b: PullResult): PullResult {
  const out: PullResult = {
    applied: a.applied + b.applied,
    skipped: [...a.skipped, ...b.skipped],
    removals: [...a.removals, ...b.removals],
    introduced: [...a.introduced, ...b.introduced],
  };
  const stopped = b.stopped ?? a.stopped;
  return stopped ? { ...out, stopped } : out;
}

export { MissingEpochKeyError };
