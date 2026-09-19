import { LATEST_VERSION } from '@expanses/db';
import type { Safety, SnapshotStore } from './open';
import { dailyDue, keepTwo, parseSnapshotName, roomFor, type SnapshotInfo, type SnapshotReason, snapshotName } from './snapshot-policy';

/**
 * Where the safety copies live: a **sibling** of the VFS's `.expanses`, never inside it. The sqlite-wasm
 * docs are explicit that every file in the pool's own directory is assumed to belong to the pool and may
 * be deleted by it, so a copy kept there would be swept away by the very thing it exists to survive.
 */
export const SAFETY_DIR = 'expanses-safety';

const MANIFEST = 'manifest.json';

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
  size(file: string): Promise<number | null>;
  names(): Promise<string[]>;
  estimate(): Promise<{ quota?: number; usage?: number }>;
}

/**
 * Whether `bytes` really are the database that was handed over. A copy is not a copy until it has been
 * read back off the device: the length must match, it must start like a SQLite file, and the header's
 * own page arithmetic must account for every byte. Returns what is wrong, or null when nothing is.
 */
function whatIsWrongWith(bytes: Uint8Array, expected: number): string | null {
  if (bytes.length !== expected) return `the copy is ${bytes.length} bytes where the database was ${expected}`;
  if (bytes.length < HEADER) return 'the copy is too short to be a database';
  if (new TextDecoder().decode(bytes.subarray(0, 16)) !== MAGIC) return 'the copy does not begin like a SQLite file';
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER);
  // A page size of 1 means 65536; SQLite stores it that way because the field is only two bytes wide.
  const declared = view.getUint16(16);
  const pageSize = declared === 1 ? 65536 : declared;
  const pages = view.getUint32(28);
  if (pageSize * pages !== bytes.length) return `the header says ${pages} pages of ${pageSize} bytes, but the copy is ${bytes.length}`;
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
 * manifest: a copy must be restorable even when the manifest is the thing that broke. The name does not
 * carry the reason — only the date and the schema version — so the reason is reported as the common one,
 * `before-migration`, which is also the conservative choice for pruning (it claims no grace period).
 */
async function fromDirectory(slot: Slot): Promise<SnapshotInfo[]> {
  const found: SnapshotInfo[] = [];
  for (const file of await slot.names()) {
    const parsed = parseSnapshotName(file);
    if (!parsed) continue;
    found.push({ file, reason: 'before-migration', schemaVersion: parsed.schemaVersion, bytes: (await slot.size(file)) ?? 0, takenAt: parsed.takenAt });
  }
  return found;
}

async function writeManifest(slot: Slot, manifest: Manifest): Promise<void> {
  await slot.write(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
}

/** Every rule of the store, over whatever `slot` can actually hold files. */
function storeOver(slot: Slot): SnapshotStore {
  /** What is really on the device: the manifest filtered down to the files that are still there. */
  const present = async (): Promise<SnapshotInfo[]> => {
    const manifest = await readManifest(slot);
    const listed = manifest?.snapshots ?? (await fromDirectory(slot));
    const names = new Set(await slot.names());
    // A manifest that names a file which is gone must never offer a Restore that cannot happen.
    return listed.filter((snapshot) => names.has(snapshot.file));
  };

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
      const room = roomFor(await slot.estimate(), bytes.length);
      if (room === 'no') throw new SnapshotSpaceError();
      if (room === 'prune-first') {
        // Room for one more copy but not for three: everything but the newest goes before the new one
        // is written, so the device is never asked for space it has not got.
        const [, ...older] = [...(await present())].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
        for (const snapshot of older) await slot.remove(snapshot.file).catch(() => undefined);
      }

      const takenAt = new Date().toISOString();
      const file = snapshotName(takenAt, schemaVersion);
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
      const others = (await present()).filter((snapshot) => snapshot.file !== file);
      const doomed = keepTwo(others, info);
      await rewrite([info, ...others.filter((snapshot) => !doomed.some((gone) => gone.file === snapshot.file))]);
      for (const snapshot of doomed) await slot.remove(snapshot.file).catch(() => undefined);
      return info;
    },

    /*
     * A block belongs to the build that set it. Asked by a build whose newest migration is not the one that
     * was current when the block was written, the answer is "nothing is blocked": that build ships migrations
     * past the broken one, and it deserves the one attempt this app gave the version before it. Asked with no
     * build at all — by the recovery screen, or a test — the record is reported as it stands.
     */
    blockedVersion: async (build) => {
      const manifest = await readManifest(slot);
      if (!manifest || manifest.blockedVersion === null) return null;
      if (build !== undefined && manifest.blockedBuild !== null && manifest.blockedBuild !== build) return null;
      return manifest.blockedVersion;
    },
    block: async (version, build) => {
      await writeManifest(slot, { snapshots: await present(), blockedVersion: version, blockedBuild: build });
    },
    unblock: async () => {
      await writeManifest(slot, { snapshots: await present(), blockedVersion: null, blockedBuild: null });
    },
  };
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
    size: async (file) => {
      const handle = await fileHandle(file).catch(() => null);
      const found = await handle?.getFile().catch(() => null);
      return found ? found.size : null;
    },
    write: async (file, bytes) => {
      const handle = await fileHandle(file, true);
      const writable = await handle.createWritable();
      try {
        // A cast, not a copy: lib.dom insists the view sit on an ArrayBuffer rather than an ArrayBufferLike,
        // and re-wrapping fifty megabytes to satisfy it would be the most expensive no-op in the app.
        await writable.write(bytes as Uint8Array<ArrayBuffer>);
      } finally {
        await writable.close();
      }
    },
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

/** The same store over a Map. Exported for the unit tests, which must exercise the real rules. */
export function memorySnapshots(): SnapshotStore {
  const files = new Map<string, Uint8Array>();
  return storeOver({
    read: async (file) => files.get(file) ?? null,
    size: async (file) => files.get(file)?.length ?? null,
    write: async (file, bytes) => {
      files.set(file, bytes.slice());
    },
    remove: async (file) => {
      files.delete(file);
    },
    names: async () => [...files.keys()],
    // No quota to speak of, and `roomFor` answers 'yes' to an estimate it cannot read.
    estimate: async () => ({}),
  });
}

let dailyScheduled = false;

/**
 * The once-a-day copy. Without it, "Restore the last good copy" after a corruption that no update caused
 * would hand back whatever the last update left, which could be months old.
 *
 * It runs in an idle callback after the first screen has painted, so it never delays a paint, and it is
 * guarded by a module flag rather than a ref: React's StrictMode mounts twice in development, and two
 * copies of the same database inside a second is a wasted write at best.
 */
export function scheduleDailyCopy(safety: Safety, now: () => Date = () => new Date()): void {
  if (dailyScheduled) return;
  dailyScheduled = true;
  const run = () => {
    void (async () => {
      try {
        if (!dailyDue(await safety.snapshots.list(), now())) return;
        await safety.snapshots.write(await safety.bytes(), 'daily', LATEST_VERSION);
      } catch (error) {
        // Nobody's day is interrupted because a safety copy could not be taken; the next open tries again.
        console.warn('The daily safety copy could not be taken', error);
      }
    })();
  };
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
  if (idle) idle(run);
  else setTimeout(run, 2000);
}
