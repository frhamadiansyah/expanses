import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import { replacementsOf, type Database, type Tx } from '../database';
import { ARRIVING_KEY, pullAndApply, reconcileAllMembersTx, type PullResult } from './apply';
import { clearAuthorityTx, eventBookWorkspaceOf, groupLogWorkspaceOf, mayLinkAsMemberTx, viewActiveDevices, viewDevice, viewMember, viewOtherActiveOwners, viewOwnerDevices, viewRoleOfDevice } from './authority';
import { ownersGone } from '../repos/sharing';
import { recalcPendingForeign } from '../repos/fx-pending';
import { retryUnpostedEventRecords } from '../repos/shared-event-postings';
import { uncategorisedIdOf } from '../repos/uncategorised';
import { captureConfigOf, configureCapture, LastOwnerError, rowUpsertsTx, withCapture, withCapturePaused, writeChangeSetsTx } from './capture';
import { randomBytes, sealKeyFor } from './crypto';
import { endSharedGoalsTx } from './goals/follow';
import { decodeHlc, localTick } from './hlc';
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
  type EventInviteDetails,
  type InviteKey,
  type InvitePreview,
} from './invite';
import {
  eventInviteDetails,
  type EventLogHost,
  isEventBook,
  isEventMember,
  joinEvent as joinEventLog,
  type JoinEventInput,
  leaveEvent as leaveEventLog,
  removeEventMember as removeEventMemberLog,
  removeEventMemberPhones as removeEventMemberPhonesLog,
  shareEvent as shareEventLog,
  type ShareEventInput,
} from './events/event-log';
import type { DeviceKeys } from './keys';
import { base64UrlToBytes, bytesToBase64Url, inviteSigningBytes } from './relay-signing';
import {
  admitToGroupLog,
  dropInviteMarksTx,
  exitGroupOf,
  groupLogOf,
  groupMembersReady,
  leaveGroupLog,
  openGroupLog,
  removeFromGroupLog,
  sweepBeforeDrain,
  syncGroupAfter,
  type GroupLogHost,
} from './net-worth/group-log';
import { afterWorkspaceSync, answerNetWorth, cancelNetWorth, leaveNetWorth, netWorthGroup, proposeNetWorth, type NetWorthGroupView } from './net-worth/proposals';
import type { FilingMode } from '@expanses/core';
import {
  editMemberTransfer as editTransfer,
  recordMemberTransfer as recordTransfer,
  voidMemberTransfer as voidTransfer,
  type MemberTransferInput,
  type MemberTransferPatch,
} from './net-worth/transfers';
import { heldElsewhereOf } from './held';
import { MissingEpochKeyError, Sealer } from './seal';
import type { ShareRecord, ShareRecordStore } from './share-records';
import { assertShareableTx, catchUpTx, emitNewerTx, keepClocksTx, REMEMBERED_MEMBER_KEY, SeenLog, SharingError, seedBookTx } from './seed';
import type { ChangeSet, InviteRecord, InviteTerms, SyncTransport } from './types';
import { removedFromBook, SyncTransportError } from './types';

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
 * - The share records beside the device keys (sharing resilience §6.1): written on share, join, every new epoch key,
 *   a role change and the cursor (at most every `recordEveryMs`); removed when the share ends knowingly here;
 *   `backfillShareRecords` and `checkShareRecords` at open (§6.2, §7).
 * - `makeOwner`, `leave`, `stopSharing`, `isFrozen` and `bookSyncStatus` (§8.4–§8.7, §11; task 9a).
 * - The net-worth group log (joint-net-worth §4; net-worth/group-log.ts): `openGroupLog`, `admitToGroupLog`,
 *   `leaveGroupLog`, `removeFromGroupLog`, `groupLogOf`, `groupMembersReady`; `syncOnce` of a workspace syncs its group
 *   log too.
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
 * Leave stepped this owner down to member, and the log has that, but the removal of this device did not reach the relay
 * (fix round 2). The device is still in, as a member; `leave` again finishes it. `cause` is what failed.
 */
export class LeaveIncompleteError extends SharingError {
  constructor(readonly cause: unknown) {
    super('LEAVE_INCOMPLETE', "No longer an owner, but leaving didn't finish: try again");
    this.name = 'LeaveIncompleteError';
  }
}

/**
 * The status line of a shared book (§11), for the UI to word:
 * - `up_to_date` — "Up to date";
 * - `waiting` — "3 changes waiting" (`changes` is the outbox);
 * - `stale` — "Not synced since Tue" (`since`: the last finished sync; none has finished for longer than the stale
 *   window, 5 minutes by default — the scheduler's longest backoff);
 * - `needs_invite` — "Ask Dewi for a new invite to keep sharing" (`askName`: an owner of the book other than this member);
 * - `unshared` — "No longer shared by Fandri" (`byYou`: this device's own member left; `reason: 'removed'`: this
 *   device was removed, final review I2 — "You were removed from this workspace");
 * - `frozen` — no owner device is left (§8.5).
 */
export type BookSyncStatus =
  | { state: 'up_to_date'; syncedAt: string | null }
  | { state: 'waiting'; changes: number; syncedAt: string | null }
  | { state: 'stale'; since: string; changes: number }
  | { state: 'needs_invite'; askName: string | null }
  | { state: 'unshared'; byMemberId: string | null; byName: string | null; byYou: boolean; reason: EndedReason }
  | { state: 'frozen'; changes: number; syncedAt: string | null };

/** How long since the last finished sync before the status line says "Not synced since …": the scheduler's longest wait. */
export const STALE_AFTER_MS = 5 * 60_000;

/** A last-synced or last-heard time is written only once it has moved by more than this (final review, minor 4). */
export const SEEN_WRITE_MS = 60_000;

/** How a share ended on this device: its owner stopped it (§8.6), this member left (§8.4), or this device was removed (§8.4). */
export type EndedReason = 'stopped' | 'left' | 'removed';

export interface ShareInput {
  memberName: string;
  deviceName: string;
  /** This person's member id in the book. When omitted: the one this device remembers from a share of this book it ended (§8.6, C1), else a fresh one. */
  memberId?: string;
}

export interface SyncOnceResult extends PullResult {
  /** Outbox entries appended to the relay by this call. */
  pushed: number;
  /** The epoch this device rotated the book to, when it did (§8.4). */
  rotated?: number;
  /**
   * The sharing ended here during this call (task 9a): `unshared` — the relay answered `410`, its owner stopped sharing
   * (§8.6); `left` — another device of this member left, and this one followed (§8.4); `removed` — the relay answered
   * `403 removed`: an owner removed this device (§8.4, final review I2). The book is read-only after.
   */
  ended?: 'unshared' | 'left' | 'removed';
  /** A workspace's sync also syncs its net-worth group log, when this device is in it (joint-net-worth §4): that sync. */
  group?: SyncOnceResult;
  /**
   * The group log's part failed on the relay (task 4 review round 1): the workspace's own sync still counts, and the
   * group log is tried again on the next run.
   */
  groupError?: SyncTransportError | Error;
}

/** What a caller of `resetAndPull` adds to the reset (see there). */
interface ResetSteps {
  replayOwn?: { fromSeq: number };
  resetTx?: (tx: Tx) => Promise<void>;
  afterResetTx?: (tx: Tx) => Promise<void>;
  beforePull?: () => Promise<void>;
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
  /**
   * Joining moves this device's copy of the book onto the invite's relay book, away from the one it was shared on
   * (recovery review, N1): the screen asks first — "This replaces the sharing of Home on this device with Fandri's
   * share". `bookName` is the book's name here. `null` for a new book, or a rejoin of the same relay book (§8.7).
   */
  replaces: { bookName: string } | null;
  /**
   * Other copies here of the invite's workspace (sharing resilience D-A7): books, but the invite's own, of the same
   * name whose members include the inviter's member id, or a member of the inviter's name who is an owner — an earlier
   * copy of the same workspace, most likely. Rows such a copy still holds are set aside on join (`HELD_ELSEWHERE`) until it is deleted, so the join
   * screen warns. `state` is the copy's `shared_books` state, `own` with none.
   */
  otherCopies: { bookId: string; name: string; state: string; sharedAt: string | null; joined: boolean }[];
}

/** A copy of the invited book already on this device, and what joining would do to it (§8.2, §8.6, §8.7). */
type CopyHere =
  | { kind: 'none' }
  | { kind: 'refused'; error: SharingError }
  | { kind: 'rejoin'; memberId: string; state: string; moving: boolean; bookName: string };

export interface JoinInput {
  /** The workspace the joined book goes into; its currency must be the book's (§8.2 step 3). */
  ws: WorkspaceContext;
  memberName: string;
  deviceName: string;
  /** This person's member id in the book, when joining as a new member. A fresh one when omitted (§8.2 step 6). */
  memberId?: string;
}

export interface SyncEngineOptions {
  /** This app's own version (joint-net-worth spec §9), written on `book_devices.app_version` whenever this device
   * writes its own row (`shareBook`, `joinBook`), so a peer can tell whether it meets `NET_WORTH_MIN_APP_VERSION`. */
  appVersion?: string;
  /**
   * Where this device keeps its share records (sharing resilience §6.1), outside the database. Without one the engine
   * keeps none: `backfillShareRecords` writes nothing and `checkShareRecords` finds nothing.
   */
  shareRecords?: ShareRecordStore;
  /** The cursor reaches the share record at most this often (§6.1); `flushShareRecord` writes it at once. 30 s by default. */
  recordEveryMs?: number;
  /**
   * Told when the share record store failed (a locked keychain, a full disk), after a `console.warn`; `bookId` is null
   * for a failed listing. For the app's sync log. A record never fails a share, join or sync.
   */
  onShareRecordProblem?: (bookId: string | null, error: unknown) => void;
}

/**
 * What a share record says next to this database at open (sharing resilience §6.2), from local rows only:
 * - `ok` — `shared_books` is active on the record's relay book, the cursor at or past the record's;
 * - `behind` — active there, the cursor (`fromSeq`) before the record's (`toSeq`): a copy restored from after the share;
 * - `lost` — the book is here and its share is not: no `shared_books` row, `needs_invite` on the record's relay book,
 *   or another relay book that is not active;
 * - `missing_book` — no book with that id here.
 * The relay's answers (`ended`, `removed`) are Drop B's.
 */
export type ShareRecordFinding =
  | { kind: 'ok'; bookId: string }
  | { kind: 'behind'; bookId: string; bookName: string; fromSeq: number; toSeq: number }
  | { kind: 'lost'; bookId: string; bookName: string; relayBookId: string }
  | { kind: 'missing_book'; bookId: string; bookName: string; relayBookId: string };

/** How often the cursor reaches a share record by default (§6.1). */
export const RECORD_EVERY_MS = 30_000;

/**
 * The settings key of a book's replay point (review I1): `{ relayBookId, fromSeq, toSeq }`, written when
 * `checkShareRecords` finds the copy `behind`, cleared by `clearReplayPoint` once Drop B's replay has run.
 */
export const REPLAY_POINT_KEY = (bookId: string) => `sharing.replay.${bookId}`;

export class SyncEngine {
  readonly sealer: Sealer;
  private readonly appVersion?: string;
  private readonly records?: ShareRecordStore;
  private readonly recordEveryMs: number;
  private readonly onRecordProblem?: (bookId: string | null, error: unknown) => void;
  /** Books whose share record waits on an epoch key just kept (`Sealer.onStored`): written at the end of the next sync. */
  private readonly recordDirty = new Set<string>();
  /** What this engine last wrote of each book's record, and when: the cursor alone waits `recordEveryMs`. */
  private readonly recordWritten = new Map<string, { at: number; record: ShareRecord }>();
  /**
   * Whether `checkShareRecords` has read the records once on this engine (review N1). Until then no record is written
   * but by `shareBook` and `joinBook`: a sync or flush of a restored copy would otherwise overwrite the very record
   * that shows it is behind.
   */
  private recordsChecked = false;
  /** Books the check found `lost` here (review N2): Share waits for `discardShareRecord`. */
  private readonly lostHere = new Set<string>();
  /**
   * Books whose whole log is being pulled again (Place them now, a same-book rejoin): the run, by book. A `syncOnce` or
   * `drain` of the book from outside waits for it to finish first (A6 fix round 1), so the scheduler's ordinary sync
   * never pulls past a cursor that was just set back to 0, nor applies beside it.
   */
  private readonly resetting = new Map<string, Promise<unknown>>();
  /**
   * The `syncOnce` and `drain` calls of each book under way (A6 fix round 2): a whole-log pull waits for every one of
   * them before it resets, so an ordinary pull already waiting on the relay never writes its cursor over the reset.
   * Ordinary calls never wait for each other (a group log's sync removes a device and syncs itself again inside).
   */
  private readonly inFlight = new Map<string, Set<Promise<unknown>>>();
  /**
   * Books in a whole-log pull right now (`resetAndPull`): only their pulls land this member's own purchases with no head
   * on own accounts (D-B6, A6 fix round 3). No ordinary call of the book runs meanwhile (`alone`), so none lands that way.
   */
  private readonly landing = new Set<string>();
  /** `replacementsOf(database)` as this engine last saw it: a change means a restore swapped the rows (review R1). */
  private seenReplacements: number;

  constructor(
    private readonly database: Database,
    private readonly transport: SyncTransport,
    readonly device: DeviceKeys,
    private readonly now: () => number = Date.now,
    options: SyncEngineOptions = {},
  ) {
    this.sealer = new Sealer(database, device, { onStored: (bookId) => this.recordDirty.add(bookId) });
    this.appVersion = options.appVersion;
    this.records = options.shareRecords;
    this.recordEveryMs = options.recordEveryMs ?? RECORD_EVERY_MS;
    this.onRecordProblem = options.onShareRecordProblem;
    this.seenReplacements = replacementsOf(database);
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
    this.followDatabase();
    await this.database.transaction((tx) => assertShareableTx(tx, bookId));
    await this.refuseOverLostShare(bookId);
    const { bookId: relayBookId } = await this.transport.createBook(this.device.public);
    const [remembered] = await this.database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${REMEMBERED_MEMBER_KEY(bookId)}`);
    const memberId = input.memberId ?? remembered?.[0] ?? uuidv7();
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
          appVersion: this.appVersion,
        });
      });
      await this.writeRecord(bookId, true); // never throws: a record that cannot be written never undoes the share
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
   * A `409 stale epoch` (final review, I1) — the book rotated while this device was away — pulls the rotation in and
   * seals again under it; the outbox is plaintext, so nothing is lost by sealing twice.
   */
  drain(bookId: string): Promise<number> {
    return this.ordinary(bookId, () => this.drainInto(bookId, undefined, []));
  }

  /** `drain`, with whatever a stale-epoch re-pull applied collected into `pulls`, for `syncActive` to act on. */
  private async drainInto(bookId: string, seen: SeenLog | undefined, pulls: PullResult[], skipSummaries = false): Promise<number> {
    let shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') return 0;
    const rows = await this.database.db.values<[string, string]>(sql`SELECT id, entry_json FROM sync_outbox WHERE book_id = ${bookId} ORDER BY hlc`);
    let pushed = 0;
    for (const [id, changeSetJson] of rows) {
      if (skipSummaries && (JSON.parse(changeSetJson) as ChangeSet).ops.some((op) => op.entity === 'nw_item')) continue;
      for (let attempt = 0; ; attempt += 1) {
        const entry = await this.sealer.seal(bookId, shared.epoch, JSON.parse(changeSetJson) as ChangeSet);
        try {
          await this.transport.append(shared.relayBookId, entry);
          break;
        } catch (error) {
          if (!(error instanceof SyncTransportError && error.status === 409 && attempt === 0)) throw error;
          const repulled = await this.pull(bookId, seen);
          pulls.push(repulled);
          const now = await this.sharedRow(bookId);
          if (
            now &&
            now.state === 'active' &&
            now.epoch === shared.epoch &&
            !repulled.stopped &&
            (await groupLogWorkspaceOf(this.database.db, bookId)) !== null &&
            (await this.database.transaction((tx) => viewDevice(tx, bookId, this.deviceId))) === null
          ) {
            // Joint net worth, final review item 5: the group log rotated past this device before its introduction
            // landed, and a pull to the end of the log brought no key for it — it joined on an invite made before the
            // rotation. Not in the log's view, it is invited again by a group member's device: it waits for that fresh
            // invite (`needs_invite`), which the workspace's next sync claims (the restored phone's path).
            await this.database.db.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
          }
          if (!now || now.state !== 'active' || now.epoch === shared.epoch) throw error;
          shared = now;
        }
      }
      await this.database.db.run(sql`DELETE FROM sync_outbox WHERE id = ${id}`);
      pushed += 1;
    }
    return pushed;
  }

  /**
   * One sync of one book: pull and apply, drain, then pull again (final review, I1: what waits in the outbox is sealed
   * under the epoch the log has now, never one a removed device still holds); then rotate if a removal calls for it
   * (§8.4) and add a linked device of an owner to the relay's owners (§8.3). A transport failure throws; the outbox
   * and cursor stay put.
   */
  syncOnce(bookId: string, seen?: SeenLog): Promise<SyncOnceResult> {
    return this.ordinary(bookId, () => this.syncOnceNow(bookId, seen));
  }

  /**
   * An ordinary call of the book (`syncOnce`, `drain`): after any whole-log pull of it under way or waiting, and counted
   * in `inFlight` while it runs, so the next whole-log pull waits for it (A6 fix rounds 1 and 2).
   */
  private async ordinary<T>(bookId: string, run: () => Promise<T>): Promise<T> {
    while (this.resetting.has(bookId)) await this.resetting.get(bookId);
    const running = run();
    let calls = this.inFlight.get(bookId);
    if (!calls) this.inFlight.set(bookId, (calls = new Set()));
    calls.add(running);
    try {
      return await running;
    } finally {
      calls.delete(running);
      if (calls.size === 0 && this.inFlight.get(bookId) === calls) this.inFlight.delete(bookId);
    }
  }

  /** `syncOnce`, without waiting: for the run that holds the book (`resetAndPull`). */
  private async syncOnceNow(bookId: string, seen?: SeenLog): Promise<SyncOnceResult> {
    // Review N1: detection comes first. A pull moves the cursor past own entries it does not apply, so a copy restored
    // from after the share would read as caught up; the check, run once here if the app has not run it, keeps its
    // replay point first. It never throws, and findings stay for the app's own call.
    this.followDatabase();
    if (this.records && !this.recordsChecked) await this.checkShareRecords();
    const result = await this.syncBook(bookId, seen);
    // Withdrawal rate (R9): what apply just put on this phone's own foreign accounts was queued, since capture was
    // paused; recalculated now, with capture on, so the new figures go to the household as an ordinary edit (sent on
    // the next sync). Never fails the sync: what cannot be recalculated waits for the next one.
    try {
      await recalcPendingForeign(this.database);
    } catch (error) {
      console.warn('Synced; a foreign account could not be recalculated yet', error);
    }
    // Shared events §5: a record left waiting here (a rate, a detail not yet arrived, a derivation the ledger refused)
    // is tried again after the pull. Never fails the sync: what still cannot post waits for the next one.
    if (!result.stopped && !result.ended && (await eventBookWorkspaceOf(this.database.db, bookId)) !== null) {
      try {
        await retryUnpostedEventRecords(this.database, bookId);
      } catch (error) {
        console.warn('Synced the event; a waiting share could not be posted yet', error);
      }
    }
    // Joint net worth (§4): a workspace's sync joins and syncs its group log; a group log that ended here is forgotten.
    // No failure of the group log's part — a relay error or any other — fails the workspace's sync (task 4 review round
    // 1; final review item 6): it comes back as `groupError`, and the next run tries again.
    let group: SyncOnceResult | undefined;
    try {
      group = await syncGroupAfter(this.groupHost(), bookId, result);
    } catch (error) {
      return { ...result, groupError: error instanceof Error ? error : new Error(String(error)) };
    }
    // Its proposals' consequences (task 5): a lost lone log abandoned, a dissolved group's log deleted or a closed live
    // link opened again, a member's later device let in, the pending count written. None of it ever fails the
    // workspace's own sync (review round 1, finding 7): what goes wrong is the group's, reported as `groupError`, and
    // tried again on the next run.
    try {
      await afterWorkspaceSync(this.groupHost(), bookId, result);
    } catch (error) {
      const groupError = error instanceof Error ? error : new Error(String(error));
      return group ? { ...result, group, groupError } : { ...result, groupError };
    }
    return group ? { ...result, group } : result;
  }

  /** `syncOnce` of the book alone. */
  private async syncBook(bookId: string, seen?: SeenLog): Promise<SyncOnceResult> {
    if (await this.checkBook(bookId)) return { pushed: 0, applied: 0, skipped: [], removals: [], introduced: [], stopped: { seq: 0, reason: 'needs invite' } };
    try {
      return await this.syncActive(bookId, seen);
    } catch (error) {
      const ended = await this.endIfGone(bookId, error);
      if (!ended) throw error;
      return { pushed: 0, applied: 0, skipped: [], removals: [], introduced: [], ended: ended === 'stopped' ? 'unshared' : 'removed' };
    }
  }

  /**
   * A device that shared or joined before it carried its own version — or was upgraded since — keeps whatever
   * `app_version` it last wrote (possibly `NULL`) until it says otherwise (task 1 review round 1, ruling on the app
   * version): every `syncOnce` corrects it here, captured so the write reaches the outbox and its peers.
   */
  private async syncOwnAppVersion(bookId: string): Promise<void> {
    if (!this.appVersion) return;
    const [row] = await this.database.db.values<[string | null]>(
      sql`SELECT app_version FROM book_devices WHERE book_id = ${bookId} AND device_id = ${this.deviceId}`,
    );
    if (!row || row[0] === this.appVersion) return;
    await this.database.transaction((tx) =>
      withCapture(tx, { entity: 'device', id: this.deviceId, bookId }, async () => {
        await tx.run(sql`UPDATE book_devices SET app_version = ${this.appVersion} WHERE book_id = ${bookId} AND device_id = ${this.deviceId}`);
      }),
    );
  }

  private async syncActive(bookId: string, seen?: SeenLog): Promise<SyncOnceResult> {
    await this.syncOwnAppVersion(bookId);
    const ownersBefore = await this.database.transaction((tx) => viewOwnerDevices(tx, bookId));
    let result = await this.pull(bookId, seen);
    let pushed = 0;
    if (!result.stopped) {
      const pulls: PullResult[] = [];
      let skipSummaries = false;
      // Joint net worth, wave 3 round 4: in a group log, nothing waiting is sealed under a key someone outside the group
      // still holds — a removal the pull brought is rotated past first, anyone outside the active group is taken out,
      // and while one is still in, no summary op leaves (it waits in the outbox for the next sync).
      if ((await groupLogWorkspaceOf(this.database.db, bookId)) !== null) {
        result = await this.rotateBeforeDrain(bookId, result, seen);
        skipSummaries = !(await sweepBeforeDrain(this.groupHost(), bookId));
      }
      pushed = await this.drainInto(bookId, seen, pulls, skipSummaries);
      for (const pulled of pulls) result = merge(result, pulled);
      result = merge(result, await this.pull(bookId, seen));
    }
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
      await this.leaveNow(bookId, false);
      return { pushed, ...result, ended: 'left' };
    }
    await this.followOwners(bookId, ownersBefore);
    if (!result.stopped) {
      // Written only once it has moved by more than a minute (final review, minor 4): an idle device polling every 30 s
      // is not writing its database each time, and "Not synced since" is never more than a minute out.
      const now = this.now();
      await this.database.db.run(
        sql`UPDATE shared_books SET synced_at = ${new Date(now).toISOString()} WHERE book_id = ${bookId} AND (synced_at IS NULL OR synced_at < ${new Date(now - SEEN_WRITE_MS).toISOString()})`,
      );
    }
    await this.recordAfterSync(bookId, pushed);
    return rotated === undefined ? { pushed, ...result } : { pushed, rotated, ...result };
  }

  /**
   * Wave 3 round 4, for a group log: the rotation a removal just pulled calls for (§8.4) is made before the outbox is
   * drained, so what waits is sealed under a key the removed device never holds. A leave this device follows is left to
   * `syncActive`'s own loop (it leaves, sealing nothing). A removal rotated here is `skipped` there: the epoch moved.
   */
  private async rotateBeforeDrain(bookId: string, result: PullResult, seen?: SeenLog): Promise<PullResult> {
    let out = result;
    for (const removal of result.removals) {
      if (removal.target === this.deviceId) continue;
      if (removal.leave && (await this.followsLeave(bookId, removal.target, removal.seq))) break;
      const outcome = await this.maybeRotate(bookId, removal.epoch);
      if (outcome !== 'skipped') out = merge(out, await this.pull(bookId, seen));
    }
    return out;
  }

  private pull(bookId: string, seen?: SeenLog): Promise<PullResult> {
    return pullAndApply(this.database, this.transport, this.sealer, bookId, this.now, seen, this.landing.has(bookId) ? { landOwn: true } : {});
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
    const subject = await this.inviteSubject(bookId);
    if (!subject) throw new SharingError('NOT_FOUND', 'That workspace is not here');
    // §6.5 step 4: the outbox is drained before any invite exists, so the creator's seed is always the log's first
    // entry — the one introduction that needs no invite (§8.2) — and every joiner finds the book already there. A full
    // sync, not a drain alone: the pull brings the authority view up to the log, which the owner check below reads.
    await this.syncOnce(bookId);
    // Invites are an owner's (§8.1, §8.3; task 7 fix round 1): the relay would answer 403, so refuse first, by the view.
    const owners = await this.database.transaction((tx) => viewOwnerDevices(tx, bookId));
    if (!owners.includes(this.deviceId)) throw new SharingError('NOT_OWNER', 'Only an owner can invite someone or link a device');
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
    const [named] = memberId === undefined ? [] : await this.database.db.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`);
    const preview: InvitePreview = {
      bookId,
      relayBookId: shared.relayBookId,
      bookName: subject.name,
      inviterName: input.inviterName,
      inviterMemberId: shared.memberId,
      ...(named ? { memberName: named[0] } : {}),
      // R10: an event's invite names no currency an older build could take, so it refuses it before claiming. The
      // event's own currency travels in `event`, which only a build that knows shared events reads.
      baseCurrency: subject.event ? 'XXX' : subject.currency,
      terms,
      ...(subject.event ? { event: subject.event } : {}),
    };
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

  /** What an invite is to: a workspace's book, or a shared event's (shared events §3), with its people sealed in. */
  private async inviteSubject(bookId: string): Promise<{ name: string; currency: string; event?: EventInviteDetails } | null> {
    const [book] = await this.database.db.values<[string, string]>(sql`SELECT name, base_currency FROM books WHERE id = ${bookId}`);
    if (book) return { name: book[0], currency: book[1] };
    const event = await eventInviteDetails(this.database, bookId);
    return event ? { name: event.name, currency: event.currency, event } : null;
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
    const copy = await this.copyHere(preview);
    const replaces = copy.kind === 'rejoin' && copy.moving ? { bookName: copy.bookName } : null;
    const otherCopies = await this.otherCopiesOf(preview);
    return { ...preview, inviteId, expiresAt: found.expiresAt, claimed: found.claimed, expired: Date.parse(found.expiresAt) <= this.now(), replaces, otherCopies };
  }

  /**
   * D-A7: the books here that are likely another copy of the invite's workspace, from the inviter. Reads only. A copy
   * has the workspace's own name and the inviter among its owners (or members, by member id): a separate workspace the
   * same person shares — Business beside Home — is never one (A8 re-review N-2).
   */
  private async otherCopiesOf(preview: InvitePreview): Promise<{ bookId: string; name: string; state: string; sharedAt: string | null; joined: boolean }[]> {
    const rows = await this.database.db.values<[string, string, string | null, string | null, string]>(sql`
      SELECT b.id, b.name, s.state, s.shared_at, b.kind FROM books b LEFT JOIN shared_books s ON s.book_id = b.id
      WHERE b.id <> ${preview.bookId} AND b.name = ${preview.bookName} AND EXISTS (
        SELECT 1 FROM book_members m WHERE m.book_id = b.id
          AND (m.member_id = ${preview.inviterMemberId ?? ''} OR (m.name = ${preview.inviterName} AND m.role = 'owner')))
      ORDER BY b.name, b.id`);
    return rows.map(([bookId, name, state, sharedAt, kind]) => ({ bookId, name, state: state ?? 'own', sharedAt, joined: kind === 'shared' }));
  }

  /**
   * What an invite would do to the copy of its book this device already holds, decided from local rows and the sealed
   * preview alone, so every refusal comes before the claim (§8.2, I4):
   *
   * - none here: a new book;
   * - active on the invite's own relay book: `ALREADY_SHARED`;
   * - any other copy with a `shared_books` row is a rejoin as its member (§8.6, §8.7). One that would move onto another
   *   relay book (recovery review, N1) must not be live — an `active` copy is refused (`STILL_SHARED`): stop sharing it
   *   here first — and the invite must come from a member who was an owner of the book in this copy's own rows
   *   (`INVITER_NOT_OWNER`); a rejoin of the same relay book (a restored phone, §8.7) is unchanged.
   * - a plain book under that id is a rejoin as the member this device remembers from a share of it that ended here
   *   (recovery review, N3: a copy kept as its own, §8.6) — always a move, so the owner check applies — and
   *   `ALREADY_SHARED` for one that was never shared here.
   */
  private async copyHere(preview: InvitePreview): Promise<CopyHere> {
    const bookId = preview.bookId;
    const [book] = await this.database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`);
    if (!book) return { kind: 'none' };
    const here = new SharingError('ALREADY_SHARED', 'This workspace is already here');
    let existing = await this.sharedRow(bookId);
    if (!existing) {
      const [remembered] = await this.database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${REMEMBERED_MEMBER_KEY(bookId)}`);
      if (!remembered) return { kind: 'refused', error: here };
      existing = { relayBookId: '', epoch: 0, memberId: remembered[0], state: 'own' };
    }
    if (existing.state === 'active' && existing.relayBookId === preview.relayBookId) return { kind: 'refused', error: here };
    const moving = existing.relayBookId !== preview.relayBookId;
    if (moving) {
      if (existing.state === 'active') {
        return {
          kind: 'refused',
          error: new SharingError(
            'STILL_SHARED',
            'This workspace is still shared on this device. To move it to this invite’s share, stop sharing it here first: leave it, stop sharing it if this device is its owner, or keep it as its own copy.',
          ),
        };
      }
      const [inviter] = preview.inviterMemberId
        ? await this.database.db.values<[string, string]>(sql`SELECT name, role FROM book_members WHERE book_id = ${bookId} AND member_id = ${preview.inviterMemberId}`)
        : [];
      if (inviter?.[1] !== 'owner') {
        return {
          kind: 'refused',
          error: new SharingError(
            'INVITER_NOT_OWNER',
            `${inviter?.[0] ?? preview.inviterName} was not an owner of this workspace here. Only a share made by one of its owners can take the place of this one.`,
          ),
        };
      }
    }
    return { kind: 'rejoin', memberId: existing.memberId, state: existing.state, moving, bookName: book[0] };
  }

  /**
   * §8.2 steps 1–8: preview, the currency check (nothing claimed on a mismatch), claim, every epoch key at rest, the
   * book and `shared_books`, the introduction (this device and, unless linking, this member), then a sync from 0.
   *
   * On a book already here (`copyHere`) this is the rejoin: `needs_invite` on the same relay book (§8.7), or a copy
   * that is not live — `needs_invite`, `unshared`, or kept as its own with a remembered member (N3) — moving onto a
   * share made again by one of its owners (§8.6; recovery review, N1). The existing book row and member are kept, the old keys and sync state go, the cursor goes
   * back to 0, and after the pull every local row in scope the log never mentioned is emitted as new. The invite must
   * name this device's member. Every refusal comes before the claim, and nothing is applied before it.
   */
  async joinBook(code: string, input: JoinInput): Promise<{ bookId: string; memberId: string; result: SyncOnceResult }> {
    const preview = await this.previewInvite(code);
    if (preview.claimed) throw new SharingError('INVITE_CLAIMED', 'Someone has already used this invite');
    if (preview.expired) throw new SharingError('INVITE_EXPIRED', 'This invite has expired');
    if (preview.baseCurrency !== input.ws.baseCurrency) {
      throw new SharingError(
        'CURRENCY',
        `This workspace keeps its money in ${preview.baseCurrency}; this app's own accounts are kept in ${input.ws.baseCurrency}. Sharing across currencies isn't supported yet.`,
      );
    }
    // Everything that can refuse locally is checked before the claim, which spends the invite (I4). A local failure
    // after it — the disk, say — needs a fresh invite from the owner (§8.2).
    const terms = preview.terms;
    if (!terms || terms.inviteId !== preview.inviteId) throw new SharingError('BAD_CODE', 'That invite is not complete');
    const copy = await this.copyHere(preview);
    if (copy.kind === 'refused') throw copy.error;
    const existing = copy.kind === 'rejoin' ? copy : undefined;
    const rejoin = existing !== undefined;
    if (rejoin && !(terms.sameMember && terms.memberId === existing.memberId)) {
      throw new SharingError('INVITE_MISMATCH', 'This invite is for someone else; ask for an invite that rejoins the same member');
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
    const storeKeys = async (tx: Tx) => {
      for (const k of keys) await this.sealer.storeEpochKeyTx(tx, bookId, k.epoch, base64UrlToBytes(k.key));
    };
    // The introduction (§8.2 step 7, §5.4): this device, unless linking or rejoining this member, and the signed terms
    // it joins on. Written as one change-set of its own, so the terms travel with the device op they vouch for.
    const introduce = async () => {
      await this.database.transaction(async (tx) => {
        const newMember = !terms.sameMember && !rejoin;
        if (newMember) {
          await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${memberId}, ${input.memberName}, 'member', ${now})`);
        }
        // The same device rejoining (an unshared copy, C1) already has its row: it is this device's again.
        await tx.run(sql`
          INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
          VALUES (${bookId}, ${this.deviceId}, ${memberId}, ${input.deviceName}, ${JSON.stringify(this.device.public.signJwk)}, ${JSON.stringify(this.device.public.agreeJwk)}, ${now}, NULL, ${this.appVersion ?? null})
          ON CONFLICT (book_id, device_id) DO UPDATE SET member_id = excluded.member_id, name = excluded.name, added_at = excluded.added_at, removed_at = NULL, app_version = excluded.app_version`);
        const book = { bookId, memberId, epoch };
        const ops = [
          ...(await rowUpsertsTx(tx, book, 'device')).filter((op) => op.id === this.deviceId),
          ...(newMember ? (await rowUpsertsTx(tx, book, 'member')).filter((op) => op.id === memberId) : []),
        ];
        await writeChangeSetsTx(tx, captureConfigOf(this.database), book, ops, { invite: terms });
      });
      await this.writeRecord(bookId, true); // before the sync, which may fail: the share is this device's from here
    };

    let result: SyncOnceResult;
    if (rejoin) {
      const reset: ResetSteps = {
        resetTx: async (tx) => {
          await tx.run(sql`DELETE FROM book_epoch_keys WHERE book_id = ${bookId}`);
          await tx.run(sql`DELETE FROM sync_outbox WHERE book_id = ${bookId}`); // what waited for the old relay book goes out again as unknown rows below
          // Every other device is pinned again by its introduction in the log this rejoin pulls (§5.4): a device row
          // from before — a device the new share never admitted, or one admitted afresh at another time — would keep its
          // fixed fields (C1 of the authority rules) and leave this copy different from its peers'.
          await tx.run(sql`DELETE FROM book_devices WHERE book_id = ${bookId} AND device_id <> ${this.deviceId}`);
          await tx.run(sql`DELETE FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = 'device'`);
          await tx.run(sql`DELETE FROM sync_tombstones WHERE book_id = ${bookId} AND entity = 'device'`);
          // A copy kept as its own has no row left (N3): it gets one, as its remembered member.
          await tx.run(sql`
            INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${claim.bookId}, ${epoch}, ${memberId}, 'active', ${now})
            ON CONFLICT (book_id) DO UPDATE SET relay_book_id = excluded.relay_book_id, epoch = excluded.epoch, state = 'active', synced_at = NULL, unshared_by = NULL, unshared_reason = NULL`);
        },
        afterResetTx: storeKeys,
        beforePull: introduce,
      };
      result = await this.alone(bookId, () => this.resetAndPull({ bookId, memberId, epoch }, reset));
    } else {
      await this.database.transaction(async (tx) => {
        await tx.run(sql`
          INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, archived_at, created_at)
          VALUES (${bookId}, ${input.ws.workspaceId}, ${preview.bookName}, 'shared', ${preview.baseCurrency}, 0,
                  (SELECT coalesce(max(sort_order), 0) + 1 FROM books WHERE workspace_id = ${input.ws.workspaceId}), NULL, ${now})`);
        await tx.run(
          sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${claim.bookId}, ${epoch}, ${memberId}, 'active', ${now})`,
        );
        await storeKeys(tx);
      });
      await introduce();
      result = await this.syncOnce(bookId);
    }
    await this.writeRecord(bookId, true);
    return { bookId, memberId, result };
  }

  /**
   * The reset a same-book rejoin (§8.7) and Place them now (sharing resilience §4.3) share, then the whole log pulled
   * again over the rows here. In one transaction: every skip of the book goes (a pull from 0 records each refusal again,
   * once), then `resetTx`'s own steps, the cursor back to 0, the authority view cleared to be rebuilt entry by entry,
   * and `catchUpTx` (D-A6: lineages for purchases here that have none, after every lineage points at its head), then
   * `afterResetTx`. `beforePull` runs between that transaction and the pull. After a pull that did not stop, every
   * member row goes to the view's (S4, task 9a) and what this device holds that the log does not say goes out, each
   * field at its own clock (§8.7, N2).
   *
   * `replayOwn` is for this device's own entries past `fromSeq` (D-B5); the pull takes it from Task B1 on.
   */
  private async resetAndPull(
    book: { bookId: string; memberId: string; epoch: number },
    steps: ResetSteps,
  ): Promise<SyncOnceResult> {
    const { bookId } = book;
    await this.database.transaction(async (tx) => {
      await tx.run(sql`DELETE FROM sync_skipped WHERE book_id = ${bookId}`); // replayed refusals are recorded once, not twice (final review, minor 5)
      await steps.resetTx?.(tx);
      await tx.run(sql`INSERT INTO sync_cursor (book_id, applied_seq) VALUES (${bookId}, 0) ON CONFLICT (book_id) DO UPDATE SET applied_seq = 0`);
      await clearAuthorityTx(tx, bookId); // rebuilt from the log, entry by entry, as the pull applies it again
      // What changed here while nothing was captured gets its clock before the pull, so the log's older values do
      // not overwrite it; a copy kept as its own gets back the clocks it kept (recovery review, N2).
      // D-A6: once every lineage points at its posted head, a purchase here with no lineage (a copy from before the
      // share) gets one, so the pull finds it and edits this row instead of posting the purchase again under another
      // id; the log's values win on it.
      await catchUpTx(tx, book, this.now(), { recordLineages: true });
      await steps.afterResetTx?.(tx);
    });
    await steps.beforePull?.();
    const seen = new SeenLog();
    this.landing.add(bookId);
    let result: SyncOnceResult;
    try {
      result = await this.syncOnceNow(bookId, seen);
    } finally {
      this.landing.delete(bookId);
    }
    if (!result.stopped) {
      // S4 (task 9a): an edit the backup made and drained before it was taken comes back under the old device's id,
      // no longer "own", so the pull refused it without putting the row back. Every member row goes to the view's.
      await this.database.transaction((tx) => withCapturePaused(tx, () => reconcileAllMembersTx(tx, bookId)));
      // §8.7, N2: what this device holds that the log does not say — rows it never names, fields and voids newer here
      // than there, rows deleted here — goes out, each field at its own clock.
      const emitted = await this.database.transaction((tx) => emitNewerTx(tx, captureConfigOf(this.database), book, seen));
      if (emitted > 0) result = { ...result, pushed: result.pushed + (await this.drainInto(bookId, undefined, [])) };
    }
    return result;
  }

  /**
   * Runs `run` as the only whole-log pull of the book: after any one already under way and every `syncOnce` or `drain` of
   * the book already running (`inFlight`), and with later ones waiting for it (`resetting`). Set before the first await,
   * so a sync asked for right after waits too. Inside, the run uses `syncOnceNow` and `drainInto`, never the waiting ones.
   */
  private alone<T>(bookId: string, run: () => Promise<T>): Promise<T> {
    const quiet = async () => {
      for (let calls = this.inFlight.get(bookId); calls && calls.size > 0; calls = this.inFlight.get(bookId)) await Promise.allSettled([...calls]);
    };
    const next = (this.resetting.get(bookId) ?? Promise.resolve()).then(quiet).then(run);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.resetting.set(bookId, settled);
    void settled.then(() => {
      if (this.resetting.get(bookId) === settled) this.resetting.delete(bookId);
    });
    return next;
  }

  /**
   * Place them now (sharing resilience §4.3): rows the share sent while another copy on this phone held them (D-A3,
   * `HELD_ELSEWHERE` skips) come in once that copy is gone. The book must be shared and active here (`NOT_FOUND`), and
   * no holder may still exist (`HELD_ELSEWHERE`, naming it). A holder whose book is gone from here is dead: a lineage
   * row it left behind (a copy deleted by an older build, which kept them) goes first, so the purchase posts as new.
   * Then the reset a rejoin does, without a claim, and the whole log again: applying it over rows already applied
   * changes nothing (equal clocks never win), so a second run places nothing. `placed` counts the held rows that came
   * in; `stillHeld` those set aside again (a holder that turned up meanwhile).
   */
  placeHeldRows(bookId: string): Promise<{ placed: number; stillHeld: number; result: SyncOnceResult }> {
    return this.alone(bookId, () => this.placeHeldRowsNow(bookId));
  }

  private async placeHeldRowsNow(bookId: string): Promise<{ placed: number; stillHeld: number; result: SyncOnceResult }> {
    const shared = await this.requireActive(bookId);
    // A workspace's share only: a net-worth group log's sync removes devices and syncs itself again inside, which a
    // whole-log pull holding the book would wait on for ever.
    if ((await groupLogWorkspaceOf(this.database.db, bookId)) !== null) throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
    const held = await heldElsewhereOf(this.database, bookId);
    const live = held.find((row) => row.holderExists);
    if (live) {
      const holder = live.holderName ?? 'another copy on this phone';
      throw new SharingError('HELD_ELSEWHERE', `Part of this share is held by ${holder} on this phone. Delete that copy to bring it in.`);
    }
    const book = { bookId, memberId: shared.memberId, epoch: shared.epoch };
    const result = await this.resetAndPull(book, {
      resetTx: async (tx) => {
        for (const row of held) {
          if (row.entity !== 'purchase') continue; // only a purchase is held by its lineage
          // A lineage another book here still files is that book's (D-A5); only one of a book gone from here goes.
          const gone = await tx.values(sql`
            SELECT 1 FROM sync_lineage WHERE lineage_id = ${row.id} AND book_id = ${row.holderBookId}
              AND book_id NOT IN (SELECT id FROM books) AND book_id NOT IN (SELECT book_id FROM shared_books)`);
          if (gone.length === 0) continue;
          await tx.run(sql`DELETE FROM sync_lineage WHERE lineage_id = ${row.id}`);
          await tx.run(sql`DELETE FROM sync_lineage_last WHERE lineage_id = ${row.id}`);
        }
        // A purchase a partner sent on a category set aside here, applied once its holder had gone and before this
        // run, fell back to the book's Uncategorised (the category was not here yet). Its money clock goes, so the
        // log's money wins again now that the category comes in. Only another device's: a pull never applies this
        // device's own entries again, and what this device wrote is its own to keep.
        const fallback = [await uncategorisedIdOf(bookId, 'expense'), await uncategorisedIdOf(bookId, 'income')];
        const fell = await tx.values<[string, string]>(sql`
          SELECT DISTINCT c.id, c.hlc FROM sync_lineage l
          JOIN entries e ON e.transaction_id = l.head_transaction_id AND e.account_id IN ${fallback}
          JOIN sync_field_clocks c ON c.book_id = l.book_id AND c.entity = 'purchase' AND c.id = l.lineage_id AND c.field = 'money'
          WHERE l.book_id = ${bookId}`);
        for (const [lineageId, hlc] of fell) {
          if (decodeHlc(hlc).deviceId === this.deviceId) continue;
          await tx.run(sql`DELETE FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = 'purchase' AND id = ${lineageId} AND field = 'money'`);
        }
      },
    });
    const after = new Set((await heldElsewhereOf(this.database, bookId)).map((row) => `${row.entity}:${row.id}`));
    const placed = held.filter((row) => !after.has(`${row.entity}:${row.id}`)).length;
    // What the delete wrote down for this share has done its work once nothing is held any more.
    if (after.size === 0) await this.database.db.run(sql`DELETE FROM settings WHERE key = ${ARRIVING_KEY(bookId)}`);
    await this.writeRecord(bookId);
    return { placed, stillHeld: after.size, result };
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
    if (target === this.deviceId) {
      // Fix round 2: the last owner device never takes itself out; that would freeze the book (§8.5).
      const owners = await this.database.transaction((tx) => viewOwnerDevices(tx, bookId));
      if (owners.includes(this.deviceId) && owners.length === 1) {
        throw new LastOwnerError("This is the workspace's last owner device: make someone else an owner before removing it");
      }
    }
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
    const groupLog = (await groupLogWorkspaceOf(this.database.db, bookId)) !== null;
    await this.database.transaction(async (tx) => {
      await this.sealer.storeEpochKeyTx(tx, bookId, next, key);
      await tx.run(sql`UPDATE shared_books SET epoch = max(epoch, ${next}) WHERE book_id = ${bookId}`);
      // Joint net worth, final review item 5: the invites this device made into a group log before now carry no key for
      // the new epoch; a device not yet in is invited again, with the current keys.
      if (groupLog) await dropInviteMarksTx(tx, bookId);
    });
    await this.writeRecord(bookId);
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
    await this.syncSoon(bookId); // its sync writes the record when the view changed this device's role
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
        throw new LastOwnerError("This is the last owner in this workspace: make someone else an owner before leaving");
      }
      // An owner steps down before leaving, so nobody is sent to ask a departed owner (§8.7) and the view keeps no
      // owner without a device. It must reach the log before the removal: after it, this device's entries count for nothing.
      await this.database.transaction((tx) =>
        withCapture(tx, { entity: 'member', id: shared.memberId, bookId }, async () => {
          await tx.run(sql`UPDATE book_members SET role = 'member' WHERE book_id = ${bookId} AND member_id = ${shared.memberId}`);
        }),
      );
      if ((await this.syncOnce(bookId)).ended) return;
      // Fix round 2: another owner may have stepped down at the same moment, and the log took theirs first, refusing
      // this one (the last owner is never demoted). Leave only as the log has it: a member now, past an owner with a device.
      const stillOk = await this.database.transaction(
        async (tx) => (await viewMember(tx, bookId, shared.memberId))?.role === 'member' && (await viewOtherActiveOwners(tx, bookId, shared.memberId)) > 0,
      );
      if (!stillOk) throw new LastOwnerError("This is the last owner in this workspace: make someone else an owner before leaving");
      try {
        await this.leaveNow(bookId, true);
      } catch (error) {
        throw new LeaveIncompleteError(error);
      }
      return;
    }
    await this.leaveNow(bookId, true);
  }

  /**
   * The leave itself: the signed removal of this device, the relay drops it, and the book here ends. `leave` marks it
   * as the member leaving, which the member's other devices follow (§8.4); a device following one writes a plain
   * removal of itself (fix round 2), so a device of the member re-invited since is never taken along.
   */
  private async leaveNow(bookId: string, leave: boolean): Promise<void> {
    const shared = (await this.sharedRow(bookId))!;
    const hlc = await this.database.transaction((tx) => localTick(tx, this.deviceId, this.now()));
    const removal = { kind: 'removal' as const, deviceId: this.deviceId, epoch: shared.epoch, hlc, target: this.deviceId };
    const entry = await this.sealer.sign(bookId, leave ? { ...removal, leave: true as const } : removal);
    await this.transport.append(shared.relayBookId, entry);
    await this.transport.removeDevice(shared.relayBookId, this.deviceId);
    await this.endShared(bookId, shared.memberId, 'left');
    // Where a deleted copy's own purchases were paid from, kept for this share's Place them now: left, it has no use.
    await this.database.db.run(sql`DELETE FROM settings WHERE key = ${ARRIVING_KEY(bookId)}`);
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
    await this.database.transaction((tx) => this.dropSyncStateTx(tx, bookId, shared.memberId));
    await this.removeRecord(bookId, shared.relayBookId);
    await this.exitGroupQuietly(bookId, false); // §6: nobody is in a workspace no longer shared, nor in its group
  }

  /**
   * Keep the book as this device's own (final review, C1): the way out of a share that is dead here. Allowed for a
   * book in `needs_invite` (a restored phone nobody can invite back — the only owner's, say), `unshared` (its owner
   * stopped it, this member left, or this device was removed), or `active` and frozen (`isFrozen`, §8.5: devices in
   * the view, no owner device among them). Refused (`STILL_SHARED`) while an owner device is in: leave, or ask an owner to stop sharing.
   * Locally it is what `stopSharing` does: `shared_books` and every piece of sync state go; every row stays, and so
   * do `book_members`, `book_member_accounts` and `sync_lineage`. The relay is not told; the book can be shared again.
   */
  async forgetSharing(bookId: string, options: { deleting?: boolean } = {}): Promise<void> {
    const shared = await this.sharedRow(bookId);
    if (!shared) throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
    // Active is allowed only when frozen, by the same test the status line uses (recovery review, minor): a view with
    // no device in yet — a share made here and not synced back — is live, not dead.
    // Or when every owner has been silent for two weeks while this phone synced in the last hour (sharing resilience D-A11).
    // Or for Delete here only (sharing resilience §5.1): Leave could not reach the relay, and the caller erases the book
    // at once, so nothing is left here to edit outside the share.
    if (!options.deleting && shared.state === 'active' && !(await this.isFrozen(bookId)) && !(await ownersGone(this.database, bookId, this.deviceId, this.now())).gone) {
      throw new SharingError('STILL_SHARED', 'This workspace is still shared and has an owner: leave it, or ask an owner to stop sharing');
    }
    this.sealer.forget();
    await this.database.transaction((tx) => this.dropSyncStateTx(tx, bookId, shared.memberId));
    await this.removeRecord(bookId, shared.relayBookId);
    await this.exitGroupQuietly(bookId, false);
  }

  /**
   * Shared goals C15: the book's shared goals end here as an off, in the transaction that ends the share and once the
   * book is no longer active, so nothing of it is a write to a shared book — the sharer keeps each goal, everyone else a
   * private copy. Nothing is sent. A book in no workspace (an event's, a group log) has none.
   */
  private async endSharedGoalsHereTx(tx: Tx, bookId: string, memberId?: string): Promise<void> {
    const [row] = await tx.values<[string, string]>(sql`SELECT b.workspace_id, w.base_currency FROM books b JOIN workspaces w ON w.id = b.workspace_id WHERE b.id = ${bookId}`);
    if (row) await endSharedGoalsTx(tx, { workspaceId: row[0], baseCurrency: row[1] }, bookId, memberId);
  }

  /**
   * §6 (task 4 review round 1): out of the workspace here is out of its net-worth group log. Best effort on the relay
   * (`exitGroupOf` forgets the group locally either way); a no-op for a book with no group log here, a group log itself
   * included.
   */
  private async exitGroupQuietly(bookId: string, leave: boolean): Promise<void> {
    try {
      await exitGroupOf(this.groupHost(), bookId, leave);
    } catch (error) {
      if (!(error instanceof SyncTransportError)) throw error;
    }
  }

  /**
   * §8.6: the book becomes an ordinary local book again. `shared_books` first: from here on the book is not shared,
   * and nothing below is a change to a shared row. This device's member is remembered, so sharing the book again is
   * as the same person (C1).
   */
  private async dropSyncStateTx(tx: Tx, bookId: string, memberId: string): Promise<void> {
    // The field clocks go, but not before they are kept with their values (unless already kept when it went
    // needs_invite): sharing it again or rejoining sends each field at its own clock (recovery review, N2).
    await keepClocksTx(tx, bookId);
    await tx.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
    // C15, before the clocks go: what was kept of the shared goals goes with them, so sharing again sends no delete.
    await this.endSharedGoalsHereTx(tx, bookId, memberId);
    for (const table of ['sync_outbox', 'sync_cursor', 'book_epoch_keys', 'sync_field_clocks', 'sync_tombstones', 'sync_skipped', 'book_devices']) {
      await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
    }
    await clearAuthorityTx(tx, bookId);
    await tx.run(sql`INSERT INTO settings (key, value) VALUES (${REMEMBERED_MEMBER_KEY(bookId)}, ${memberId}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
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
    const [row] = await this.database.db.values<[string, string, string | null, string | null, EndedReason | null]>(
      sql`SELECT state, member_id, synced_at, unshared_by, unshared_reason FROM shared_books WHERE book_id = ${bookId}`,
    );
    if (!row) return null;
    const [state, memberId, syncedAt, unsharedBy, reason] = row;
    const nameOf = async (id: string | null) =>
      id === null ? null : ((await this.database.db.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${id}`))[0]?.[0] ?? null);
    if (state === 'unshared') {
      const byYou = unsharedBy === memberId;
      return { state: 'unshared', byMemberId: unsharedBy, byName: await nameOf(unsharedBy), byYou, reason: reason ?? (byYou ? 'left' : 'stopped') };
    }
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
   * The relay's word that this device is out of the book, on any call: a `410` — its owner stopped sharing (§8.6), and
   * the book goes `unshared` naming the member whose device deleted it (the relay says which device; this device's
   * pinned list says whose) — or a `403 removed` — an owner removed this device (§8.4, final review I2). Which it was,
   * or `false` for any other error.
   */
  private async endIfGone(bookId: string, error: unknown): Promise<'stopped' | 'removed' | false> {
    const stopped = error instanceof SyncTransportError && error.status === 410;
    if (!stopped && !removedFromBook(error)) return false;
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.state !== 'active') return false;
    if (!stopped) {
      await this.endShared(bookId, null, 'removed');
      return 'removed';
    }
    const deletedBy = (error as SyncTransportError).deletedBy;
    const [by] = deletedBy ? await this.database.db.values<[string]>(sql`SELECT member_id FROM book_devices WHERE book_id = ${bookId} AND device_id = ${deletedBy}`) : [];
    await this.endShared(bookId, by?.[0] ?? null, 'stopped');
    return 'stopped';
  }

  /** The sharing ended here: read-only from now on (capture refuses every write), with who ended it and how. */
  private async endShared(bookId: string, by: string | null, reason: EndedReason): Promise<void> {
    const ending = await this.sharedRow(bookId);
    await this.database.transaction(async (tx) => {
      await tx.run(sql`UPDATE shared_books SET state = 'unshared', unshared_by = ${by}, unshared_reason = ${reason} WHERE book_id = ${bookId}`);
      await this.endSharedGoalsHereTx(tx, bookId);
      await tx.run(sql`DELETE FROM sync_outbox WHERE book_id = ${bookId}`); // nowhere to go now
    });
    // Sharing resilience §6.1: the share ended knowingly here (a leave, a 410, a 403 removed), so nothing reconnects it.
    if (ending) await this.removeRecord(bookId, ending.relayBookId);
    // §6: a device out of the workspace is out of its group log (a leave, a removal, the sharing stopped).
    await this.exitGroupQuietly(bookId, reason === 'left');
  }

  /* ------------------------------------------------------ net-worth group log */

  /** What the group log (net-worth/group-log.ts) borrows from this engine. */
  private groupHost(): GroupLogHost {
    return {
      database: this.database,
      transport: this.transport,
      device: this.device,
      sealer: this.sealer,
      now: this.now,
      ...(this.appVersion === undefined ? {} : { appVersion: this.appVersion }),
      syncOnce: (bookId) => this.syncOnce(bookId),
      removeDevice: (bookId, target) => this.removeDevice(bookId, target),
      leaveNow: (bookId, leave) => this.leaveNow(bookId, leave),
    };
  }

  /** Makes the workspace's net-worth group log, or returns the one this device is in (joint-net-worth §4). */
  openGroupLog(workspaceBookId: string): Promise<string> {
    return openGroupLog(this.groupHost(), workspaceBookId);
  }

  /** The workspace's group log this device reads and writes, or null (none, or one this device is not in). */
  groupLogOf(workspaceBookId: string): Promise<string | null> {
    return groupLogOf(this.groupHost(), workspaceBookId);
  }

  /** Invites these members' pinned devices into the group log; they join on their next workspace sync. */
  admitToGroupLog(workspaceBookId: string, memberIds: readonly string[]): Promise<void> {
    return admitToGroupLog(this.groupHost(), workspaceBookId, memberIds);
  }

  /** This member leaves the group log: its devices removed with rotation, the group's rows forgotten here. */
  leaveGroupLog(workspaceBookId: string): Promise<void> {
    return leaveGroupLog(this.groupHost(), workspaceBookId);
  }

  /** Takes a member who left out of the group log, with rotation: by any other group member. */
  removeFromGroupLog(workspaceBookId: string, memberId: string): Promise<void> {
    return removeFromGroupLog(this.groupHost(), workspaceBookId, memberId);
  }

  /** Whether every device of these members runs an app new enough for joint net worth (§9). */
  groupMembersReady(workspaceBookId: string, memberIds: readonly string[]): Promise<{ ready: boolean; outdated: { memberId: string; deviceName: string }[] }> {
    return groupMembersReady(this.groupHost(), workspaceBookId, memberIds);
  }

  /** Proposes how the household files and who is in the group (§6); returns the proposal's id. */
  proposeNetWorth(workspaceBookId: string, input: { mode: FilingMode; members: string[] }): Promise<string> {
    return proposeNetWorth(this.groupHost(), workspaceBookId, input);
  }

  /** Confirms or declines a proposal this member is asked on; a decline of an active one is refused. */
  answerNetWorth(workspaceBookId: string, proposalId: string, answer: 'confirm' | 'decline'): Promise<void> {
    return answerNetWorth(this.groupHost(), workspaceBookId, proposalId, answer);
  }

  /** The proposer withdraws a proposal not yet active. */
  cancelNetWorth(workspaceBookId: string, proposalId: string): Promise<void> {
    return cancelNetWorth(this.groupHost(), workspaceBookId, proposalId);
  }

  /** Stop sharing my net worth: `left`, then out of the group log, or the group dissolves. */
  leaveNetWorth(workspaceBookId: string): Promise<void> {
    return leaveNetWorth(this.groupHost(), workspaceBookId);
  }

  /** The workspace's net-worth group as this device derives it. */
  netWorthGroup(workspaceBookId: string): Promise<NetWorthGroupView> {
    return netWorthGroup(this.groupHost(), workspaceBookId);
  }

  /** Records a transfer between this member and a partner (§7.2), posting this device's side; returns its id. */
  recordMemberTransfer(workspaceBookId: string, t: MemberTransferInput): Promise<string> {
    return recordTransfer(this.database, workspaceBookId, t);
  }

  /** Either party changes a transfer's date, amount or note; both sides follow. */
  editMemberTransfer(workspaceBookId: string, transferId: string, patch: MemberTransferPatch): Promise<void> {
    return editTransfer(this.database, workspaceBookId, transferId, patch);
  }

  /** Either party deletes a transfer: both sides voided, for ever. */
  voidMemberTransfer(workspaceBookId: string, transferId: string): Promise<void> {
    return voidTransfer(this.database, workspaceBookId, transferId);
  }

  /* ------------------------------------------------------------- shared events */

  /** What a shared event's relay book (sync/events/event-log.ts) borrows from this engine. */
  private eventHost(): EventLogHost {
    return {
      database: this.database,
      transport: this.transport,
      device: this.device,
      sealer: this.sealer,
      now: this.now,
      ...(this.appVersion === undefined ? {} : { appVersion: this.appVersion }),
      syncOnce: (bookId) => this.syncOnce(bookId),
      previewInvite: (code) => this.previewInvite(code),
      leave: (bookId) => this.leave(bookId),
      removeDevice: (bookId, target) => this.removeDevice(bookId, target),
    };
  }

  /** Shares a local event as its own relay book (shared events §3). */
  shareEvent(ws: WorkspaceContext, input: ShareEventInput): Promise<{ bookId: string; personId: string }> {
    return shareEventLog(this.eventHost(), ws, input);
  }

  /**
   * An invite to an event, by any member (every member owns its book). `forPersonId` makes it an invite for that
   * person's new phone (§7 Lost phone): a person with the app, whose new phone joins as them.
   *
   * The relay takes an invite only from a device it knows as an owner, and it learns a new member's device from a
   * phone already an owner there once that phone has synced (`followOwners`): a member who joined a moment ago is told
   * so in words rather than with the relay's 403.
   */
  async createEventInvite(bookId: string, input: { inviterName: string; forPersonId?: string }): Promise<CreatedInvite> {
    if (!(await isEventBook(this.database, bookId))) throw new SharingError('NOT_FOUND', 'That event is not shared on this device');
    if (input.forPersonId !== undefined && !(await isEventMember(this.database, bookId, input.forPersonId))) {
      throw new SharingError('NOT_FOUND', 'That person has no phone in this event yet: send an ordinary invite, and they pick their name');
    }
    // C2: a new phone for someone else is linked only once their old phone is removed; every phone's log refuses it
    // otherwise (`introductionRefusal`), so the invite is refused here first, in words.
    const forPersonId = input.forPersonId;
    if (forPersonId !== undefined && !(await this.database.transaction((tx) => mayLinkAsMemberTx(tx, bookId, forPersonId, [this.deviceId])))) {
      const [named] = await this.database.db.values<[string]>(sql`SELECT name FROM event_people WHERE book_id = ${bookId} AND id = ${forPersonId}`);
      const who = named?.[0] ?? 'This person';
      throw new SharingError('STILL_HAS_PHONE', `${who} still has a phone in this event. Remove ${who}’s old phone first, or ${who} invites the new one.`);
    }
    try {
      return await this.createInvite(bookId, { inviterName: input.inviterName, ...(input.forPersonId ? { sameMember: true, memberId: input.forPersonId } : {}) });
    } catch (error) {
      if (!(error instanceof SyncTransportError && error.status === 403)) throw error;
      const [row] = await this.database.db.values<[string]>(sql`SELECT name FROM shared_events WHERE book_id = ${bookId}`);
      throw new SharingError('NOT_OWNER', `This phone can invite people to ${row?.[0] ?? 'this event'} once a phone already in it has synced. Try again in a minute.`);
    }
  }

  /** Joins an event on its invite, as a name in it ("I'm Budi") or a new one (shared events §6). */
  joinEvent(code: string, input: JoinEventInput): Promise<{ bookId: string; eventId: string; personId: string; result: SyncOnceResult }> {
    return joinEventLog(this.eventHost(), code, input);
  }

  /** Leaves an event at zero balance (D9); its records and this phone's own lines from it stay. */
  leaveEvent(bookId: string): Promise<void> {
    return leaveEventLog(this.eventHost(), bookId);
  }

  /** Removes a person from an event at zero balance and in no record (D9): a name, or a person with the app and their phones. */
  removeEventMember(ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
    return removeEventMemberLog(this.eventHost(), ws, eventId, personId);
  }

  /** Lost phone: removes a person's phones from an event, keeping the person, so a new phone can join as them. */
  removeEventMemberPhones(ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
    return removeEventMemberPhonesLog(this.eventHost(), ws, eventId, personId);
  }

  /* --------------------------------------------------------- share records */

  /**
   * Review N2: Share is refused while this phone holds its own record of an earlier share of the book, or the check
   * found the book `lost`: a new share would replace the record that can bring the old one back (and the partner
   * still on it). `discardShareRecord`, after the screen asks, lets it through. Before any relay book is made.
   */
  private async refuseOverLostShare(bookId: string): Promise<void> {
    let held = this.lostHere.has(bookId);
    if (!held && this.records) {
      try {
        const found = await this.records.get(bookId);
        held = found !== null && found.deviceId === this.deviceId;
      } catch (error) {
        this.recordProblem(bookId, error);
      }
    }
    if (held) {
      throw new SharingError('RECORD_ELSEWHERE', 'This workspace was shared before on this phone. Bring that share back, or discard it, before sharing again.');
    }
  }

  /**
   * Discards this device's record of an earlier share of the book, and its replay point, after the screen asked
   * (review N2): that share can no longer be brought back here, and Share goes through. A record of another device
   * stays. Whether a record was removed.
   */
  async discardShareRecord(bookId: string): Promise<boolean> {
    this.lostHere.delete(bookId);
    this.recordWritten.delete(bookId);
    this.recordDirty.delete(bookId);
    await this.clearReplayPoint(bookId);
    if (!this.records) return false;
    try {
      const found = await this.records.get(bookId);
      if (!found || found.deviceId !== this.deviceId) return false;
      await this.records.remove(bookId);
      return true;
    } catch (error) {
      this.recordProblem(bookId, error);
      return false;
    }
  }

  /**
   * Every active book here with no share record gets one (§6.1 backfill): shares made on an older build are covered
   * from now on. A book whose keys do not open here (a restored copy, §8.7) and a book in no workspace (an event's, a
   * group log) get none. Returns how many were written. Writes nothing until `checkShareRecords` has run on this
   * engine (review N1): call it after the check.
   */
  async backfillShareRecords(): Promise<number> {
    this.followDatabase();
    if (!this.records || !this.recordsChecked) return 0;
    let have: Set<string>;
    try {
      have = new Set((await this.records.list()).map((r) => r.bookId));
    } catch (error) {
      this.recordProblem(null, error);
      return 0;
    }
    const rows = await this.database.db.values<[string]>(sql`SELECT book_id FROM shared_books WHERE state = 'active' ORDER BY book_id`);
    let written = 0;
    for (const [bookId] of rows) if (!have.has(bookId) && (await this.writeRecord(bookId))) written += 1;
    return written;
  }

  /**
   * §6.2 at open, from local rows only: what each of this device's share records says next to this database
   * (`ShareRecordFinding`). A record of another device id is skipped. Detection never writes or removes a record
   * (review C1, C2): the database may be older than the record, so the record is the truth and Drop B's probe of the
   * relay decides. Anything but this book active on the record's own relay book is `lost` — no row, `needs_invite`,
   * `unshared` (a leave or removal later rejoined on the same relay book, then an older copy restored), or another
   * relay book. A `behind` is kept as the book's replay point (`replayPointOf`) and reported from it on every later
   * open, whatever syncs in between, until `clearReplayPoint`. One record that cannot be checked (a failing read) is
   * warned about and skipped; this never throws.
   */
  async checkShareRecords(): Promise<ShareRecordFinding[]> {
    this.followDatabase();
    if (!this.records) return [];
    let records: ShareRecord[];
    try {
      records = await this.records.list();
    } catch (error) {
      this.recordProblem(null, error);
      return []; // nothing read: record writes stay held until a check reads them
    }
    const findings: ShareRecordFinding[] = [];
    for (const record of records) {
      if (record.deviceId !== this.deviceId) continue;
      try {
        const finding = await this.findingOf(record);
        if (finding.kind === 'lost') this.lostHere.add(record.bookId);
        else this.lostHere.delete(record.bookId);
        findings.push(finding);
      } catch (error) {
        this.recordProblem(record.bookId, error);
      }
    }
    this.recordsChecked = true;
    return findings;
  }

  private async findingOf(record: ShareRecord): Promise<ShareRecordFinding> {
    const { bookId, bookName, relayBookId } = record;
    const [book] = await this.database.db.values(sql`SELECT 1 FROM books WHERE id = ${bookId}`);
    if (!book) return { kind: 'missing_book', bookId, bookName, relayBookId };
    const shared = await this.sharedRow(bookId);
    if (!shared || shared.relayBookId !== relayBookId || shared.state !== 'active') return { kind: 'lost', bookId, bookName, relayBookId };
    const cursor = await this.cursorOf(bookId);
    const kept = await this.replayPointOf(bookId);
    const point = kept?.relayBookId === relayBookId ? kept : null;
    if (!point && cursor >= record.appliedSeq) return { kind: 'ok', bookId };
    const fromSeq = point ? Math.min(point.fromSeq, cursor) : cursor;
    const toSeq = point ? Math.max(point.toSeq, record.appliedSeq) : record.appliedSeq;
    if (!point || point.fromSeq !== fromSeq || point.toSeq !== toSeq) {
      const value = JSON.stringify({ relayBookId, fromSeq, toSeq });
      await this.database.db.run(sql`INSERT INTO settings (key, value) VALUES (${REPLAY_POINT_KEY(bookId)}, ${value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    }
    return { kind: 'behind', bookId, bookName, fromSeq, toSeq };
  }

  /**
   * The replay point a `behind` finding left for the book (review I1): own entries of `relayBookId` after `fromSeq`, up
   * to `toSeq`, are missing here. Kept in `settings` (`REPLAY_POINT_KEY`) so an ordinary sync — which skips own entries
   * and moves the cursor past them — and the record's own cursor writes cannot erase it. Null when none is kept.
   */
  async replayPointOf(bookId: string): Promise<{ relayBookId: string; fromSeq: number; toSeq: number } | null> {
    const [row] = await this.database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${REPLAY_POINT_KEY(bookId)}`);
    if (!row) return null;
    try {
      const v = JSON.parse(row[0]) as { relayBookId?: unknown; fromSeq?: unknown; toSeq?: unknown };
      if (typeof v.relayBookId !== 'string' || typeof v.fromSeq !== 'number' || typeof v.toSeq !== 'number') return null;
      return { relayBookId: v.relayBookId, fromSeq: v.fromSeq, toSeq: v.toSeq };
    } catch {
      return null;
    }
  }

  /**
   * Forgets the book's replay point: called by the replay of a `behind` copy (Drop B, `replayBehind`) once the own
   * entries up to its `toSeq` are applied here. Until then every open reports the book `behind`.
   */
  async clearReplayPoint(bookId: string): Promise<void> {
    await this.database.db.run(sql`DELETE FROM settings WHERE key = ${REPLAY_POINT_KEY(bookId)}`);
  }

  /** Writes the book's share record now, cursor included (§6.1: on app hide). Never onto a record of another relay book. */
  async flushShareRecord(bookId: string): Promise<void> {
    this.followDatabase();
    await this.writeRecord(bookId);
  }

  /**
   * The database's rows were replaced under this engine — a restore of a backup or an iCloud copy (spec §6.7; review
   * R1): what it knew of them is dropped. The records are not written again (but by `shareBook`, `joinBook`) until
   * `checkShareRecords` has read them against the new rows, and the next `syncOnce` runs that check first; the books
   * found `lost`, the written and waiting record state and the opened epoch keys go. Called by the engine itself
   * whenever `importBytes` replaced its database; the app calls it for any other way the rows are swapped.
   */
  databaseReplaced(): void {
    this.seenReplacements = replacementsOf(this.database);
    this.recordsChecked = false;
    this.lostHere.clear();
    this.recordWritten.clear();
    this.recordDirty.clear();
    this.sealer.forget();
  }

  /** `databaseReplaced`, when `importBytes` replaced the rows since this engine last looked. */
  private followDatabase(): void {
    if (replacementsOf(this.database) !== this.seenReplacements) this.databaseReplaced();
  }

  /**
   * Removes the book's share record after a Delete here (§6.1, §5; review I2), for the screen that deleted it. Only
   * this device's record of `relayBookId` goes — by default the relay book `shared_books` names, so after the book's
   * rows are gone the caller passes the one it read before the delete. Whether a record was removed. Never throws.
   */
  async dropShareRecord(bookId: string, relayBookId?: string): Promise<boolean> {
    const relay = relayBookId ?? (await this.sharedRow(bookId))?.relayBookId;
    return relay === undefined ? false : this.removeRecord(bookId, relay);
  }

  /**
   * The share record of a book as this database has it (§6.1), or null: the book is not active here, is in no
   * workspace (no `books` row: an event's, a group log), or its keys are not this device's (`checkBook`'s test). The
   * epoch keys are `book_epoch_keys.key_sealed` byte for byte; the role is the view's, else this member's row.
   */
  private recordOf(bookId: string): Promise<ShareRecord | null> {
    return this.database.transaction(async (tx) => {
      const [shared] = await tx.values<[string, number, string, string]>(sql`SELECT relay_book_id, epoch, member_id, state FROM shared_books WHERE book_id = ${bookId}`);
      if (!shared || shared[3] !== 'active') return null;
      const [relayBookId, epoch, memberId] = [shared[0], Number(shared[1]), shared[2]];
      const [book] = await tx.values<[string, string, string, string]>(sql`SELECT name, kind, workspace_id, base_currency FROM books WHERE id = ${bookId}`);
      if (!book) return null;
      const [mine] = await tx.values(sql`SELECT 1 FROM book_devices WHERE book_id = ${bookId} AND device_id = ${this.deviceId} AND removed_at IS NULL`);
      if (!mine || !(await this.sealer.epochKey(bookId, epoch, tx))) return null;
      const keys = await tx.values<[number, string]>(sql`SELECT epoch, key_sealed FROM book_epoch_keys WHERE book_id = ${bookId} ORDER BY epoch`);
      const [cursor] = await tx.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`);
      let role = await viewRoleOfDevice(tx, bookId, this.deviceId);
      if (role === null) {
        const [row] = await tx.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`);
        role = row?.[0] ?? null;
      }
      return {
        v: 1,
        bookId,
        relayBookId,
        memberId,
        deviceId: this.deviceId,
        role: role === 'owner' ? 'owner' : 'member',
        bookName: book[0],
        bookKind: book[1],
        workspaceId: book[2],
        baseCurrency: book[3],
        epochKeys: keys.map(([e, sealed]) => ({ epoch: Number(e), sealed })),
        appliedSeq: Number(cursor?.[0] ?? 0),
        updatedAt: new Date(this.now()).toISOString(),
      };
    });
  }

  /**
   * Writes the book's record now; whether one was written. Never throws: a store failure is warned and reported.
   * Only `replace` (`shareBook`, `joinBook`: this device's own act starts the share) writes over a record of another
   * relay book; every other write leaves one alone (review C1): the database may be an older copy than the record.
   * Before `checkShareRecords` has run on this engine only `replace` writes (review N1).
   */
  private async writeRecord(bookId: string, replace = false): Promise<boolean> {
    if (!this.records) return false;
    try {
      const record = await this.recordOf(bookId);
      if (!record) {
        this.recordDirty.delete(bookId);
        return false;
      }
      return await this.putRecord(record, replace);
    } catch (error) {
      this.recordProblem(bookId, error);
      return false;
    }
  }

  private async putRecord(record: ShareRecord, replace: boolean): Promise<boolean> {
    this.followDatabase(); // a sync under way when the rows were replaced writes nothing after it
    if (!replace && !this.recordsChecked) return false;
    try {
      if (!replace) {
        const stored = await this.records!.get(record.bookId);
        if (stored && stored.relayBookId !== record.relayBookId) {
          this.recordDirty.delete(record.bookId);
          return false;
        }
      }
      await this.records!.put(record);
    } catch (error) {
      this.recordProblem(record.bookId, error); // the book stays dirty, if it was: the next sync tries again
      return false;
    }
    this.recordWritten.set(record.bookId, { at: this.now(), record });
    this.recordDirty.delete(record.bookId);
    return true;
  }

  /**
   * After a sync (§6.1): a new epoch key, a role, a name — anything but the cursor — is written at once, and so is a
   * sync that sent this device's own entries (`pushed`, review M3: they are what a replay needs); the cursor alone
   * once `recordEveryMs` has passed since this engine last wrote the record. The first sync after start writes.
   */
  private async recordAfterSync(bookId: string, pushed: number): Promise<void> {
    this.followDatabase();
    if (!this.records || !this.recordsChecked) return;
    const last = this.recordWritten.get(bookId);
    if (!last || this.recordDirty.has(bookId)) {
      await this.writeRecord(bookId);
      return;
    }
    let record: ShareRecord | null;
    try {
      record = await this.recordOf(bookId);
    } catch (error) {
      this.recordProblem(bookId, error);
      return;
    }
    if (!record) return;
    const shape = (r: ShareRecord) => JSON.stringify({ ...r, appliedSeq: 0, updatedAt: '' });
    if (pushed === 0 && shape(record) === shape(last.record)) {
      if (record.appliedSeq === last.record.appliedSeq || this.now() - last.at < this.recordEveryMs) return;
    }
    await this.putRecord(record, false);
  }

  /**
   * Removes the book's record when it is this device's record of `relayBookId`, the share that ended (§6.1; review
   * C1): a record of another relay book or another device stays. Whether one was removed. Never throws.
   */
  private async removeRecord(bookId: string, relayBookId: string): Promise<boolean> {
    this.recordWritten.delete(bookId);
    this.recordDirty.delete(bookId);
    if (!this.records) return false;
    try {
      const found = await this.records.get(bookId);
      if (!found || found.deviceId !== this.deviceId || found.relayBookId !== relayBookId) return false;
      await this.records.remove(bookId);
      return true;
    } catch (error) {
      this.recordProblem(bookId, error);
      return false;
    }
  }

  private recordProblem(bookId: string | null, error: unknown): void {
    console.warn(bookId === null ? 'Share records could not be read' : `The share record of ${bookId} could not be kept`, error);
    try {
      this.onRecordProblem?.(bookId, error);
    } catch {
      // a listener's failure is its own
    }
  }

  private async cursorOf(bookId: string): Promise<number> {
    const [row] = await this.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`);
    return Number(row?.[0] ?? 0);
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
      await keepClocksTx(tx, bookId); // nothing is captured while it waits (recovery review, N2)
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
  if (a.needsAccount !== undefined || b.needsAccount !== undefined) out.needsAccount = (a.needsAccount ?? 0) + (b.needsAccount ?? 0);
  const stopped = b.stopped ?? a.stopped;
  return stopped ? { ...out, stopped } : out;
}

export { MissingEpochKeyError };
