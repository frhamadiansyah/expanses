import { CORRUPT, ENGINE_START } from './fatal';

export { ENGINE_START };

/**
 * Starting the engine in the worker, and saying honestly when it would not start.
 *
 * Dependency-free like `fatal.ts`, because the worker imports it. The one thing a failed start must never
 * be called is corruption: on a phone the usual cause is the app's previous process still holding the slot
 * files for a moment after an update, and SQLite never saw a byte of them.
 */

/** The waits between tries, in milliseconds. About four seconds in all, well inside the handshake watchdog. */
export const START_RETRY_MS = [250, 500, 1000, 2000];

/**
 * What OPFS says when something else still has a sync access handle on a file: Chromium's
 * NoModificationAllowedError with "Access Handles cannot be created…", WebKit's InvalidStateError.
 */
const HELD = /NoModificationAllowedError|InvalidStateError|Access Handles? cannot be created|modifications are not allowed/i;

/** The pool's own folder and its slot folder: the database, as far as OPFS is concerned. */
const POOL_FOLDERS = ['.expanses', '.opaque'];

/** An error's name and message. A DOMException's message usually leaves its name out, and the name is the clue. */
export function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const { name, message } = error as { name?: unknown; message: unknown };
    const text = String(message);
    return typeof name === 'string' && name && name !== 'Error' && !text.includes(name) ? `${name}: ${text}` : text;
  }
  return String(error);
}

export const engineStartError = (error: unknown): Error => new Error(`${ENGINE_START}${describeError(error)}`);

export const isEngineStart = (message: string): boolean => message.includes(ENGINE_START);

export const isHeld = (message: string): boolean => HELD.test(message);

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `attempt`, then again after each of `delays`. A file SQLite has already called damaged is not tried
 * again: waiting does not mend bytes, and the screen it ends on should come up without the wait.
 */
export async function withRetries<T>(attempt: () => Promise<T>, delays: number[] = START_RETRY_MS, sleep: (ms: number) => Promise<void> = pause): Promise<T> {
  let last: unknown;
  for (let tried = 0; tried <= delays.length; tried += 1) {
    if (tried > 0) await sleep(delays[tried - 1]!);
    try {
      return await attempt();
    } catch (error) {
      last = error;
      if (CORRUPT.test(describeError(error))) break;
    }
  }
  throw last;
}

/**
 * A start that is kept once it works and shared while it runs, but forgotten when it fails, so the next
 * request starts again. The old worker cached its one start for life: one failed install and every request
 * after it failed too, however soon the files were let go.
 */
export function retryable<T>(start: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | null = null;
  return () => {
    if (!current) {
      const running = start();
      current = running;
      running.catch(() => {
        if (current === running) current = null;
      });
    }
    return current;
  };
}

interface ProbeFile {
  kind: 'file';
  createSyncAccessHandle(): Promise<{ close(): void }>;
}
interface ProbeDirectory {
  kind: 'directory';
  values(): AsyncIterable<ProbeFile | ProbeDirectory>;
}

async function probeUnder(dir: ProbeDirectory): Promise<void> {
  // Drained first, so nothing is opened while the directory is still being read.
  const entries: (ProbeFile | ProbeDirectory)[] = [];
  for await (const entry of dir.values()) entries.push(entry);
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      await probeUnder(entry);
      continue;
    }
    // One at a time, each closed before the next is opened, so a held file leaves nothing of ours open.
    const handle = await entry.createSyncAccessHandle();
    handle.close();
  }
}

/**
 * Takes and drops a handle on every slot file before the pool is installed.
 *
 * The pool's own install takes them all at once and, if one is held, tears itself down mid-way — leaving
 * any handle still in flight open in this worker, where it would fail every retry. Found here instead, a
 * held file costs nothing: the throw is retried after a wait.
 */
export async function probeSlots(root: { getDirectoryHandle(name: string): Promise<unknown> }, folder = '.expanses'): Promise<void> {
  const dir = (await root.getDirectoryHandle(folder).catch(() => null)) as ProbeDirectory | null;
  if (dir) await probeUnder(dir);
}

const GUARDED = Symbol.for('expanses.pool-folders-guarded');

/**
 * Stops anything in this worker removing the pool's folders.
 *
 * sqlite-wasm's `installOpfsSAHPoolVfs`, when its pool fails to get ready, calls `removeVfs()`, which removes
 * `.opaque` and `.expanses` recursively — every slot, the database with them. On a phone that is a held
 * handle away. Nothing in this app ever asks the worker to remove either folder (Start fresh empties the
 * slots through `wipeFiles`, and its fallback runs on the main thread), so refusing it here costs nothing.
 */
export function guardPoolFolders(proto: { removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> } | undefined): void {
  if (!proto) return;
  const marked = proto as unknown as Record<symbol, boolean>;
  if (marked[GUARDED]) return;
  const original = proto.removeEntry;
  proto.removeEntry = function guarded(this: unknown, name: string, options?: { recursive?: boolean }) {
    if (POOL_FOLDERS.includes(name)) return Promise.reject(new Error(`Expanses refused to remove ${name}: it holds the database`));
    return original.call(this, name, options);
  };
  marked[GUARDED] = true;
}
