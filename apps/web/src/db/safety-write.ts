/**
 * Writing one file in `expanses-safety/` when the main thread has no `createWritable`.
 *
 * The app's minimum is iOS 17, and WebKit there may not have `FileSystemFileHandle.createWritable`. Every
 * safety copy, the manifest, the failure log and the restore note would then throw after their file had been
 * created — the empty copies this branch exists to stop. A sync access handle does the same write, but only
 * in a worker, so the write goes to a small worker of its own: never the database worker, because the copies
 * must still be writable on the day that engine will not start.
 *
 * Dependency-free: the worker imports `writeWithSyncHandle` from here.
 */

/** A handle with a sync access handle on it, as much of one as the write needs. */
interface SyncWritable {
  createSyncAccessHandle(): Promise<{
    truncate(size: number): void;
    write(bytes: Uint8Array, options: { at: number }): number;
    flush(): void;
    close(): void;
  }>;
}

/** The write the worker does: open, empty, write every byte, flush, close. Throws on a short write. */
export async function writeWithSyncHandle(
  root: { getDirectoryHandle(name: string, options: { create: boolean }): Promise<{ getFileHandle(name: string, options: { create: boolean }): Promise<unknown> }> },
  folder: string,
  file: string,
  bytes: Uint8Array,
): Promise<void> {
  const dir = await root.getDirectoryHandle(folder, { create: true });
  const handle = (await dir.getFileHandle(file, { create: true })) as SyncWritable;
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    const wrote = access.write(bytes, { at: 0 });
    if (wrote !== bytes.length) throw new Error(`Wrote ${wrote} of ${bytes.length} bytes`);
    access.flush();
  } finally {
    access.close();
  }
}

/** Whether this thread can write a file the ordinary way. */
export function hasCreateWritable(handle: unknown): boolean {
  return typeof (handle as { createWritable?: unknown } | null)?.createWritable === 'function';
}

/** Long enough for a large copy on a slow phone; a worker that never answers must not hold a restore for ever. */
const WORKER_WRITE_MS = 60_000;

/**
 * `file` in `folder`, written by a worker that lives for this one write. Rejects with the worker's own words,
 * or after `WORKER_WRITE_MS`; the caller removes the file either way.
 */
export function writeInSafetyWorker(folder: string, file: string, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./safety-writer.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => done(new Error('The safety copy could not be written in time')), WORKER_WRITE_MS);
    function done(error?: Error) {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve();
    }
    worker.onmessage = (event: MessageEvent<{ error?: string }>) => done(event.data.error ? new Error(event.data.error) : undefined);
    worker.onerror = (event) => done(new Error(event.message || 'The safety copy writer did not start'));
    // Copied rather than transferred: the caller still holds these bytes, to read the copy back against.
    worker.postMessage({ folder, file, bytes });
  });
}
