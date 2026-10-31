import type { ImportMarker, Safety, SnapshotStore } from './open';
import { hasCreateWritable, writeInSafetyWorker } from './safety-write';
import { dailyDue, keepOne, keepTwo, MIN_COPY_BYTES, parseSnapshotName, roomFor, type SnapshotInfo, type SnapshotReason, snapshotName } from './snapshot-policy';

/**
 * Where the safety copies live: a **sibling** of the VFS's `.expanses`, never inside it. The sqlite-wasm
 * docs are explicit that every file in the pool's own directory is assumed to belong to the pool and may
 * be deleted by it, so a copy kept there would be swept away by the very thing it exists to survive.
 */
export const SAFETY_DIR = 'expanses-safety';

/** The file the store's own bookkeeping lives in. Exported so the tests can break it the way a device does. */
export const MANIFEST = 'manifest.json';

/** The note a restore leaves while it rewrites the live file. See `restoreSnapshot`. */
export const IMPORT_MARKER = 'import-in-progress.json';

/** The first 16 bytes of every SQLite file: "SQLite format 3" and a NUL. */
const MAGIC = 'SQLite format 3\0';

/** Enough of the SQLite header to read the page size and the page count. */
const HEADER = 32;

/** There is not even room for one copy. Named, so the caller can say "no space" rather than "it failed". */
export class SnapshotSpaceError extends Error {
  constructor(message = 'There is not enough free space on this device to keep a safety copy.') {
    super(message);
    this.name = 'SnapshotSpaceError';
  }
}

/**
 * `manifest.json`: the truth about what is kept, and the one place a blocked version is recorded.
 * It lives in OPFS rather than in `settings` because the recovery screen must read it on a device where
 * the database is exactly what will not open.
 */
interface Manifest {
  snapshots: SnapshotInfo[];
  /** A schema version that must not be attempted again until the user says so, or a newer build arrives. */
  blockedVersion: number | null;
  /** The highest version the build that set the block knew. A different build's block is not this build's. */
  blockedBuild: number | null;
}

/**
 * The few file operations a store needs, so the OPFS store and the in-memory one used by the unit tests
 * share every rule above them: the same verification, the same pruning, the same manifest fallback.
 */
interface Slot {
  read(file: string): Promise<Uint8Array | null>;
  write(file: string, bytes: Uint8Array): Promise<void>;
  remove(file: string): Promise<void>;
  /** The size of `file` and its first 16 bytes, without reading the rest; null when it is not there. */
  probe(file: string): Promise<{ size: number; head: Uint8Array } | null>;
  names(): Promise<string[]>;
  estimate(): Promise<{ quota?: number; usage?: number }>;
}

/**
 * Whether `bytes` really are the database that was handed over. A copy is not a copy until it has been
 * read back off the device: the length must match what was written, it must start like a SQLite file,
 * and the header's own page arithmetic must fit inside it. Returns what is wrong, or null when nothing is.
 *
 * "Fit inside", not "account for every byte". What the engine hands over is `sah.getSize()` less the
 * pool's header — the size of the *slot*, which is the database's size only until something makes the
 * slot bigger. `importDb` is exactly that: it writes the new database at offset 4096 and never truncates,
 * so a slot that once held a larger file keeps its stale tail until SQLite's next commit trims it. After
 * every Restore and every backup import, therefore, the export is the database followed by rubbish. It is
 * still a whole database — the header says where it ends — and refusing it would switch the safety net
 * off, silently, on precisely the device that has just been through a recovery. A file *shorter* than its
 * own header claims is a different matter: that one is truncated, and is refused.
 */
function whatIsWrongWith(bytes: Uint8Array, expected: number): string | null {
  if (bytes.length !== expected) return `the copy is ${bytes.length} bytes where the database was ${expected}`;
  return headerProblem(bytes);
}

/** The header half of {@link whatIsWrongWith}: everything that can be asked of bytes with no expected length. */
function headerProblem(bytes: Uint8Array): string | null {
  if (bytes.length < Math.max(HEADER, MIN_COPY_BYTES)) return 'the copy is too short to be a database';
  if (new TextDecoder().decode(bytes.subarray(0, 16)) !== MAGIC) return 'the copy does not begin like a SQLite file';
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  // A page size of 1 means 65536; SQLite stores it that way because the field is only two bytes wide.
  const declared = view.getUint16(16);
  const pageSize = declared === 1 ? 65536 : declared;
  const pages = view.getUint32(28);
  if (pageSize * pages > bytes.length) return `the header says ${pages} pages of ${pageSize} bytes, but the copy is only ${bytes.length}`;
  return null;
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function isSnapshotInfo(value: unknown): value is SnapshotInfo {
  const entry = value as Partial<SnapshotInfo> | null;
  return !!entry && typeof entry.file === 'string' && typeof entry.takenAt === 'string' && typeof entry.bytes === 'number' && typeof entry.reason === 'string';
}

async function readManifest(slot: Slot): Promise<Manifest | null> {
  const raw = await slot.read(MANIFEST).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decode(raw)) as Partial<Manifest>;
    if (!Array.isArray(parsed.snapshots)) return null;
    return {
      snapshots: parsed.snapshots.filter(isSnapshotInfo),
      blockedVersion: typeof parsed.blockedVersion === 'number' ? parsed.blockedVersion : null,
      blockedBuild: typeof parsed.blockedBuild === 'number' ? parsed.blockedBuild : null,
    };
  } catch {
    return null;
  }
}

/**
 * What is on the device, read from the file names alone. This is the fallback for a missing or unreadable
 * manifest: a copy must be restorable even when the manifest is the thing that broke.
 *
 * The name carries why the copy was taken, so this answer is the manifest's answer and not a guess. Only a
 * name written before reasons were part of one falls back to the common reason, `before-migration`, which
 * is also the conservative choice for pruning (it claims no grace period).
 */
function fromName(file: string, bytes: number): SnapshotInfo | null {
  const parsed = parseSnapshotName(file);
  if (!parsed) return null;
  return { file, reason: parsed.reason ?? 'before-migration', schemaVersion: parsed.schemaVersion, bytes, takenAt: parsed.takenAt };
}

/**
 * Whether a file on the device is really a copy: at least one page, the size the manifest recorded when it
 * recorded one, and SQLite's own first sixteen bytes. Only the header is read — never the whole file — so
 * listing stays cheap. A write that stopped after the file was made leaves exactly the 0-byte copy this
 * refuses, which the recovery screen used to offer as "the last good copy".
 */
function looksWhole(found: { size: number; head: Uint8Array } | null, recorded?: number): boolean {
  if (!found || found.size < MIN_COPY_BYTES) return false;
  if (recorded !== undefined && found.size !== recorded) return false;
  return decode(found.head.subarray(0, 16)) === MAGIC;
}

async function writeManifest(slot: Slot, manifest: Manifest): Promise<void> {
  await slot.write(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
}

/** Every rule of the store, over whatever `slot` can actually hold files. */
function storeOver(slot: Slot): SnapshotStore {
  /**
   * What is really on the device: the manifest filtered down to the files that are still there, plus
   * every copy on disk the manifest does not mention.
   *
   * The directory is the authority on what exists; the manifest only adds what the names cannot say — why
   * a copy was taken. So a manifest that is missing, unparseable, half-written or from a shape this build
   * changed costs the user nothing: a copy must stay restorable when `manifest.json` is the thing that
   * broke. And an *orphan* — a file written before a crash took the manifest update with it, or one left
   * by a prune that stopped half way — is listed, restorable and, crucially, a pruning candidate. Invisible
   * orphans leaked storage permanently, because nothing could ever name them for deletion.
   */
  const survey = async (): Promise<{ valid: SnapshotInfo[]; invalid: string[] }> => {
    const names = await slot.names();
    const manifest = await readManifest(slot);
    const recorded = new Map((manifest?.snapshots ?? []).map((snapshot) => [snapshot.file, snapshot]));
    const valid: SnapshotInfo[] = [];
    const invalid: string[] = [];
    // The manifest's entries first, in its order; then every copy on disk it does not mention.
    const onDisk = new Set(names);
    const ordered = [...[...recorded.keys()].filter((file) => onDisk.has(file)), ...names.filter((file) => !recorded.has(file))];
    for (const file of ordered) {
      const known = recorded.get(file);
      const info = known ?? fromName(file, 0);
      // Not one of ours: the manifest itself, the failure log, anything else the directory holds.
      if (!info) continue;
      const found = await slot.probe(file).catch(() => null);
      if (!looksWhole(found, known?.bytes)) invalid.push(file);
      else valid.push(known ?? { ...info, bytes: found!.size });
    }
    return { valid, invalid };
  };

  /*
   * A manifest entry whose file is gone is dropped (it must never offer a Restore that cannot happen), and a
   * file that is not whole is left out entirely: not listed, not counted as the day's copy, not kept by
   * pruning, and deleted at the next copy that is written and read back.
   */
  const present = async (): Promise<SnapshotInfo[]> => (await survey()).valid;

  const rewrite = async (snapshots: SnapshotInfo[]): Promise<void> => {
    const manifest = await readManifest(slot);
    await writeManifest(slot, { snapshots, blockedVersion: manifest?.blockedVersion ?? null, blockedBuild: manifest?.blockedBuild ?? null });
  };

  return {
    list: present,

    read: async (file) => {
      const bytes = await slot.read(file);
      if (!bytes) throw new Error('That copy is no longer on this device.');
      return bytes;
    },

    write: async (bytes, reason: SnapshotReason, schemaVersion) => {
      /*
       * `prune-first` says there is room for this copy but not for three. It does NOT mean "delete first":
       * a copy is never deleted before its replacement is on the device and has been read back, or a
       * crash, a full disk or a torn write between the two leaves a user with nothing at all. So the
       * decision is remembered here and acted on below, after the new copy has proved itself — and
       * through `keepOne`, which honours the same seven-day grace for a before-start-fresh copy that
       * `keepTwo` does.
       */
      const room = roomFor(await slot.estimate(), bytes.length);
      if (room === 'no') throw new SnapshotSpaceError();

      const takenAt = new Date().toISOString();
      const file = snapshotName(takenAt, schemaVersion, reason);
      await slot.write(file, bytes);

      // Read back off the device, not trusted because the write resolved.
      const written = await slot.read(file).catch(() => null);
      const wrong = written ? whatIsWrongWith(written, bytes.length) : 'the copy could not be read back';
      if (wrong) {
        // A bad copy must never be advertised as a good one: it goes, and the manifest is left untouched.
        await slot.remove(file).catch(() => undefined);
        throw new Error(`The safety copy did not verify, so it was not kept: ${wrong}`);
      }

      const info: SnapshotInfo = { file, reason, schemaVersion, bytes: bytes.length, takenAt };
      // Written first, pruned second, so there is never a moment with zero copies on the device.
      const { valid, invalid } = await survey();
      const others = valid.filter((snapshot) => snapshot.file !== file);
      const doomed = room === 'prune-first' ? keepOne(others, info) : keepTwo(others, info);
      await rewrite([info, ...others.filter((snapshot) => !doomed.some((gone) => gone.file === snapshot.file))]);
      for (const snapshot of doomed) await slot.remove(snapshot.file).catch(() => undefined);
      // And what was never whole goes too, now that a copy that is has been read back.
      for (const broken of invalid) if (broken !== file) await slot.remove(broken).catch(() => undefined);
      return info;
    },

    /*
     * A block belongs to the build that set it. Asked by a build whose newest migration is not the one that
     * was current when the block was written, the answer is "nothing is blocked": that build ships migrations
     * past the broken one, and it deserves the one attempt this app gave the version before it. Asked with no
     * build at all — by the recovery screen, or a test — the record is reported as it stands.
     *
     * Two things are cleared rather than merely answered around, because a record that can never again be
     * true is worse than none: it feeds the "this update is being skipped" card for ever on a device where
     * the update has long since gone in.
     *
     * - A block a *different* build set is spent the moment this build asks. Leaving it on the device meant
     *   every later launch re-derived "not mine" from a record nothing would ever remove.
     * - A block with no build recorded at all cannot be attributed, so it could be lifted by nothing and was
     *   held against everything. It is dropped on sight.
     */
    blockedVersion: async (build) => {
      const manifest = await readManifest(slot);
      if (!manifest || manifest.blockedVersion === null) return null;
      if (build === undefined) return manifest.blockedVersion;
      if (manifest.blockedBuild === null || manifest.blockedBuild !== build) {
        // Self-healing, and never at the cost of the answer: a store that will not take the write still
        // reports "nothing is blocked", which is the judgement this build has just made.
        await writeManifest(slot, { snapshots: manifest.snapshots, blockedVersion: null, blockedBuild: null }).catch((error: unknown) => {
          console.warn('A spent block could not be cleared from the manifest', error);
        });
        return null;
      }
      return manifest.blockedVersion;
    },
    block: async (version, build) => {
      await writeManifest(slot, { snapshots: await present(), blockedVersion: version, blockedBuild: build });
    },
    unblock: async () => {
      await writeManifest(slot, { snapshots: await present(), blockedVersion: null, blockedBuild: null });
    },

    importMarker: async () => {
      const raw = await slot.read(IMPORT_MARKER).catch(() => null);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(decode(raw)) as Partial<ImportMarker>;
        if (typeof parsed.startedAt !== 'string' || typeof parsed.source !== 'string') return null;
        return { startedAt: parsed.startedAt, source: parsed.source, beforeCopy: typeof parsed.beforeCopy === 'string' ? parsed.beforeCopy : null };
      } catch {
        return null;
      }
    },
    markImport: async (marker) => {
      await slot.write(IMPORT_MARKER, new TextEncoder().encode(JSON.stringify(marker)));
    },
    clearImport: async () => {
      await slot.remove(IMPORT_MARKER).catch(() => undefined);
    },
  };
}

/**
 * One file written whole, or not at all.
 *
 * `getFileHandle(…, { create: true })` puts the name in the directory before a byte is written, so a write
 * that throws — or an app killed — after it leaves an empty file under a valid copy's name. Any failure
 * after the create removes it. (A kill cannot be caught; `looksWhole` keeps that file from ever being listed.)
 *
 * Where this thread has no `createWritable` (WebKit on older iOS), the bytes go to `fallback`: a worker of
 * its own that writes through a sync access handle. See `safety-write.ts`.
 */
export async function writeWhole(
  dir: Pick<FileSystemDirectoryHandle, 'getFileHandle' | 'removeEntry'>,
  file: string,
  bytes: Uint8Array,
  fallback: (folder: string, file: string, bytes: Uint8Array) => Promise<void> = writeInSafetyWorker,
): Promise<void> {
  const handle = await dir.getFileHandle(file, { create: true });
  try {
    if (!hasCreateWritable(handle)) {
      await fallback(SAFETY_DIR, file, bytes);
      return;
    }
    const writable = await handle.createWritable();
    try {
      // A cast, not a copy: lib.dom insists the view sit on an ArrayBuffer rather than an ArrayBufferLike,
      // and re-wrapping fifty megabytes to satisfy it would be the most expensive no-op in the app.
      await writable.write(bytes as Uint8Array<ArrayBuffer>);
    } finally {
      await writable.close();
    }
  } catch (error) {
    await dir.removeEntry(file).catch(() => undefined);
    throw error;
  }
}

async function safetyDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new Error('This browser keeps no private storage for Expanses.');
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(SAFETY_DIR, { create: true });
}

/**
 * The real store: plain OPFS files beside the VFS, written and read from the main thread.
 *
 * Deliberately not in the worker. The copies have to be listable and restorable on the device where the
 * worker is exactly what will not start, which is the only day any of this matters.
 */
export function opfsSnapshots(): SnapshotStore {
  const fileHandle = async (file: string, create = false) => {
    const dir = await safetyDirectory();
    return dir.getFileHandle(file, { create });
  };

  return storeOver({
    read: async (file) => {
      const handle = await fileHandle(file).catch(() => null);
      const found = await handle?.getFile().catch(() => null);
      return found ? new Uint8Array(await found.arrayBuffer()) : null;
    },
    probe: async (file) => {
      const handle = await fileHandle(file).catch(() => null);
      const found = await handle?.getFile().catch(() => null);
      return found ? { size: found.size, head: new Uint8Array(await found.slice(0, 16).arrayBuffer()) } : null;
    },
    write: async (file, bytes) => writeWhole(await safetyDirectory(), file, bytes),
    remove: async (file) => {
      const dir = await safetyDirectory();
      await dir.removeEntry(file);
    },
    names: async () => {
      const dir = await safetyDirectory().catch(() => null);
      if (!dir) return [];
      const names: string[] = [];
      for await (const handle of dir.values()) if (handle.kind === 'file') names.push(handle.name);
      return names;
    },
    estimate: async () => (await navigator.storage?.estimate?.().catch(() => ({}))) ?? {},
  });
}

/**
 * The same store over a Map. Exported for the unit tests, which must exercise the real rules.
 * `files` can be passed in so a test can reach behind the store — to corrupt the manifest, say, which is
 * the one thing no method of the store will do for it.
 */
export function memorySnapshots(
  files = new Map<string, Uint8Array>(),
  /** What `navigator.storage.estimate()` would say, so a test can put the store on a device that is nearly full. */
  estimate: () => Promise<{ quota?: number; usage?: number }> = async () => ({}),
): SnapshotStore {
  return storeOver({
    read: async (file) => files.get(file) ?? null,
    probe: async (file) => {
      const found = files.get(file);
      return found ? { size: found.length, head: found.slice(0, 16) } : null;
    },
    write: async (file, bytes) => {
      files.set(file, bytes.slice());
    },
    remove: async (file) => {
      files.delete(file);
    },
    names: async () => [...files.keys()],
    // No quota to speak of by default, and `roomFor` answers 'yes' to an estimate it cannot read.
    estimate,
  });
}

/**
 * Putting a kept copy back, keeping what it replaces first.
 *
 * Restore overwrites the live database, and what it overwrites is everything the user has entered since
 * that copy was taken. Without this, someone who presses Restore and only then realises the copy was
 * older than they thought has nowhere to go: the bytes they had are gone. So a `before-restore` copy goes
 * down before the live file is touched, and the undo is the newest copy the screen offers next time.
 *
 * Two orderings matter. The chosen bytes are read *first*, because writing a copy can prune, and pruning
 * must never take the file being restored from. And the copy is never a gate: a store with no room, or
 * a device with no readable file, does not stand between a user and their restore — it is warned about
 * and stepped over, the same way the copy before an update is.
 *
 * The schema version is recorded as 0, not guessed. This runs on the screen that never opens the
 * database, so the version inside those bytes is genuinely unknown here, and a number that looks right
 * would be worse than one that plainly says "not known".
 */
export async function restoreSnapshot(deps: {
  snapshots: SnapshotStore;
  /** The kept copy to put back. */
  file: string;
  /** Where the bytes come from, for the note below. The file name when not given. */
  source?: string;
  /** The live bytes about to be replaced, or null when none can be read off the device. */
  live: () => Promise<Uint8Array | null>;
  /** Hands the chosen bytes to the engine. `restoreBytes` in the app. */
  restore: (bytes: Uint8Array) => Promise<void>;
}): Promise<void> {
  const chosen = await deps.snapshots.read(deps.file);
  // Checked before anything is kept or replaced: bytes that are not a whole database would only be refused
  // by the engine afterwards, with a before-restore copy already written that pruned a good one away.
  const wrong = headerProblem(chosen);
  if (wrong) throw new Error(`That copy cannot be put back: ${wrong}.`);
  let beforeCopy: string | null = null;
  try {
    const live = await deps.live();
    if (live?.length) beforeCopy = (await deps.snapshots.write(live, 'before-restore', 0)).file;
  } catch (error) {
    // Warned, not shown: the page reloads the instant the restore below lands, so there is no screen left
    // to tell. What the user loses is the undo, never the restore they asked for.
    console.warn('No copy could be kept of the database being replaced', error);
  }
  /*
   * The engine rewrites the live slot in place, holding the old bytes only in its own memory. An app killed
   * half way leaves a torn file and nothing in memory, so a note goes down first naming the copy just kept;
   * the next launch that cannot open puts that copy first. Removed once the engine answers either way — a
   * refused file is put back by the engine itself. Never a gate, like the copy.
   */
  await deps.snapshots
    .markImport?.({ startedAt: new Date().toISOString(), beforeCopy, source: deps.source ?? deps.file })
    .catch((error: unknown) => console.warn('No note could be left of the restore in progress', error));
  try {
    await deps.restore(chosen);
  } finally {
    await deps.snapshots.clearImport?.().catch(() => undefined);
  }
}

let dailyScheduled = false;

/**
 * The longest the day's copy may be put off waiting for an idle moment that never comes.
 *
 * `requestIdleCallback` promises only that the callback runs *when there is spare time*. It makes no promise
 * that there ever will be. A device that stays busy — a big ledger being read on a slow phone, a browser
 * sharing a loaded machine, a tab the OS has throttled — can defer it for the whole session, and then the
 * day's copy is simply never taken. Nothing says so: "Restore the last good copy" quietly goes on offering
 * whatever the last update left, which may be months old, on exactly the day the file goes wrong.
 *
 * The second argument is the browser's own answer to that: past `timeout` the callback is run regardless of
 * whether the device ever went idle. Two seconds matches the `setTimeout` fallback below, so the copy lands
 * in the same window whichever branch schedules it. It is a ceiling, not a delay — an idle moment inside the
 * two seconds still wins, and the first paint is still never waited on.
 */
const DAILY_COPY_LATEST_MS = 2000;

/**
 * The once-a-day copy. Without it, "Restore the last good copy" after a corruption that no update caused
 * would hand back whatever the last update left, which could be months old.
 *
 * It runs in an idle callback after the first screen has painted, so it never delays a paint — but never
 * later than `DAILY_COPY_LATEST_MS`, so a device that is never idle still gets its copy. It is guarded by a
 * module flag rather than a ref: React's StrictMode mounts twice in development, and two copies of the same
 * database inside a second is a wasted write at best.
 */
export function scheduleDailyCopy(safety: Safety, now: () => Date = () => new Date()): void {
  if (dailyScheduled) return;
  dailyScheduled = true;
  const run = () => {
    void (async () => {
      try {
        if (!dailyDue(await safety.snapshots.list(), now())) return;
        // The version these bytes are really at, not the newest this build could produce: a device holding
        // a blocked update sits below it, and the copy would be listed under a version it does not have.
        await safety.snapshots.write(await safety.bytes(), 'daily', safety.schemaVersion);
      } catch (error) {
        // Nobody's day is interrupted because a safety copy could not be taken; the next open tries again.
        console.warn('The daily safety copy could not be taken', error);
      }
    })();
  };
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: DAILY_COPY_LATEST_MS });
  else setTimeout(run, DAILY_COPY_LATEST_MS);
}
