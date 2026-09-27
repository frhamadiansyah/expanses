import {
  type BookSyncStatus as EngineBookStatus,
  type CreatedInvite,
  type Database,
  type DeviceKeys,
  type KeyStore,
  listSharedBooks,
  outboxOps,
  type PreviewedInvite,
  recordDevicesSeen,
  requestSignerOf,
  type SequencedEntry,
  SyncEngine,
  type SyncOnceResult,
  type SyncTransport,
  type WorkspaceContext,
} from '@expanses/db';
import { createKeyStore } from './key-store';
import { createRelayTransport } from './relay';
import { SyncScheduler } from './sync-scheduler';

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

export interface BookSyncStatus {
  /** The last run that reached the relay and finished, in ms. */
  lastSyncedAt: number | null;
  /** The most recent run failed; the scheduler is backing off. */
  failing: boolean;
  running: boolean;
}

export interface SyncServiceOptions {
  database: Database;
  keyStore?: KeyStore;
  /** The transport for a device; the relay at `VITE_RELAY_URL` by default. */
  transportFor?: (device: DeviceKeys) => SyncTransport;
  /** Called after a run applied something another device wrote, or this device's state changed. */
  onApplied?: () => void;
  onError?: (error: unknown) => void;
  now?: () => number;
  intervalMs?: number;
}

const IDLE: BookSyncStatus = { lastSyncedAt: null, failing: false, running: false };

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

  private engineMade: Promise<SyncEngine> | undefined;
  private prepared: Promise<void> | undefined;
  private readonly schedulers = new Map<string, SyncScheduler>();
  private readonly statuses = new Map<string, BookSyncStatus>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();
  /** Per relay book, the newest entry time of each device pulled since the last flush. */
  private readonly heard = new Map<string, Record<string, number>>();
  private started = false;
  private readonly onVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') this.triggerAll();
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
  }

  /** The engine, made once: this device's keys (made on first need), then the engine over the relay. */
  engine(): Promise<SyncEngine> {
    this.engineMade ??= (async () => {
      const device = await this.keyStore().getOrCreateDevice();
      const transport = new ObservedTransport(this.transportFor(device), (relayBookId, entries) => this.hear(relayBookId, entries));
      return new SyncEngine(this.database, transport, device, this.now);
    })();
    this.engineMade.catch(() => (this.engineMade = undefined));
    return this.engineMade;
  }

  /** This device's id, once the engine exists; null before. */
  async deviceId(): Promise<string | null> {
    if (!this.engineMade) return null;
    return (await this.engineMade).deviceId;
  }

  /**
   * At open, before the first write: when the device holds a shared book, makes the engine — so every change the app
   * captures carries this device's own id (spec §5.1) — and checks for a restored backup (§8.7). Local only.
   */
  prepare(): Promise<void> {
    this.prepared ??= (async () => {
      const books = await listSharedBooks(this.database);
      if (books.length === 0) return;
      const engine = await this.engine();
      const switched = await engine.checkRestore();
      if (switched.length > 0) this.onApplied();
    })();
    this.prepared.catch(() => (this.prepared = undefined));
    return this.prepared;
  }

  /** Starts syncing every active shared book, and again whenever the app comes back to the foreground. */
  async start(): Promise<void> {
    if (this.started) return;
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
    const active = new Set((await listSharedBooks(this.database)).filter((book) => book.state === 'active').map((book) => book.bookId));
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
        syncOnce: () => this.runOnce(bookId).then(() => undefined),
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
    const engine = await this.engine();
    let shared = false;
    try {
      const invite = await this.exclusive(bookId, async () => {
        await engine.shareBook(bookId, input);
        shared = true;
        await this.drainWithProgress(engine, bookId, onProgress);
        return engine.createInvite(bookId, { inviterName: input.memberName });
      });
      await this.touched(bookId);
      return invite;
    } catch (error) {
      // Once the seed is written the book is shared, whatever happens to its upload: it waits in the outbox, the
      // status line says it is not synced, and the scheduler sends it when the relay answers (task 7 fix round 1).
      if (shared) this.setStatus(bookId, { running: false, failing: true });
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
    const engine = await this.engine();
    return this.exclusive(bookId, () => engine.createInvite(bookId, { inviterName }));
  }

  /** Link a device (§8.3): an invite for another device of this device's own member. */
  async linkDevice(bookId: string, inviterName: string): Promise<CreatedInvite> {
    const engine = await this.engine();
    return this.exclusive(bookId, () => engine.linkDevice(bookId, { inviterName }));
  }

  /** What a code invites to, before anything is claimed (§8.2 steps 1–2). */
  async preview(code: string): Promise<PreviewedInvite> {
    return (await this.engine()).previewInvite(code);
  }

  /** Join (§8.2): the claim, the keys, the book, the introduction, and a first sync from the start of the log. */
  async join(code: string, input: { ws: WorkspaceContext; memberName: string; deviceName: string }): Promise<{ bookId: string }> {
    const engine = await this.engine();
    const { bookId, result } = await engine.joinBook(code, input);
    await this.touched(bookId, result);
    await this.refresh();
    this.onApplied();
    return { bookId };
  }

  /** Remove a device (§8.4); for another device this device then applies its removal and rotates. */
  async removeDevice(bookId: string, deviceId: string): Promise<void> {
    const engine = await this.engine();
    await this.exclusive(bookId, () => engine.removeDevice(bookId, deviceId));
    await this.touched(bookId);
    this.onApplied();
  }

  /** Link another member's device (§8.3, §8.7): an owner's invite that joins as that member. */
  async linkDeviceFor(bookId: string, inviterName: string, memberId: string): Promise<CreatedInvite> {
    const engine = await this.engine();
    return this.exclusive(bookId, () => engine.createInvite(bookId, { inviterName, sameMember: true, memberId }));
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

  /** Leave (§8.4): the book stays here, read-only; it is no longer polled. */
  async leave(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.leave(bookId));
  }

  /** Stop sharing (§8.6), by an owner: the book is an ordinary one here again; the others go read-only on their next run. */
  async stopSharing(bookId: string): Promise<void> {
    await this.act(bookId, (engine) => engine.stopSharing(bookId));
  }

  /* ------------------------------------------------------------- internals */

  /** An act that may change the book's state: whatever it did, the schedule follows `shared_books` and screens re-read. */
  private async act(bookId: string, work: (engine: SyncEngine) => Promise<void>): Promise<void> {
    const engine = await this.engine();
    try {
      await this.exclusive(bookId, () => work(engine));
    } finally {
      await this.refresh().catch((error: unknown) => this.onError(error));
      this.emit();
      this.onApplied();
    }
  }

  private async drainWithProgress(engine: SyncEngine, bookId: string, onProgress?: (done: number, total: number) => void): Promise<void> {
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
    try {
      await engine.syncOnce(bookId);
    } finally {
      stop = true;
      await watch;
    }
    onProgress?.(total, total);
  }

  private async runOnce(bookId: string): Promise<SyncOnceResult> {
    const engine = await this.engine();
    this.setStatus(bookId, { running: true });
    try {
      const result = await this.exclusive(bookId, () => engine.syncOnce(bookId));
      await this.touched(bookId, result);
      return result;
    } catch (error) {
      this.setStatus(bookId, { running: false, failing: true });
      await this.flushHeard(bookId);
      // A refusal can mean the book's state changed (a 410, task 9a): let the schedule follow `shared_books`.
      await this.refresh().catch(() => undefined);
      throw error;
    }
  }

  /** After a run that reached the relay: when it happened, who was heard from, and whether the screens must re-read. */
  private async touched(bookId: string, result?: SyncOnceResult): Promise<void> {
    const at = this.now();
    this.setStatus(bookId, { running: false, failing: false, lastSyncedAt: at });
    try {
      const id = await this.deviceId();
      if (id) await recordDevicesSeen(this.database, bookId, { [id]: at });
      await this.flushHeard(bookId);
    } catch (error) {
      this.onError(error);
    }
    // A run that stopped short may have moved the book out of `active` (needs_invite): it is no longer polled.
    if (result?.stopped || result?.ended) await this.refresh().catch((error: unknown) => this.onError(error));
    this.emit();
    if (result && (result.applied > 0 || result.rotated !== undefined || result.ended !== undefined || result.stopped?.reason === 'needs invite')) this.onApplied();
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
    await recordDevicesSeen(this.database, bookId, seen);
  }

  private exclusive<T>(bookId: string, work: () => Promise<T>): Promise<T> {
    const before = this.queues.get(bookId) ?? Promise.resolve();
    const run = before.catch(() => undefined).then(work);
    this.queues.set(bookId, run);
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
