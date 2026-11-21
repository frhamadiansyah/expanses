import {
  becomeSeat,
  clearSentPhoto,
  markPhotoHeld,
  photosEveryoneHolds,
  photosMissingHere,
  photosToFetch,
  photosToSend,
  recordSentPhoto,
  SyncTransportError,
  completeLinkedCopy,
  type Database,
  type DeviceKeys,
  type JoinPlan,
  type JoinStage,
  type KeyStore,
  planWaitsHere,
  requestSignerOf,
  SelfEngine,
  type SelfDeviceInfo,
  type SelfDeviceRow,
  type SelfGroup,
  type SelfSyncResult,
  type SelfTransport,
  type SourceStage,
} from '@expanses/db';
import pkg from '../../package.json';
import { createKeyStore } from './key-store';
import { createRelayTransport } from './relay';
import { SyncScheduler } from './sync-scheduler';

/*
 * Link my devices in the app (spec §3.5, §4.2, §5): the owner's own devices as one group. One service per open, made
 * beside household sharing's `SyncService` and readied before it (`prepare`): a device that has just been replaced
 * by another device's copy finishes making that copy its own before anything else reads it.
 *
 * The plan of a link under way lives outside the database (localStorage): the replace swaps the database, and the
 * plan is what the next open needs to finish. It holds the group's keys sealed for this device, and the one-off key of
 * the copy on the relay — no more than the database itself holds.
 */

export const LINK_PLAN_KEY = 'cicis.link.plan';
/** Set when a plan could not be finished (the copy never replaced this device's data): the Devices page says so once. */
export const LINK_FAILED_KEY = 'cicis.link.failed';

function readPlan(): JoinPlan | null {
  try {
    const raw = localStorage.getItem(LINK_PLAN_KEY);
    return raw ? (JSON.parse(raw) as JoinPlan) : null;
  } catch {
    return null;
  }
}

/** Kept before the replace; a device that cannot keep it does not replace anything. */
export function keepPlan(plan: JoinPlan): void {
  localStorage.setItem(LINK_PLAN_KEY, JSON.stringify(plan));
  if (localStorage.getItem(LINK_PLAN_KEY) === null) throw new Error("This device can't keep the link in progress, so nothing was replaced.");
}

function forgetPlan(): void {
  try {
    localStorage.removeItem(LINK_PLAN_KEY);
  } catch {
    // nothing kept to forget
  }
}

/** What this device is, in the words the Devices list uses. No plugin reads a device's own name, so it is its kind. */
export function thisDeviceInfo(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent, touch = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints): SelfDeviceInfo {
  const version = pkg.version;
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && touch > 1)) return { name: 'iPad', kind: 'tablet', appVersion: version };
  if (/iPhone|iPod/.test(userAgent)) return { name: 'iPhone', kind: 'phone', appVersion: version };
  if (/Macintosh|Mac OS X/.test(userAgent)) return { name: 'Mac', kind: 'mac', appVersion: version };
  return { name: 'This device', kind: 'other', appVersion: version };
}

export interface SelfStatus {
  group: SelfGroup | null;
  devices: SelfDeviceRow[];
  lastSyncedAt: number | null;
  lastError: string | null;
  /** The newest change from another device waits (a newer data version, or a clash to look at). */
  held: string | null;
  /** The device keeping shared workspaces in step (§3.4). */
  seatId: string | null;
  /** Receipt photos named here whose files have not arrived yet (Drop 4: they follow the figures). */
  photosMissing: number;
}

/** The slice of the photo store the group needs: a file's bytes, and putting a file that arrived. */
export interface SelfPhotoFiles {
  readPhotoBytes(fileName: string): Promise<Uint8Array | null>;
  putPhotoBytes(fileName: string, bytes: Uint8Array): Promise<boolean>;
}

/** A photo's blobs are kept on the relay just under its week, so a slow device has the most time to fetch them. */
const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

export interface SelfServiceOptions {
  database: Database;
  keyStore?: KeyStore;
  transportFor?: (device: DeviceKeys) => SelfTransport;
  info?: SelfDeviceInfo;
  intervalMs?: number;
  now?: () => number;
  /** The photo files beside the database; none (a test of figures alone) sends and fetches no photo. */
  photos?: SelfPhotoFiles | null;
}

export class SelfService {
  private readonly database: Database;
  private readonly keyStore: () => KeyStore;
  private readonly transportFor: (device: DeviceKeys) => SelfTransport;
  readonly info: SelfDeviceInfo;
  private readonly intervalMs: number | undefined;
  private readonly now: () => number;
  private readonly photos: SelfPhotoFiles | null;
  private made: Promise<SelfEngine> | undefined;
  private scheduler: SyncScheduler | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly appliedListeners = new Set<() => void>();
  private state: SelfStatus = { group: null, devices: [], lastSyncedAt: null, lastError: null, held: null, seatId: null, photosMissing: 0 };
  /** Household sharing beside this group (Drop 5): its standby step after each run, its takeover when the seat goes. */
  private household: { afterRun: (engine: SelfEngine) => Promise<void>; takeOver: (lost: string) => Promise<void> } | null = null;
  /**
   * What `prepare` found of a link under way: finished here, a copy that never arrived, or a copy here that could not
   * be made this device's own yet ('incomplete'). Incomplete, the data is the linking device's copy with its identity:
   * neither this channel nor household sharing runs until a later open finishes it (the plan is kept for that).
   */
  joinOutcome: 'linked' | 'failed' | 'incomplete' | null = null;
  private halted = false;

  constructor(options: SelfServiceOptions) {
    this.database = options.database;
    let store: KeyStore | undefined = options.keyStore;
    this.keyStore = () => (store ??= createKeyStore());
    this.transportFor = options.transportFor ?? ((device) => createRelayTransport(requestSignerOf(device)));
    this.info = options.info ?? thisDeviceInfo();
    this.intervalMs = options.intervalMs;
    this.now = options.now ?? Date.now;
    this.photos = options.photos ?? null;
  }

  engine(): Promise<SelfEngine> {
    if (this.joinOutcome === 'incomplete') return Promise.reject(new Error('Linking is not finished on this device yet; it is tried again at the next open.'));
    this.made ??= (async () => {
      const device = await this.keyStore().getOrCreateDevice();
      return new SelfEngine(this.database, this.transportFor(device), device, this.info, this.now);
    })();
    this.made.catch(() => (this.made = undefined));
    return this.made;
  }

  /**
   * At open, before household sharing gets ready: a link under way is finished — the copy that replaced this device's
   * data becomes this device's own — or, when the data here is not that copy (the replace never happened), the plan
   * is dropped and the data is left exactly as it is.
   */
  async prepare(): Promise<void> {
    const plan = readPlan();
    if (!plan) return;
    let where: Awaited<ReturnType<typeof planWaitsHere>>;
    try {
      where = await planWaitsHere(this.database, plan);
    } catch (error) {
      // Not known whether this is the copy: the plan stays for the next open, and nothing runs as this device till then.
      this.joinOutcome = 'incomplete';
      throw error;
    }
    if (where === 'not-the-copy') {
      forgetPlan();
      // The link will not finish: this device leaves the group's relay book it claimed a place in.
      await (await this.engine()).abandonJoin(plan.relayBookId).catch(() => undefined);
      try {
        localStorage.setItem(LINK_FAILED_KEY, '1');
      } catch {
        // said once if it can be kept; the data is as it was either way
      }
      this.joinOutcome = 'failed';
      return;
    }
    try {
      const device = await this.keyStore().getOrCreateDevice();
      const transport = this.transportFor(device);
      this.made = completeLinkedCopy(this.database, plan, transport, device, this.info);
      await this.made;
    } catch (error) {
      this.made = undefined;
      this.joinOutcome = 'incomplete';
      throw error;
    }
    // The copy on the relay has done its work; it goes (a day's expiry would take it anyway).
    await (await this.made).deleteCopy(plan.copy, plan.relayBookId).catch(() => undefined);
    forgetPlan();
    try {
      // A copy from the development sample is no longer a sample here: sync is not held back for it.
      localStorage.removeItem('expanses.dev-sample-loaded');
    } catch {
      // nothing to clear
    }
    this.joinOutcome = 'linked';
  }

  /** Household sharing joins in (bootstrap): standby after each run, and taking over when the seat is unlinked from here. */
  connect(household: { afterRun: (engine: SelfEngine) => Promise<void>; takeOver: (lost: string) => Promise<void> }): void {
    this.household = household;
  }

  async start(): Promise<void> {
    await this.refresh();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
  }

  stop(): void {
    this.scheduler?.stop();
    this.scheduler = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
  }

  /** Stops every run for good: the database is about to be replaced (a link's copy, a restore). */
  halt(): void {
    this.halted = true;
    this.stop();
  }

  private readonly onVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.scheduler?.trigger();
  };

  /** Reads the group and the Devices list; starts or stops the schedule to match. */
  async refresh(): Promise<void> {
    const engine = await this.engine().catch(() => null);
    const group = engine ? await engine.group() : null;
    this.state = { ...this.state, group, devices: engine && group ? await engine.devices() : [], seatId: engine && group ? await engine.seat() : null };
    if (group?.state === 'active' && !this.halted) {
      this.scheduler ??= new SyncScheduler({
        syncOnce: () => this.runOnce(),
        onError: (error) => {
          this.state = { ...this.state, lastError: error instanceof Error ? error.message : String(error) };
          this.emit();
        },
        ...(this.intervalMs === undefined ? {} : { intervalMs: this.intervalMs }),
      });
      this.scheduler.start();
    } else {
      this.scheduler?.stop();
      this.scheduler = null;
    }
    this.emit();
  }

  private async runOnce(): Promise<void> {
    if (this.halted) return;
    const engine = await this.engine();
    const result: SelfSyncResult = await engine.sync();
    const photosMissing = result.unlinked ? this.state.photosMissing : await this.syncPhotos(engine);
    if (!result.unlinked) await this.household?.afterRun(engine).catch((error: unknown) => console.warn('Standing by in shared workspaces failed', error));
    this.state = {
      ...this.state,
      group: await engine.group(),
      devices: await engine.devices(),
      lastSyncedAt: this.now(),
      lastError: null,
      held: result.held ? (result.held.reason === 'clash' ? `clash:${result.held.key}` : result.held.reason) : null,
      photosMissing,
    };
    if (result.applied > 0 || result.unlinked) for (const listener of this.appliedListeners) listener();
    if (result.unlinked) {
      this.scheduler?.stop();
      this.scheduler = null;
    }
    this.emit();
  }

  /**
   * Receipt photos (Drop 4), after the figures: files this device lacks are fetched, files only it holds are sent, and
   * the blobs of files every device holds go from the relay. A batch a run, so a big library never holds up the
   * figures. Answers how many files are still missing here.
   */
  private async syncPhotos(engine: SelfEngine): Promise<number> {
    const me = engine.deviceId;
    if (!this.photos) return photosMissingHere(this.database, me);
    for (const { fileName, manifest } of await photosToFetch(this.database, me)) {
      if (!(await this.photos.readPhotoBytes(fileName))) {
        try {
          await this.photos.putPhotoBytes(fileName, await engine.downloadCopy(manifest));
        } catch {
          continue; // gone from the relay, or not whole: a device that holds it sends it again
        }
      }
      await markPhotoHeld(this.database, fileName, me);
    }
    for (const fileName of await photosToSend(this.database, this.now(), me)) {
      const bytes = await this.photos.readPhotoBytes(fileName);
      if (!bytes) continue;
      try {
        await recordSentPhoto(this.database, fileName, await engine.uploadCopy(bytes, undefined, PHOTO_TTL_MS), me, this.now());
      } catch (error) {
        // The relay holds as much as it takes for now: the rest go once devices have fetched what is there.
        if (error instanceof SyncTransportError && error.status === 413) break;
        throw error;
      }
    }
    for (const { fileName, manifest } of await photosEveryoneHolds(this.database, me)) {
      await engine.deleteCopy(manifest);
      await clearSentPhoto(this.database, fileName);
    }
    return photosMissingHere(this.database, me);
  }

  /** "Something was written here": the group syncs now, behind the screen. */
  nudge(): void {
    void this.scheduler?.trigger();
  }

  /** A whole run that starts now: a run already under way is waited for first, then one more. */
  async syncNow(): Promise<void> {
    if (!this.scheduler) return;
    await this.scheduler.trigger();
    await this.scheduler.trigger();
  }

  status(): SelfStatus {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Told when a run applied what another device wrote: the screens re-read. */
  whenApplied(listener: () => void): () => void {
    this.appliedListeners.add(listener);
    return () => this.appliedListeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /* --------------------------------------------------------------------------------------- linking, both sides */

  async startLinking() {
    const out = await (await this.engine()).startLinking();
    await this.refresh();
    return out;
  }

  async checkLinking(sessionId: string): Promise<SourceStage> {
    return (await this.engine()).checkLinking(sessionId);
  }

  async allowLinking(sessionId: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    await (await this.engine()).allowLinking(sessionId, onProgress);
    await this.refresh();
  }

  async declineLinking(sessionId: string): Promise<void> {
    await (await this.engine()).declineLinking(sessionId);
  }

  async joinWithCode(code: string): Promise<{ sessionId: string }> {
    return (await this.engine()).joinWithCode(code);
  }

  async checkJoining(sessionId: string): Promise<JoinStage> {
    return (await this.engine()).checkJoining(sessionId);
  }

  /**
   * After Allow, on the new device: the copy is fetched, the photos here held from the clean-up, the plan kept, and
   * only then is the data replaced (`replace`). When any step fails before the replace took, the plan is forgotten and
   * this device leaves the group's relay book again: no ghost device holds a place or the log's pruning. A replace
   * that did take keeps its plan, for the next open to finish.
   */
  async takeCopy(
    sessionId: string,
    steps: { onProgress?: (done: number, total: number) => void; onReplacing?: () => void; holdPhotos: () => Promise<unknown>; replace: (bytes: Uint8Array) => Promise<void> },
  ): Promise<void> {
    const engine = await this.engine();
    const plan = await engine.acceptLink(sessionId);
    try {
      const bytes = await engine.downloadPlanCopy(plan, steps.onProgress);
      steps.onReplacing?.();
      await steps.holdPhotos();
      keepPlan(plan);
      await steps.replace(bytes);
    } catch (error) {
      // Only a clean read that the copy is not here drops the plan; a read that fails keeps it for the next open.
      if ((await planWaitsHere(this.database, plan).catch(() => 'unknown' as const)) === 'not-the-copy') {
        forgetPlan();
        await engine.abandonJoin(plan.relayBookId);
      }
      throw error;
    }
  }

  /** After Allow: the plan and the copy. This device's data is untouched until the caller replaces it. */
  async fetchCopy(sessionId: string, onProgress?: (done: number, total: number) => void): Promise<{ plan: JoinPlan; bytes: Uint8Array }> {
    const engine = await this.engine();
    const plan = await engine.acceptLink(sessionId);
    const bytes = await engine.downloadPlanCopy(plan, onProgress);
    return { plan, bytes };
  }

  /**
   * Unlink a lost or sold device. When it was the seat (§3.4), this device becomes the seat and takes over every shared
   * workspace it stands by in (Drop 5), so the household goes on.
   */
  async unlink(deviceId: string): Promise<void> {
    const engine = await this.engine();
    const wasSeat = (await engine.seat()) === deviceId;
    await engine.unlink(deviceId);
    if (wasSeat) {
      await becomeSeat(this.database, engine.deviceId);
      await this.household?.takeOver(deviceId);
    }
    await this.refresh();
  }
}
