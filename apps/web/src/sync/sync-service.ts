import {
  type BookSyncStatus as EngineBookStatus,
  type CreatedInvite,
  BookError,
  type Database,
  deleteBook,
  type DeleteBookOptions,
  type DeviceKeys,
  type KeyStore,
  listSharedBooks,
  type NetWorthGroupView,
  outboxOps,
  ownRecordsMessage,
  planBookDelete,
  type PreviewedInvite,
  type RateFetcher,
  recordDevicesSeen,
  runSharedBookRepairs,
  requestSignerOf,
  SEEN_WRITE_MS,
  type SequencedEntry,
  type ShareRecordFinding,
  type ShareRecordStore,
  SyncEngine,
  type SyncOnceResult,
  type SyncTransport,
  type WorkspaceContext,
} from '@expanses/db';
import { createKeyStore } from './key-store';
import { createRelayTransport } from './relay';
import { isNative } from '../lib/pwa';
import { createShareRecordStore } from './share-record-store';
import { SyncScheduler } from './sync-scheduler';
import { SyncLog, type SyncLogOp } from './sync-log';
import { frankfurterFetcher } from '../lib/fx-client';
// This app's own version (joint-net-worth spec §9), written on this device's book_devices row so a peer can tell
// whether it meets NET_WORTH_MIN_APP_VERSION before proposing joint mode.
import pkg from '../../package.json';

/*
 * The app's one sync service (household sharing spec §9.4, §11). It makes the device's keys, the engine over the
 * relay, and one `SyncScheduler` per active shared book — a run at start, on every foreground, after a local write,
 * and every 30 s, with the scheduler's backoff after failures.
 *
 * - Nothing here blocks a screen on the relay: a run happens behind whatever is on screen, and a screen that asks for
 *   a status reads what the last run left.
 * - With no shared book, nothing is made and no request is sent: the keys and the engine come into being only when a
 *   book is shared or joined, or when the device already holds one.
 * - Every engine call on a book goes through one queue per book, so a Share, a Remove and a scheduled run never
 *   drain or pull the same book at once.
 * - After a run applies anything, `onApplied` is called, which drops the screens' cached figures.
 */

/**
 * Leave and delete, or Delete here only, got past the leave (or the local forget) and the delete then failed (A8 review
 * I-1): the share is over here, the workspace is still here. `cause` is the delete's own failure.
 */
export class LeftNotDeletedError extends Error {
  constructor(
    readonly cause: unknown,
    readonly how: 'left' | 'forgotten',
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'LeftNotDeletedError';
  }
}

export interface BookSyncStatus {
  /** The last run that reached the relay and finished, in ms. */
  lastSyncedAt: number | null;
  /** The most recent run failed; the scheduler is backing off. */
  failing: boolean;
  running: boolean;
  /**
   * The last run's net-worth group log part failed on the relay (joint-net-worth §4, task 4 review round 1): the
   * workspace itself synced, the group log is tried again on the next run.
   */
  groupFailing: boolean;
  /** What the last failed run threw, until a run succeeds: the Share page's "Last sync failed: …". */
  lastError: unknown;
}

export interface SyncServiceOptions {
  database: Database;
  keyStore?: KeyStore;
  /** The transport for a device; the relay at `VITE_RELAY_URL` by default. */
  transportFor?: (device: DeviceKeys) => SyncTransport;
  /** Called after a run applied something another device wrote, or this device's state changed. */
  onApplied?: () => void;
  onError?: (error: unknown) => void;
  /** Where failures are recorded (src/sync/sync-log.ts); a log in memory when none is given. */
  log?: SyncLog;
  /**
   * This device's share records (sharing resilience §6.1), beside its keys and outside the database: the keychain on
   * native, IndexedDB on the web, by default (`createShareRecordStore`). `null` keeps none.
   */
  shareRecords?: ShareRecordStore | null;
  now?: () => number;
  intervalMs?: number;
  /** Where the one-time repairs fetch a missing day's rate (sync gaps R2); the app's rate server by default. */
  rateFetcher?: RateFetcher;
}

/**
 * Development only: the sample (`/load-sample`, src/db/dev-sample.ts) is a database written whole, whose shared book has no
 * device or epoch key here — so the restore check (§8.7) would turn it to "no longer in the event", as it does a restored
 * backup. Once the sample has been loaded in this browser, its shared books are left as they were seeded and not synced.
 * In a production build `import.meta.env.DEV` is false and this is gone.
 */
function devSampleLoaded(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return window.localStorage.getItem('expanses.dev-sample-loaded') === '1';
  } catch {
    return false;
  }
}

const IDLE: BookSyncStatus = { lastSyncedAt: null, failing: false, running: false, groupFailing: false, lastError: null };

/** The engine's status in a few words, for the log: `waiting 3`, `stale 2`, `unshared stopped`, `none`. */
export function statusInShort(status: EngineBookStatus | null): string {
  if (!status) return 'none';
  switch (status.state) {
    case 'waiting':
      return `waiting ${status.changes}`;
    case 'stale':
      return `stale ${status.changes} since ${status.since}`;
    case 'frozen':
      return `frozen ${status.changes}`;
    case 'unshared':
      return `unshared ${status.reason}`;
    default:
      return status.state;
  }
}

/** The ms of an hlc: its first 12 hex digits (spec §6.1). */
const hlcMs = (hlc: string) => Number.parseInt(hlc.slice(0, 12), 16);

/** A transport that notes when each device's entries were written, as they are pulled — "synced 2 min ago". */
class ObservedTransport implements SyncTransport {
  constructor(
    private readonly inner: SyncTransport,
    private readonly onPulled: (relayBookId: string, entries: SequencedEntry[]) => void,
  ) {}
  createBook: SyncTransport['createBook'] = (device) => this.inner.createBook(device);
  append: SyncTransport['append'] = (bookId, entry) => this.inner.append(bookId, entry);
  pull: SyncTransport['pull'] = async (bookId, since) => {
    const page = await this.inner.pull(bookId, since);
    this.onPulled(bookId, page.entries);
    return page;
  };
  putInvite: SyncTransport['putInvite'] = (bookId, invite) => this.inner.putInvite(bookId, invite);
  previewInvite: SyncTransport['previewInvite'] = (inviteId) => this.inner.previewInvite(inviteId);
  claimInvite: SyncTransport['claimInvite'] = (inviteId, device) => this.inner.claimInvite(inviteId, device);
  removeDevice: SyncTransport['removeDevice'] = (bookId, deviceId) => this.inner.removeDevice(bookId, deviceId);
  setOwners: SyncTransport['setOwners'] = (bookId, deviceIds) => this.inner.setOwners(bookId, deviceIds);
  deleteBook: SyncTransport['deleteBook'] = (bookId) => this.inner.deleteBook(bookId);
}

export class SyncService {
  private readonly database: Database;
  private readonly keyStore: () => KeyStore;
  private readonly transportFor: (device: DeviceKeys) => SyncTransport;
  private readonly appliedListeners = new Set<() => void>();
  private readonly onError: (error: unknown) => void;
  private readonly now: () => number;
  private readonly intervalMs: number | undefined;
  private readonly rateFetcher: RateFetcher | undefined;
  /** Books whose one-time repairs ran without failing since the app opened: not asked again until the next open. */
  private readonly repaired = new Set<string>();
  private readonly shareRecords: () => ShareRecordStore | null;
  /** This device's record of sharing failures: local only, never synced. */
  readonly log: SyncLog;
  /** What the share records said at open (§6.2), but `ok`: a `lost` one is the Share row's line until it is dealt with. */
  private found: ShareRecordFinding[] = [];
  /**
   * Set while the database is replaced under the service (a restore, review R1): no run starts, and nothing starts
   * again before the reload — but a restore that did not happen.
   */
  private halted = false;
  /** Every run in flight, so a restore waits for them before the rows are swapped. */
  private readonly inFlight = new Set<Promise<unknown>>();

  private engineMade: Promise<SyncEngine> | undefined;
  private prepared: Promise<void> | undefined;
  private readonly schedulers = new Map<string, SyncScheduler>();
  private readonly statuses = new Map<string, BookSyncStatus>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();
  /** Per relay book, the newest entry time of each device pulled since the last flush. */
  private readonly heard = new Map<string, Record<string, number>>();
  /** Per book, when this device's own last-heard time was last written: written again only once it moves by more than a minute (minor 4). */
  private readonly ownSeenWritten = new Map<string, number>();
  private started = false;
  private readonly onVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') this.triggerAll();
    // §6.1: the cursor reaches each share record when the app goes to the background, not only every 30 s.
    else void this.flushRecords();
  };

  constructor(options: SyncServiceOptions) {
    this.database = options.database;
    let store: KeyStore | undefined = options.keyStore;
    this.keyStore = () => (store ??= createKeyStore());
    this.transportFor = options.transportFor ?? ((device) => createRelayTransport(requestSignerOf(device)));
    if (options.onApplied) this.appliedListeners.add(options.onApplied);
    this.onError = options.onError ?? ((error) => console.warn('Sync failed', error));
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs;
    this.rateFetcher = options.rateFetcher;
    this.log = options.log ?? new SyncLog(undefined, () => new Date(this.now()));
    let records: ShareRecordStore | null | undefined = options.shareRecords;
    // Outside a browser and the shell (a test run under node) there is no IndexedDB to keep records in: none is kept.
    this.shareRecords = () => (records === undefined ? (records = isNative() || typeof indexedDB !== 'undefined' ? createShareRecordStore() : null) : records);
  }

  /** The engine, made once: this device's keys (made on first need), then the engine over the relay. */
  engine(): Promise<SyncEngine> {
    this.engineMade ??= (async () => {
      const device = await this.keyStore().getOrCreateDevice();
      const transport = new ObservedTransport(this.transportFor(device), (relayBookId, entries) => this.hear(relayBookId, entries));
      const shareRecords = this.shareRecords();
      return new SyncEngine(this.database, transport, device, this.now, {
        appVersion: pkg.version,
        ...(shareRecords ? { shareRecords } : {}),
        // A record that could not be read or written never fails a share or a sync; it is a line in the log.
        onShareRecordProblem: (bookId, error) => void this.note('records', bookId, { error }),
      });
    })();
    this.engineMade.catch(() => (this.engineMade = undefined));
    return this.engineMade;
  }

  /** The engine if one was made; never makes keys or an engine. For the diagnostics, which only read. */
  async madeEngine(): Promise<SyncEngine | null> {
    if (!this.engineMade) return null;
    return this.engineMade.catch(() => null);
  }

  /** Whether this device holds sharing keys at all, without making any. */
  async hasKeys(): Promise<boolean> {
    try {
      return await this.keyStore().hasDevice();
    } catch {
      return false;
    }
  }

  /** This device's id, once the engine exists; null before. */
  async deviceId(): Promise<string | null> {
    if (!this.engineMade) return null;
    return (await this.engineMade).deviceId;
  }

  /**
   * At open, before the first write: when the device holds a shared book, makes the engine — so every change the app
   * captures carries this device's own id (spec §5.1) — and checks for a restored backup (§8.7). Then the share
   * records (sharing resilience §6.2): checked against the rows here — even with no shared book left, since a database
   * that lost its shares is exactly when a record outlives them — and, after the check, written for every share that
   * has none yet (§6.1 backfill). A device that never had keys never shared, holds no record, and makes none. Local only.
   */
  prepare(): Promise<void> {
    this.prepared ??= (async () => {
      if (devSampleLoaded()) return;
      try {
        const books = await listSharedBooks(this.database);
        if (books.length === 0 && !(await this.hasKeys())) return;
        const engine = await this.engine();
        if (books.length > 0) {
          const switched = await engine.checkRestore();
          // A restored copy (§8.7) is not a failure, but it is the moment a share goes quiet here: worth a line.
          for (const bookId of switched) {
            await this.note('restore', bookId, { message: 'At open: this device has no device row or no epoch key that opens, so the book waits for a new invite (needs_invite) and its outbox was cleared' });
          }
          if (switched.length > 0) this.onApplied();
        }
        await this.checkRecords(engine);
      } catch (error) {
        await this.note('prepare', null, { error });
        throw error;
      }
    })();
    this.prepared.catch(() => (this.prepared = undefined));
    return this.prepared;
  }

  /** §6.2 then §6.1: the check first (the engine holds every record write until it has run), then the backfill. */
  private async checkRecords(engine: SyncEngine): Promise<void> {
    const findings = await engine.checkShareRecords();
    this.found = findings.filter((finding) => finding.kind !== 'ok');
    for (const finding of this.found) {
      const what =
        finding.kind === 'lost'
          ? `share record found lost: relay book ${finding.relayBookId.slice(0, 8)} is not active here; Share waits until it is discarded`
          : finding.kind === 'behind'
            ? `share record found behind: cursor ${finding.fromSeq}, the record had ${finding.toSeq}; own entries after the cursor are not here`
            : `share record found for a workspace not here (relay book ${finding.kind === 'missing_book' ? finding.relayBookId.slice(0, 8) : 'unknown'})`;
      await this.note('records', finding.bookId, { message: `At open: ${what}` });
    }
    const written = await engine.backfillShareRecords();
    if (written > 0) await this.note('records', null, { message: `At open: ${written} share ${written === 1 ? 'record' : 'records'} written for shares made before this build` });
    if (this.found.length > 0) this.emit();
  }

  /** What the share records said at open (§6.2), `ok` left out; a finding goes once its book is dealt with. */
  findings(): ShareRecordFinding[] {
    return [...this.found];
  }

  /** Whether the book lost its share on this phone (§6.2 `lost`): the Share row says so, and Share waits for a discard. */
  lostHere(bookId: string): boolean {
    return this.found.some((finding) => finding.kind === 'lost' && finding.bookId === bookId);
  }

  /** Starts syncing every active shared book, and again whenever the app comes back to the foreground. */
  async start(): Promise<void> {
    if (this.started || this.halted) return;
    this.started = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    await this.prepare();
    await this.refresh();
  }

  stop(): void {
    this.started = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    for (const scheduler of this.schedulers.values()) scheduler.stop();
    this.schedulers.clear();
  }

  /** Brings the schedulers in line with `shared_books`: one per active book, none for any other. */
  async refresh(): Promise<void> {
    const active = new Set((await listSharedBooks(this.database)).filter((book) => book.state === 'active' && !devSampleLoaded()).map((book) => book.bookId));
    for (const [bookId, scheduler] of this.schedulers) {
      if (!active.has(bookId)) {
        scheduler.stop();
        this.schedulers.delete(bookId);
      }
    }
    if (!this.started) return;
    for (const bookId of active) {
      if (this.schedulers.has(bookId)) continue;
      const scheduler = new SyncScheduler({
        // A follow-up queued before a restore halted the service is dropped, not run against the swapped rows.
        syncOnce: () => (this.halted ? Promise.resolve() : this.runOnce(bookId).then(() => undefined)),
        onError: (error) => this.onError(error),
        ...(this.intervalMs === undefined ? {} : { intervalMs: this.intervalMs }),
      });
      this.schedulers.set(bookId, scheduler);
      scheduler.start();
    }
    this.emit();
  }

  /** "I just wrote something": every shared book syncs now, behind the screen. */
  nudge(): void {
    this.triggerAll();
  }

  /** Syncs one book now and waits for it; never throws (a failure shows on the status line). */
  async syncNow(bookId: string): Promise<void> {
    if (this.halted) return;
    const scheduler = this.schedulers.get(bookId);
    if (scheduler) return scheduler.trigger();
    await this.runOnce(bookId).catch((error: unknown) => this.onError(error));
  }

  status(bookId: string): BookSyncStatus {
    return this.statuses.get(bookId) ?? IDLE;
  }

  /** Told when a run applied what another device wrote, or a book's state changed: the screens must re-read. */
  whenApplied(listener: () => void): () => void {
    this.appliedListeners.add(listener);
    return () => this.appliedListeners.delete(listener);
  }

  private onApplied(): void {
    for (const listener of this.appliedListeners) listener();
  }

  /** Told after every run and every change of schedule; returns the way to stop listening. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ------------------------------------------------------------- the acts */

  /**
   * Share this workspace (§6.5): refuses a book in another currency, seeds, drains the whole history — calling
   * `onProgress(done, total)` in ops as it goes — and only then makes the invite (step 4).
   */
  async share(
    bookId: string,
    input: { memberName: string; deviceName: string },
    onProgress?: (done: number, total: number) => void,
  ): Promise<CreatedInvite> {
    const engine = await this.logged('share', bookId, () => this.engine());
    let shared = false;
    let stage: SyncLogOp = 'seed';
    try {
      const invite = await this.exclusive(bookId, async () => {
        await engine.shareBook(bookId, input);
        shared = true;
        stage = 'drain';
        const sent = await this.drainWithProgress(engine, bookId, onProgress);
        stage = 'invite';
        const made = await engine.createInvite(bookId, { inviterName: input.memberName });
        await this.note('share', bookId, { message: `Shared: seeded, ${sent.ops} ops in ${sent.pushed} entries sent, ${sent.left} ops left in the outbox, invite made` });
        return made;
      });
      await this.touched(bookId);
      return invite;
    } catch (error) {
      await this.note(stage, bookId, { error });
      // Once the seed is written the book is shared, whatever happens to its upload: it waits in the outbox, the
      // status line says it is not synced, and the scheduler sends it when the relay answers (task 7 fix round 1).
      if (shared) this.setStatus(bookId, { running: false, failing: true, lastError: error });
      throw error;
    } finally {
      if (shared) {
        await this.refresh();
        this.emit();
      }
    }
  }

  /** The books this service is polling right now. */
  syncing(): string[] {
    return [...this.schedulers.keys()];
  }

  /** A fresh invite for the other person to a book already shared — the code shown again after a reload. */
  async invite(bookId: string, inviterName: string): Promise<CreatedInvite> {
    return this.logged('invite', bookId, async () => {
      const engine = await this.engine();
      return this.exclusive(bookId, () => engine.createInvite(bookId, { inviterName }));
    });
  }

  /** Link a device (§8.3): an invite for another device of this device's own member. */
  async linkDevice(bookId: string, inviterName: string): Promise<CreatedInvite> {
    return this.logged('invite', bookId, async () => {
      const engine = await this.engine();
      return this.exclusive(bookId, () => engine.linkDevice(bookId, { inviterName }));
    });
  }

  /** What a code invites to, before anything is claimed (§8.2 steps 1–2). */
  async preview(code: string): Promise<PreviewedInvite> {
    return this.logged('preview', null, async () => (await this.engine()).previewInvite(code));
  }

  /** Join (§8.2): the claim, the keys, the book, the introduction, and a first sync from the start of the log. */
  async join(code: string, input: { ws: WorkspaceContext; memberName: string; deviceName: string }): Promise<{ bookId: string }> {
    const { bookId, result } = await this.logged('join', null, async () => (await this.engine()).joinBook(code, input));
    await this.note('join', bookId, { message: `Joined: ${result.applied} entries applied, ${result.skipped.length} ops refused${result.stopped ? `, pull stopped at seq ${result.stopped.seq}: ${result.stopped.reason}` : ''}` });
    await this.touched(bookId, result);
    await this.refresh();
    this.onApplied();
    return { bookId };
  }

  /** Remove a device (§8.4); for another device this device then applies its removal and rotates. */
  async removeDevice(bookId: string, deviceId: string): Promise<void> {
    await this.logged('remove', bookId, async () => {
      const engine = await this.engine();
      await this.exclusive(bookId, () => engine.removeDevice(bookId, deviceId));
    });
    await this.touched(bookId);
    this.onApplied();
  }

  /** Link another member's device (§8.3, §8.7): an owner's invite that joins as that member. */
  async linkDeviceFor(bookId: string, inviterName: string, memberId: string): Promise<CreatedInvite> {
    return this.logged('invite', bookId, async () => {
      const engine = await this.engine();
      return this.exclusive(bookId, () => engine.createInvite(bookId, { inviterName, sameMember: true, memberId }));
    });
  }

  /** The status line's state (§11), from the engine; null for a book not shared here, or before any engine exists. */
  async bookStatus(bookId: string): Promise<EngineBookStatus | null> {
    if (!this.engineMade) return null;
    return (await this.engine()).bookSyncStatus(bookId);
  }

  /** Whether no owner device is left (§8.5): invites, removing others and Make owner are not offered. */
  async isFrozen(bookId: string): Promise<boolean> {
    if (!this.engineMade) return false;
    return (await this.engine()).isFrozen(bookId);
  }

  /** Make owner (§8.5), then the screens re-read. */
  async makeOwner(bookId: string, memberId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.makeOwner(bookId, memberId));
  }

  /** Rename self (sharing resilience §10.2, D-D2): this member's own name, synced soon; then the screens re-read. */
  async renameSelf(bookId: string, name: string): Promise<void> {
    await this.act(bookId, (engine) => engine.renameSelf(bookId, name));
  }

  /** Leave (§8.4): the book stays here, read-only; it is no longer polled. */
  async leave(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.leave(bookId), 'leave');
  }

  /** Stop sharing (§8.6), by an owner: the book is an ordinary one here again; the others go read-only on their next run. */
  async stopSharing(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.stopSharing(bookId), 'stop');
  }

  /**
   * Keep the book as this device's own (final review, C1): the way out of a share that is dead here — or whose owners
   * have made no change for two weeks while this phone kept syncing (sharing resilience D-A11). Local only.
   */
  async forgetSharing(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.forgetSharing(bookId));
  }

  /* ------------------------------------------------- sharing resilience (spec §4.3, §5, §6.2) */

  /**
   * Discard old share (§7, review N2): this device's record of a share it lost goes, after the screen asked, and Share
   * goes through again. Whether a record was removed.
   */
  async discardShareRecord(bookId: string): Promise<boolean> {
    const removed = await this.logged('records', bookId, async () => (await this.engine()).discardShareRecord(bookId));
    this.found = this.found.filter((finding) => finding.bookId !== bookId);
    await this.note('records', bookId, { message: removed ? 'Old share discarded: its record is removed from this device' : 'Old share discarded: no record of this device was left' });
    this.emit();
    this.onApplied();
    return removed;
  }

  /**
   * Place them now (§4.3): rows another copy here held come in once that copy is gone. It runs in the book's turn, so
   * no ordinary sync of the book runs while it reads the log again from the start.
   */
  async placeHeldRows(bookId: string): Promise<{ placed: number; stillHeld: number; needsAccount: number }> {
    const engine = await this.logged('place', bookId, () => this.engine());
    const done = await this.logged('place', bookId, () => this.exclusive(bookId, () => engine.placeHeldRows(bookId)));
    // Own purchases that found no own account and sit on this member's placeholder (A6: by the arriving-account record).
    const needsAccount = done.result.needsAccount ?? 0;
    await this.note('place', bookId, { message: `Place them now: placed ${done.placed}, still held ${done.stillHeld}, ${done.result.applied} entries applied, ${needsAccount} need an account` });
    await this.touched(bookId, done.result);
    this.onApplied();
    return { placed: done.placed, stillHeld: done.stillHeld, needsAccount };
  }

  /**
   * Delete a workspace (§5): through its plan, so a once-shared one is erased and a joined copy's own purchases are
   * kept in Personal unless `keepOwnInPersonal` is false. The share record goes too, by the relay book read before
   * the rows went (review I2). The caller takes the safety copy first.
   */
  async deleteWorkspace(ws: WorkspaceContext, bookId: string, options: DeleteBookOptions = {}): Promise<{ erased: boolean; keptInPersonal: number; transactions: number }> {
    const relays = await this.relaysOf(bookId);
    const done = await this.logged('erase', bookId, () => this.exclusive(bookId, () => deleteBook(this.database, ws, bookId, options)));
    let dropped = 0;
    const engine = await this.madeEngine();
    if (engine) for (const relay of relays) if (await engine.dropShareRecord(bookId, relay)) dropped += 1;
    this.found = this.found.filter((finding) => finding.bookId !== bookId);
    if (done.erased || dropped > 0) {
      await this.note('erase', bookId, {
        message: `Deleted (${done.erased ? 'erased' : 'voided'}): ${done.transactions} transactions, ${done.categories} categories, ${done.keptInPersonal} kept in Personal, ${dropped} share ${dropped === 1 ? 'record' : 'records'} removed`,
      });
    }
    await this.refresh().catch((error: unknown) => this.failed('refresh', bookId, error));
    this.emit();
    this.onApplied();
    return { erased: done.erased, keptInPersonal: done.keptInPersonal, transactions: done.transactions };
  }

  /**
   * Leave and delete (§5.1, D-A8): this phone leaves the share, then the copy is erased. A failed leave changes
   * nothing and throws as it came: a `LastOwnerError`, or the relay out of reach — then the screen offers Delete here only.
   */
  async leaveAndDelete(ws: WorkspaceContext, bookId: string, options: DeleteBookOptions = {}): Promise<{ erased: boolean; keptInPersonal: number; transactions: number }> {
    await this.refuseBeforeLeaving(ws, bookId, options);
    await this.leave(bookId);
    await this.note('leave', bookId, { message: 'Left the share, for Leave and delete' });
    try {
      return await this.deleteWorkspace(ws, bookId, options);
    } catch (error) {
      throw new LeftNotDeletedError(error, 'left');
    }
  }

  /**
   * Leaving cannot be undone, so the delete is planned first as if the copy were already left (A8 review I-1): a
   * split, a record, a draft or own trades with keep off refuse here, with the share untouched.
   */
  private async refuseBeforeLeaving(ws: WorkspaceContext, bookId: string, options: DeleteBookOptions): Promise<void> {
    const plan = await this.logged('erase', bookId, () => planBookDelete(this.database, ws, bookId, { asIfLeft: true }));
    if (plan.refusal && plan.refusalCode) throw new BookError(plan.refusalCode, plan.refusal);
    if (plan.ownRecords > 0 && options.keepOwnInPersonal === false) throw new BookError('RECORDS', ownRecordsMessage(plan.ownRecords));
  }

  /**
   * Delete here only (§5.1): Leave could not reach the relay, so the share is forgotten on this phone alone — the
   * share still lists this phone until an owner removes it — and the copy is erased.
   */
  async deleteHereOnly(ws: WorkspaceContext, bookId: string, options: DeleteBookOptions = {}): Promise<{ erased: boolean; keptInPersonal: number; transactions: number }> {
    await this.refuseBeforeLeaving(ws, bookId, options);
    const relays = await this.relaysOf(bookId);
    await this.act(bookId, (engine) => engine.forgetSharing(bookId, { deleting: true }), 'erase');
    let done: { erased: boolean; keptInPersonal: number; transactions: number };
    try {
      done = await this.deleteWorkspace(ws, bookId, { ...options, asIfLeft: true });
    } catch (error) {
      throw new LeftNotDeletedError(error, 'forgotten');
    }
    // Forgetting removed this device's record of the share it was on; a lost one of another relay book goes here.
    const engine = await this.madeEngine();
    if (engine) for (const relay of relays) await engine.dropShareRecord(bookId, relay);
    return done;
  }

  /** The relay books a share record of the book may name: its `shared_books` row's, and a lost finding's. */
  private async relaysOf(bookId: string): Promise<string[]> {
    const relays = new Set<string>();
    const row = (await listSharedBooks(this.database)).find((book) => book.bookId === bookId);
    if (row) relays.add(row.relayBookId);
    for (const finding of this.found) if (finding.bookId === bookId && 'relayBookId' in finding) relays.add(finding.relayBookId);
    return [...relays];
  }

  /**
   * A restore (Backup page, iCloud; spec §6.7, review R1): every schedule stops and every run in flight is waited
   * for, so no pull moves the restored rows' cursor past own entries before the check at the next open. Then `work`
   * swaps the rows, and the engine is told they were replaced. Nothing starts again — the page reloads — unless
   * `work` failed, which leaves the rows as they were: then syncing carries on.
   */
  async whileReplacing(work: () => Promise<void>): Promise<void> {
    const wasStarted = this.started;
    this.halted = true;
    this.stop();
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
    try {
      await work();
    } catch (error) {
      this.halted = false;
      (await this.madeEngine())?.databaseReplaced();
      if (wasStarted) await this.start().catch((failure: unknown) => this.failed('refresh', null, failure));
      throw error;
    }
    (await this.madeEngine())?.databaseReplaced();
  }

  /** Every active book's share record written now, cursor included (§6.1: on app hide). Never throws. */
  private async flushRecords(): Promise<void> {
    const engine = await this.madeEngine();
    if (!engine || this.halted) return;
    for (const bookId of this.schedulers.keys()) await engine.flushShareRecord(bookId).catch((error: unknown) => this.note('records', bookId, { error }));
  }

  /* ------------------------------------------------------------- shared events */

  /** Share an event as its own relay book (shared events §3); polled from here on like any shared book. */
  async shareEvent(ws: WorkspaceContext, input: { eventId: string; currency: string; personName: string; deviceName: string; names: string[] }): Promise<{ bookId: string }> {
    const { bookId } = await this.logged('share', null, async () => (await this.engine()).shareEvent(ws, input));
    await this.touched(bookId);
    await this.refresh();
    this.onApplied();
    return { bookId };
  }

  /** An invite to an event; for a person's new phone when `forPersonId` is given (§7). */
  async eventInvite(bookId: string, inviterName: string, forPersonId?: string): Promise<CreatedInvite> {
    return this.logged('invite', bookId, async () => {
      const engine = await this.engine();
      return this.exclusive(bookId, () => engine.createEventInvite(bookId, { inviterName, ...(forPersonId ? { forPersonId } : {}) }));
    });
  }

  /** Join an event: the claim, the book, the name, and a first pull of the whole log. */
  async joinEvent(code: string, input: { ws: WorkspaceContext; personId: string | null; name: string; deviceName: string }): Promise<{ eventId: string }> {
    const { bookId, eventId, result } = await this.logged('join', null, async () => (await this.engine()).joinEvent(code, input));
    await this.touched(bookId, result);
    await this.refresh();
    this.onApplied();
    return { eventId };
  }

  /** Leave an event at a zero balance (D9): kept here read-only, no longer polled. */
  async leaveEvent(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.leaveEvent(bookId));
  }

  /** Remove a person from an event at zero and in no record; a person with the app loses their devices in it. */
  async removeEventMember(ws: WorkspaceContext, eventId: string, bookId: string, personId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.removeEventMember(ws, eventId, personId));
  }

  /** Lost phone: remove a person's old phone(s) from an event, keeping the person, before inviting the new one. */
  async removeEventMemberPhones(ws: WorkspaceContext, eventId: string, bookId: string, personId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.removeEventMemberPhones(ws, eventId, personId));
  }

  /* ------------------------------------------------------ joint net worth */

  /** The workspace's net-worth group as this device derives it (§6); null before any engine exists. */
  async netWorthGroup(bookId: string): Promise<NetWorthGroupView | null> {
    if (!this.engineMade) return null;
    return (await this.engine()).netWorthGroup(bookId);
  }

  /** Propose how the household files and who is in the group (§6 Setup, Change). */
  async proposeNetWorth(bookId: string, input: { mode: 'joint' | 'separate'; members: string[] }): Promise<void> {
    await this.act(bookId, async (engine) => void (await engine.proposeNetWorth(bookId, input)));
  }

  /** Confirm, or decline, a proposal this member is asked on (§6 Confirm). */
  async answerNetWorth(bookId: string, proposalId: string, answer: 'confirm' | 'decline'): Promise<void> {
    await this.act(bookId, (engine) => engine.answerNetWorth(bookId, proposalId, answer));
  }

  /** Withdraw a proposal of this member's not yet active. */
  async cancelNetWorth(bookId: string, proposalId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.cancelNetWorth(bookId, proposalId));
  }

  /** Stop sharing my net worth (§6 Leaving). */
  async leaveNetWorth(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.leaveNetWorth(bookId));
  }

  /* ------------------------------------------------------------- internals */

  /** An act that may change the book's state: whatever it did, the schedule follows `shared_books` and screens re-read. */
  private async act(bookId: string, work: (engine: SyncEngine) => Promise<void>, op: SyncLogOp = 'act'): Promise<void> {
    const engine = await this.logged(op, bookId, () => this.engine());
    try {
      await this.logged(op, bookId, () => this.exclusive(bookId, () => work(engine)));
    } finally {
      await this.refresh().catch((error: unknown) => this.failed('refresh', bookId, error));
      this.emit();
      this.onApplied();
    }
  }

  private async drainWithProgress(engine: SyncEngine, bookId: string, onProgress?: (done: number, total: number) => void): Promise<{ ops: number; pushed: number; left: number }> {
    const total = await outboxOps(this.database, bookId);
    onProgress?.(0, total);
    let stop = false;
    const watch = (async () => {
      while (!stop) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (stop) break;
        const left = await outboxOps(this.database, bookId);
        onProgress?.(Math.max(0, total - left), total);
      }
    })();
    let pushed = 0;
    try {
      pushed = (await engine.syncOnce(bookId)).pushed;
    } finally {
      stop = true;
      await watch;
    }
    onProgress?.(total, total);
    return { ops: total, pushed, left: await outboxOps(this.database, bookId) };
  }

  private runOnce(bookId: string): Promise<SyncOnceResult> {
    const run = this.runOnceNow(bookId);
    this.inFlight.add(run);
    void run.catch(() => undefined).finally(() => this.inFlight.delete(run));
    return run;
  }

  private async runOnceNow(bookId: string): Promise<SyncOnceResult> {
    this.setStatus(bookId, { running: true });
    try {
      const engine = await this.engine();
      const result = await this.exclusive(bookId, () => engine.syncOnce(bookId));
      await this.touched(bookId, result);
      // The group log's own failure (task 4 review round 1): the workspace synced, so the run is not failing; the
      // status says the group log is behind, and the error is reported like any other.
      this.setStatus(bookId, { groupFailing: result.groupError !== undefined });
      if (result.groupError) {
        await this.note('group', bookId, { error: result.groupError });
        this.onError(result.groupError);
      }
      // Not failures, but where a book goes quiet without one: refused ops, and a pull that stopped short.
      if (result.skipped.length > 0) {
        const kinds = [...new Set(result.skipped.map((op) => op.entity))].join(', ');
        await this.note('apply', bookId, { message: `${result.skipped.length} ops refused on apply (${kinds}); kept in sync_skipped` });
      }
      if (result.stopped) await this.note('pull', bookId, { message: `Pull stopped at seq ${result.stopped.seq}: ${result.stopped.reason}` });
      // Only once the book has pulled to the relay's latest, so a partner's newer write is here to be respected.
      else if (!result.ended) await this.repair(bookId);
      return result;
    } catch (error) {
      this.setStatus(bookId, { running: false, failing: true, lastError: error });
      await this.note('sync', bookId, { error });
      await this.flushHeard(bookId).catch(() => undefined);
      // A refusal can mean the book's state changed (a 410, task 9a): let the schedule follow `shared_books`.
      await this.refresh().catch(() => undefined);
      throw error;
    }
  }

  /**
   * The one-time repairs of a shared book (sync gaps R1, R2; `runSharedBookRepairs`), after its first full pull since the
   * app opened. Never fails the sync: a repair that throws is a line in the log (Share › Details) and runs again on the
   * next sync. What one sends is drained by the next run, nudged at once.
   */
  private async repair(bookId: string): Promise<void> {
    if (this.repaired.has(bookId)) return;
    try {
      const fetcher = this.rateFetcher ?? (this.defaultFetcher ??= frankfurterFetcher());
      const report = await this.exclusive(bookId, () => runSharedBookRepairs(this.database, bookId, { fetcher }));
      // The bill links wait for a device still on an older build: asked again on every sync until it has updated.
      if (!report.billLinksWaiting) this.repaired.add(bookId);
      const tags = report.eventTags;
      const changed = (report.billLinks ?? 0) > 0 || (tags !== null && tags.moved + tags.untagged > 0);
      if (report.billLinks !== null || tags !== null) {
        await this.note('repair', bookId, {
          message: `One-time repair: ${report.billLinks ?? 0} bill links sent; ${tags?.moved ?? 0} tagged purchases moved into their shared event, ${tags?.untagged ?? 0} untagged`,
        });
      }
      if (changed) {
        this.onApplied();
        this.triggerAll();
      }
    } catch (error) {
      await this.note('repair', bookId, { error });
    }
  }

  private defaultFetcher: RateFetcher | undefined;

  /** After a run that reached the relay: when it happened, who was heard from, and whether the screens must re-read. */
  private async touched(bookId: string, result?: SyncOnceResult): Promise<void> {
    const at = this.now();
    this.setStatus(bookId, { running: false, failing: false, lastSyncedAt: at, lastError: null });
    try {
      const id = await this.deviceId();
      if (id && at - (this.ownSeenWritten.get(bookId) ?? -Infinity) > SEEN_WRITE_MS) {
        await recordDevicesSeen(this.database, bookId, { [id]: at }, this.now());
        this.ownSeenWritten.set(bookId, at);
      }
      await this.flushHeard(bookId);
    } catch (error) {
      await this.failed('seen', bookId, error);
    }
    // A run that stopped short may have moved the book out of `active` (needs_invite): it is no longer polled.
    if (result?.stopped || result?.ended) await this.refresh().catch((error: unknown) => this.failed('refresh', bookId, error));
    this.emit();
    // A workspace's run also syncs its net-worth group log (joint-net-worth §4): what that applied is read again too.
    const group = result?.group;
    const changed = (r: typeof result) => !!r && (r.applied > 0 || r.rotated !== undefined || r.ended !== undefined || r.stopped?.reason === 'needs invite');
    if (changed(result) || changed(group)) this.onApplied();
  }

  private hear(relayBookId: string, entries: SequencedEntry[]): void {
    const seen = this.heard.get(relayBookId) ?? {};
    for (const entry of entries) {
      const ms = hlcMs(entry.hlc);
      if (Number.isFinite(ms) && !(ms <= (seen[entry.deviceId] ?? -Infinity))) seen[entry.deviceId] = ms;
    }
    this.heard.set(relayBookId, seen);
  }

  private async flushHeard(bookId: string): Promise<void> {
    const relayBookId = (await listSharedBooks(this.database)).find((book) => book.bookId === bookId)?.relayBookId;
    if (!relayBookId) return;
    const seen = this.heard.get(relayBookId);
    if (!seen) return;
    this.heard.delete(relayBookId);
    await recordDevicesSeen(this.database, bookId, seen, this.now());
  }

  /**
   * One line in the log (src/sync/sync-log.ts), with the relay's id for the book and the engine's status right
   * after. Never throws, and never waits on the relay: both reads are local.
   */
  private async note(op: SyncLogOp, bookId: string | null, what: { error?: unknown; message?: string }): Promise<void> {
    let relayBookId: string | null = null;
    let state: string | null = null;
    if (bookId) {
      try {
        relayBookId = (await listSharedBooks(this.database)).find((book) => book.bookId === bookId)?.relayBookId ?? null;
      } catch {
        // Left out.
      }
      try {
        state = this.engineMade ? statusInShort(await (await this.engineMade).bookSyncStatus(bookId)) : 'no engine';
      } catch (error) {
        state = `unknown (${error instanceof Error ? error.name : typeof error})`;
      }
    }
    await this.log.record({ op, bookId, relayBookId, state, ...(what.error !== undefined ? { error: what.error } : { message: what.message ?? '' }) });
  }

  /** A failure nobody waits on: logged, and told to `onError`. */
  private async failed(op: SyncLogOp, bookId: string | null, error: unknown): Promise<void> {
    await this.note(op, bookId, { error });
    this.onError(error);
  }

  /** Runs `work`; a failure is logged and thrown on as it came. */
  private async logged<T>(op: SyncLogOp, bookId: string | null, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      await this.note(op, bookId, { error });
      throw error;
    }
  }

  private exclusive<T>(bookId: string, work: () => Promise<T>): Promise<T> {
    const before = this.queues.get(bookId) ?? Promise.resolve();
    const run = before.catch(() => undefined).then(work);
    this.queues.set(bookId, run);
    this.inFlight.add(run);
    void run.catch(() => undefined).finally(() => this.inFlight.delete(run));
    return run;
  }

  private triggerAll(): void {
    for (const scheduler of this.schedulers.values()) void scheduler.trigger();
  }

  private setStatus(bookId: string, patch: Partial<BookSyncStatus>): void {
    this.statuses.set(bookId, { ...this.status(bookId), ...patch });
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
