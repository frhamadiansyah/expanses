import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Tx } from '../database';
import { pullAndApply, reconcileAllMembersTx, type PullResult } from './apply';
import { clearAuthorityTx, viewActiveDevices, viewDevice, viewMember, viewOtherActiveOwners, viewOwnerDevices, viewRoleOfDevice } from './authority';
import { captureConfigOf, configureCapture, LastOwnerError, rowUpsertsTx, withCapture, withCapturePaused, writeChangeSetsTx } from './capture';
import { randomBytes, sealKeyFor } from './crypto';
import { localTick } from './hlc';
import {
  encodeInviteCode,
  inviteAad,
  INVITE_TTL_MS,
  inviteKeyOf,
  inviteLink,
  newInviteSecret,
  openInviteJson,
  parseInviteCode,
  sealInviteJson,
  termsSigningBytes,
  type InviteKey,
  type InvitePreview,
} from './invite';
import type { DeviceKeys } from './keys';
import { base64UrlToBytes, bytesToBase64Url, inviteSigningBytes } from './relay-signing';
import { MissingEpochKeyError, Sealer } from './seal';
import { assertShareableTx, emitUnknownRowsTx, SharingError, seedBookTx } from './seed';
import type { ChangeSet, InviteRecord, InviteTerms, SyncTransport } from './types';
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
 * - `makeOwner`, `leave`, `stopSharing`, `isFrozen` and `bookSyncStatus` (§8.4–§8.7, §11; task 9a).
 */

/** Only an owner may do this (§8.5): make an owner, stop sharing. Decided by the authority view. */
export class NotOwnerError extends SharingError {
  constructor(message = 'Only an owner of this workspace can do that') {
    super('NOT_OWNER', message);
    this.name = 'NotOwnerError';
  }
}

/**
 * The book is frozen (§8.5): no owner device is left in the authority view. Members still record and sync, and
 * rotation still works; nobody can invite, remove another device or make an owner.
 */
export class FrozenBookError extends SharingError {
  constructor() {
    super('FROZEN', 'This workspace has no owner device left: nobody can invite, remove a device or make an owner');
    this.name = 'FrozenBookError';
  }
}

/**
 * The status line of a shared book (§11), for the UI to word:
 * - `up_to_date` — "Up to date";
 * - `waiting` — "3 changes waiting" (`changes` is the outbox);
 * - `stale` — "Not synced since Tue" (`since`: the last finished sync; none has finished for longer than the stale
 *   window, 5 minutes by default — the scheduler's longest backoff);
 * - `needs_invite` — "Ask Dewi for a new invite to keep sharing" (`askName`: an owner of the book other than this member);
 * - `unshared` — "No longer shared by Fandri" (`byYou`: this device's own member left);
 * - `frozen` — no owner device is left (§8.5).
 */
export type BookSyncStatus =
  | { state: 'up_to_date'; syncedAt: string | null }
  | { state: 'waiting'; changes: number; syncedAt: string | null }
  | { state: 'stale'; since: string; changes: number }
  | { state: 'needs_invite'; askName: string | null }
  | { state: 'unshared'; byMemberId: string | null; byName: string | null; byYou: boolean }
  | { state: 'frozen'; changes: number; syncedAt: string | null };

/** How long since the last finished sync before the status line says "Not synced since …": the scheduler's longest wait. */
export const STALE_AFTER_MS = 5 * 60_000;

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
  /**
   * The sharing ended here during this call (task 9a): `unshared` — the relay answered `410`, its owner stopped sharing
   * (§8.6); `left` — another device of this member left, and this one followed (§8.4). The book is read-only after.
   */
  ended?: 'unshared' | 'left';
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
    try {
      return await this.syncActive(bookId, seen);
    } catch (error) {
      if (!(await this.endIfGone(bookId, error))) throw error;
      return { pushed: 0, applied: 0, skipped: [], removals: [], introduced: [], ended: 'unshared' };
    }
  }

  private async syncActive(bookId: string, seen?: Set<string>): Promise<SyncOnceResult> {
    const pushed = await this.drain(bookId);
    const ownersBefore = await this.database.transaction((tx) => viewOwnerDevices(tx, bookId));
    let result = await this.pull(bookId, seen);
    let rotated: number | undefined;
    let follow = false;
    for (const removal of result.removals) {
      if (removal.target === this.deviceId) continue; // a device never rotates on its own removal
      // Leave (§8.4): another device of this member left, so this one leaves too, and seals nothing on the way out.
      if (removal.leave && (await this.followsLeave(bookId, removal.target, removal.seq))) {
        follow = true;
        continue;
      }
      if (follow) continue;
      const outcome = await this.maybeRotate(bookId, removal.epoch);
      if (outcome === 'skipped') continue;
      if (typeof outcome === 'number') rotated = outcome;
      // Our own rotation, or on a 409 the one that won: either way the next pull brings it (§8.4 step 3).
      result = merge(result, await this.pull(bookId, seen));
    }
    if (follow) {
      await this.leaveNow(bookId);
      return { pushed, ...result, ended: 'left' };
    }
    await this.followOwners(bookId, ownersBefore);
    if (!result.stopped) await this.database.db.run(sql`UPDATE shared_books SET synced_at = ${new Date(this.now()).toISOString()} WHERE book_id = ${bookId}`);
    return rotated === undefined ? { pushed, ...result } : { pushed, rotated, ...result };
  }

  private pull(bookId: string, seen?: Set<string>): Promise<PullResult> {
    return pullAndApply(this.database, this.transport, this.sealer, bookId, this.now, seen);
  }

  /* ------------------------------------------------------------- invites */

  /**
   * §8.1: an invite to the book, sealing every epoch key this device holds and a preview under a key derived from a
   * fresh secret that only the code carries. `sameMember` links another device of a member that already exists: this
   * device's own (§8.3), or `memberId` — a restored phone of another member rejoining (§8.7). The terms — which member
   * the new device may join as — are signed by this device and travel sealed in the preview to the joiner, and in its
   * introduction to everyone, who check them before pinning it (§8.2, task 5 fix round 1).
   */
  async createInvite(bookId: string, input: { inviterName: string; sameMember?: boolean; memberId?: string }): Promise<CreatedInvite> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
    if (await this.isFrozen(bookId)) throw new FrozenBookError();
    const [book] = await this.database.db.values<[string, string]>(sql`SELECT name, base_currency FROM books WHERE id = ${bookId}`);
    if (!book) throw new SharingError('NOT_FOUND', 'That workspace is not here');
    // §6.5 step 4: the outbox is drained before any invite exists, so the creator's seed is always the log's first
    // entry — the one introduction that needs no invite (§8.2) — and every joiner finds the book already there.
    await this.drain(bookId);
    const inviteId = uuidv7();
    const secret = newInviteSecret();
    const key = await inviteKeyOf(secret, inviteId);
    const epochKeys: InviteKey[] = (await this.sealer.epochKeysOf(bookId)).map(({ epoch, key: k }) => ({ epoch, key: bytesToBase64Url(k) }));
    if (epochKeys.length === 0) throw new SharingError('NO_KEYS', "This device can't open this workspace's keys; it can't invite anyone");
    const sameMember = input.sameMember ?? false;
    const memberId = sameMember ? (input.memberId ?? shared.memberId) : undefined;
    const termsSig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.device.sign.privateKey,
      termsSigningBytes(bookId, { inviteId, sameMember, memberId }) as BufferSource,
    );
    const terms: InviteTerms = { inviteId, sameMember, ...(memberId === undefined ? {} : { memberId }), sig: bytesToBase64Url(new Uint8Array(termsSig)) };
    const preview: InvitePreview = { bookId, bookName: book[0], inviterName: input.inviterName, baseCurrency: book[1], terms };
    const expiresAt = new Date(this.now() + INVITE_TTL_MS).toISOString();
    const unsigned: Omit<InviteRecord, 'sig'> = {
      inviteId,
      keys: await sealInviteJson(key, epochKeys, inviteAad('keys', inviteId)),
      preview: await sealInviteJson(key, preview, inviteAad('preview', inviteId)),
      expiresAt,
      sameMember,
      ...(memberId === undefined ? {} : { memberId }),
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
    const preview = await openInviteJson<InvitePreview>(key, found.preview, inviteAad('preview', inviteId)).catch(() => {
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
    // Everything that can refuse locally is checked before the claim, which spends the invite (I4). A local failure
    // after it — the disk, say — needs a fresh invite from the owner (§8.2).
    const terms = preview.terms;
    if (!terms || terms.inviteId !== preview.inviteId) throw new SharingError('BAD_CODE', 'That invite is not complete');
    const existing = await this.sharedRow(preview.bookId);
    if (existing && existing.state !== 'needs_invite') throw new SharingError('ALREADY_SHARED', 'This workspace is already here');
    const rejoin = existing !== undefined;
    if (!rejoin && (await this.database.db.values(sql`SELECT 1 FROM books WHERE id = ${preview.bookId}`)).length > 0) {
      throw new SharingError('ALREADY_SHARED', 'This workspace is already here');
    }
    if (rejoin && !(terms.sameMember && terms.memberId === existing.memberId)) {
      throw new SharingError('INVITE_MISMATCH', 'This invite is for someone else; ask for an invite to rejoin as yourself');
    }

    const { inviteId, secret } = parseCode(code);
    const claim = await this.transport.claimInvite(inviteId, this.device.public);
    const keys = await openInviteJson<InviteKey[]>(await inviteKeyOf(secret, inviteId), claim.keys, inviteAad('keys', inviteId));
    if (keys.length === 0) throw new SharingError('NO_KEYS', 'That invite carries no keys; ask for a new one');
    const held = new Set(keys.map((k) => k.epoch));
    const epoch = held.has(claim.epoch) ? claim.epoch : Math.max(...held);
    const memberId = rejoin ? existing.memberId : terms.sameMember ? terms.memberId! : (input.memberId ?? uuidv7());
    const bookId = preview.bookId;
    const now = new Date(this.now()).toISOString();

    this.sealer.forget();
    await this.database.transaction(async (tx) => {
      if (rejoin) {
        await tx.run(sql`DELETE FROM book_epoch_keys WHERE book_id = ${bookId}`);
        await tx.run(sql`UPDATE shared_books SET relay_book_id = ${claim.bookId}, epoch = ${epoch}, state = 'active' WHERE book_id = ${bookId}`);
        await tx.run(sql`INSERT INTO sync_cursor (book_id, applied_seq) VALUES (${bookId}, 0) ON CONFLICT (book_id) DO UPDATE SET applied_seq = 0`);
        await clearAuthorityTx(tx, bookId); // rebuilt from the log, entry by entry, as the pull applies it again
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
    // The introduction (§8.2 step 7, §5.4): this device, unless linking or rejoining this member, and the signed terms
    // it joins on. Written as one change-set of its own, so the terms travel with the device op they vouch for.
    await this.database.transaction(async (tx) => {
      const newMember = !terms.sameMember && !rejoin;
      if (newMember) {
        await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${memberId}, ${input.memberName}, 'member', ${now})`);
      }
      await tx.run(sql`
        INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at)
        VALUES (${bookId}, ${this.deviceId}, ${memberId}, ${input.deviceName}, ${JSON.stringify(this.device.public.signJwk)}, ${JSON.stringify(this.device.public.agreeJwk)}, ${now}, NULL)`);
      const book = { bookId, memberId, epoch };
      const ops = [
        ...(await rowUpsertsTx(tx, book, 'device')).filter((op) => op.id === this.deviceId),
        ...(newMember ? (await rowUpsertsTx(tx, book, 'member')).filter((op) => op.id === memberId) : []),
      ];
      await writeChangeSetsTx(tx, captureConfigOf(this.database), book, ops, { invite: terms });
    });

    const seen = rejoin ? new Set<string>() : undefined;
    let result = await this.syncOnce(bookId, seen);
    if (rejoin && !result.stopped) {
      // S4 (task 9a): an edit the backup made and drained before it was taken comes back under the old device's id,
      // no longer "own", so the pull refused it without putting the row back. Every member row goes to the view's.
      await this.database.transaction((tx) => withCapturePaused(tx, () => reconcileAllMembersTx(tx, bookId)));
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
    if (target !== this.deviceId && (await this.isFrozen(bookId))) throw new FrozenBookError();
    const hlc = await this.database.transaction((tx) => localTick(tx, this.deviceId, this.now()));
    const entry = await this.sealer.sign(bookId, { kind: 'removal' as const, deviceId: this.deviceId, epoch: shared.epoch, hlc, target });
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
    // Who is in comes from the authority view — the log's word, never a local edit (fix round 2).
    const active = await this.database.transaction((tx) => viewActiveDevices(tx, bookId));
    if (!active.includes(this.deviceId)) return 'skipped'; // a removed device never seals
    const next = shared.epoch + 1;
    const key = randomBytes(32);
    const devices: [string, string][] = [];
    for (const deviceId of active) {
      const [row] = await this.database.db.values<[string]>(sql`SELECT agree_jwk FROM book_devices WHERE book_id = ${bookId} AND device_id = ${deviceId}`);
      if (row) devices.push([deviceId, row[0]]);
    }
    const sealed = await Promise.all(devices.map(([deviceId, agree]) => sealKeyFor({ deviceId, agreeJwk: JSON.parse(agree) as JsonWebKey }, bookId, next, key)));
    const hlc = await this.database.transaction((tx) => localTick(tx, this.deviceId, this.now()));
    const entry = await this.sealer.sign(bookId, { kind: 'rotation' as const, deviceId: this.deviceId, epoch: next, hlc, sealed });
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

  /**
   * §8.3, §8.5 (fix round 2): the relay's owners follow the authority view. When a pull changed the set of owner
   * devices — a promotion, a demotion, a linked device of an owner — an owner device tells the relay the new set. A
   * device of an owner member that is not yet an owner on the relay is told so with 403, and leaves it to one that is.
   */
  private async followOwners(bookId: string, before: readonly string[]): Promise<void> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') return;
    const after = await this.database.transaction((tx) => viewOwnerDevices(tx, bookId));
    if (!after.includes(this.deviceId)) return;
    if (after.length === before.length && after.every((id, i) => id === before[i])) return;
    await this.transport.setOwners(shared.relayBookId, after).catch((error: unknown) => {
      if (!(error instanceof SyncTransportError && error.status === 403)) throw error;
    });
  }

  /* ------------------------------------------------- ownership, leave, stop */

  /**
   * §8.5 Make owner: a `member` op setting `role = 'owner'`, by an owner (per the view). The sync that follows takes it
   * into the view and `followOwners` hands the relay the new owner devices. A transport failure leaves that to the
   * next sync; the op is in the outbox.
   */
  async makeOwner(bookId: string, memberId: string): Promise<void> {
    await this.requireActive(bookId);
    if (await this.isFrozen(bookId)) throw new FrozenBookError();
    if (!(await this.selfIsOwner(bookId))) throw new NotOwnerError('Only an owner can make someone an owner');
    const member = await this.database.transaction((tx) => viewMember(tx, bookId, memberId));
    if (!member || member.deleted) throw new SharingError('NOT_FOUND', 'That person is not in this workspace');
    if (member.role === 'owner') return;
    await this.database.transaction((tx) =>
      withCapture(tx, { entity: 'member', id: memberId, bookId }, async () => {
        await tx.run(sql`UPDATE book_members SET role = 'owner' WHERE book_id = ${bookId} AND member_id = ${memberId}`);
      }),
    );
    await this.syncSoon(bookId);
  }

  /**
   * §8.4 Leave: this device removes itself with a `leave` removal, and every other device of this member, applying it,
   * removes itself too (a device may always remove itself; only an owner removes another, and the relay knows no
   * members). The last owner cannot leave (`LastOwnerError`) until another owner with a device still in exists; an
   * owner who leaves steps down to member first (fix round 1). What waits in the outbox goes out first. The book stays here with every row, read-only (`unshared`, by this member).
   */
  async leave(bookId: string): Promise<void> {
    await this.requireActive(bookId);
    const synced = await this.syncOnce(bookId);
    if (synced.ended) return;
    const shared = (await this.sharedRow(bookId))!;
    if (await this.selfIsOwner(bookId)) {
      // Fix round 1: only another owner who still has a device in counts; leaving past one with none freezes the book.
      if ((await this.database.transaction((tx) => viewOtherActiveOwners(tx, bookId, shared.memberId))) === 0) {
        throw new LastOwnerError("You're this workspace's last owner: make someone else an owner before you leave");
      }
      // An owner steps down before leaving, so nobody is sent to ask a departed owner (§8.7) and the view keeps no
      // owner without a device. It must reach the log before the removal: after it, this device's entries count for nothing.
      await this.database.transaction((tx) =>
        withCapture(tx, { entity: 'member', id: shared.memberId, bookId }, async () => {
          await tx.run(sql`UPDATE book_members SET role = 'member' WHERE book_id = ${bookId} AND member_id = ${shared.memberId}`);
        }),
      );
      if ((await this.syncOnce(bookId)).ended) return;
    }
    await this.leaveNow(bookId);
  }

  /** The leave itself: the signed `leave` removal of this device, the relay drops it, and the book here ends. */
  private async leaveNow(bookId: string): Promise<void> {
    const shared = (await this.sharedRow(bookId))!;
    const hlc = await this.database.transaction((tx) => localTick(tx, this.deviceId, this.now()));
    const entry = await this.sealer.sign(bookId, { kind: 'removal' as const, deviceId: this.deviceId, epoch: shared.epoch, hlc, target: this.deviceId, leave: true as const });
    await this.transport.append(shared.relayBookId, entry);
    await this.transport.removeDevice(shared.relayBookId, this.deviceId);
    await this.endShared(bookId, shared.memberId);
  }

  /**
   * §8.6 Stop sharing, by an owner (per the view): the relay deletes the book, and every other device goes `unshared`
   * on its next call (`410`). Here the book becomes an ordinary local book again: `shared_books` and the sync state of
   * the book go; every row stays, and so do `book_members`, `book_member_accounts` (another member's money stays
   * hidden, §4.4) and `sync_lineage` (who paid). A book another owner already stopped goes `unshared` here instead.
   */
  async stopSharing(bookId: string): Promise<void> {
    const shared = await this.requireActive(bookId);
    if (!(await this.selfIsOwner(bookId))) throw new NotOwnerError('Only an owner can stop sharing');
    // Fix round 1: what waits in the outbox goes to the log first, when the relay can be reached.
    try {
      await this.drain(bookId);
    } catch (error) {
      if (await this.endIfGone(bookId, error)) return;
    }
    try {
      await this.transport.deleteBook(shared.relayBookId);
    } catch (error) {
      if (await this.endIfGone(bookId, error)) return;
      throw error;
    }
    this.sealer.forget();
    await this.database.transaction(async (tx) => {
      // `shared_books` first: from here on the book is not shared, and nothing below is a change to a shared row.
      await tx.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
      for (const table of ['sync_outbox', 'sync_cursor', 'book_epoch_keys', 'sync_field_clocks', 'sync_tombstones', 'sync_skipped', 'book_devices']) {
        await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
      }
      await clearAuthorityTx(tx, bookId);
    });
  }

  /**
   * §8.5: no owner device is left in the authority view. A book whose view holds no device yet (never pulled) is not
   * frozen.
   */
  async isFrozen(bookId: string): Promise<boolean> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') return false;
    return this.database.transaction(async (tx) => {
      if ((await viewActiveDevices(tx, bookId)).length === 0) return false;
      return (await viewOwnerDevices(tx, bookId)).length === 0;
    });
  }

  /** The status line of a shared book (§11); `null` for a book not shared on this device. */
  async bookSyncStatus(bookId: string, options: { now?: number; staleAfterMs?: number } = {}): Promise<BookSyncStatus | null> {
    const [row] = await this.database.db.values<[string, string, string | null, string | null]>(
      sql`SELECT state, member_id, synced_at, unshared_by FROM shared_books WHERE book_id = ${bookId}`,
    );
    if (!row) return null;
    const [state, memberId, syncedAt, unsharedBy] = row;
    const nameOf = async (id: string | null) =>
      id === null ? null : ((await this.database.db.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${id}`))[0]?.[0] ?? null);
    if (state === 'unshared') return { state: 'unshared', byMemberId: unsharedBy, byName: await nameOf(unsharedBy), byYou: unsharedBy === memberId };
    if (state === 'needs_invite') {
      // An owner to ask: per the view, else per this device's rows (a view a restore brought back).
      const [owner] = await this.database.db.values<[string]>(sql`
        SELECT m.name FROM book_members m LEFT JOIN sync_authority a ON a.book_id = m.book_id AND a.member_id = m.member_id
        WHERE m.book_id = ${bookId} AND m.member_id <> ${memberId} AND coalesce(a.role, m.role) = 'owner' AND coalesce(a.deleted, 0) = 0
        ORDER BY m.joined_at, m.member_id LIMIT 1`);
      return { state: 'needs_invite', askName: owner?.[0] ?? null };
    }
    const [[waiting]] = (await this.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${bookId}`)) as [[number]];
    const changes = Number(waiting);
    if (await this.isFrozen(bookId)) return { state: 'frozen', changes, syncedAt };
    const now = options.now ?? this.now();
    if (syncedAt !== null && now - Date.parse(syncedAt) > (options.staleAfterMs ?? STALE_AFTER_MS)) return { state: 'stale', since: syncedAt, changes };
    if (changes > 0) return { state: 'waiting', changes, syncedAt };
    return { state: 'up_to_date', syncedAt };
  }

  /** The book is shared and active here, or `NOT_FOUND`. */
  private async requireActive(bookId: string): Promise<{ relayBookId: string; epoch: number; memberId: string; state: string }> {
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
    return shared;
  }

  private selfIsOwner(bookId: string): Promise<boolean> {
    return this.database.transaction(async (tx) => (await viewRoleOfDevice(tx, bookId, this.deviceId)) === 'owner');
  }

  /**
   * Whether this device follows a leave by `deviceId` at `seq` (§8.4): that device is of this device's member, per the
   * view, and this device was in before the leave (fix round 1) — a device of the member admitted after it, re-invited
   * or a restored phone rejoining, stays.
   */
  private followsLeave(bookId: string, deviceId: string, seq: number): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const [other, self] = [await viewDevice(tx, bookId, deviceId), await viewDevice(tx, bookId, this.deviceId)];
      if (other === null || self === null || self.removedSeq !== null || other.memberId !== self.memberId) return false;
      return (self.addedSeq ?? 0) < seq;
    });
  }

  /** A sync right after a local change, when the relay can be reached; otherwise the scheduler's next run does it. */
  private async syncSoon(bookId: string): Promise<void> {
    try {
      await this.syncOnce(bookId);
    } catch (error) {
      if (!(error instanceof SyncTransportError)) throw error;
    }
  }

  /**
   * §8.6: a `410` for the book — its owner stopped sharing. The book goes `unshared`, naming the member whose device
   * deleted it (the relay says which device; this device's pinned list says whose). Whether it was that.
   */
  private async endIfGone(bookId: string, error: unknown): Promise<boolean> {
    if (!(error instanceof SyncTransportError && error.status === 410)) return false;
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') return false;
    const [by] = error.deletedBy
      ? await this.database.db.values<[string]>(sql`SELECT member_id FROM book_devices WHERE book_id = ${bookId} AND device_id = ${error.deletedBy}`)
      : [];
    await this.endShared(bookId, by?.[0] ?? null);
    return true;
  }

  /** The sharing ended here: read-only from now on (capture refuses every write), with who ended it. */
  private async endShared(bookId: string, by: string | null): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.run(sql`UPDATE shared_books SET state = 'unshared', unshared_by = ${by} WHERE book_id = ${bookId}`);
      await tx.run(sql`DELETE FROM sync_outbox WHERE book_id = ${bookId}`); // nowhere to go now
    });
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
