import { createWorker } from './bootstrap';

/** The first 16 bytes of every SQLite file: "SQLite format 3" and a NUL. */
const MAGIC = 'SQLite format 3\0';

/** The SAH pool writes a 4096-byte header (HEADER_OFFSET_DATA = SECTOR_SIZE) before the database bytes. */
const DATA_OFFSET = 4096;

/** Enough of the SQLite header to read the page size and the page count. */
const HEADER = 32;

/**
 * Reads the database straight out of the VFS's slot files, without SQLite. Slots are identified by the
 * SQLite magic at DATA_OFFSET rather than by the name the VFS stores, so nothing here depends on how the
 * pool encodes paths. Returns null when there is nothing that looks like a database.
 *
 * This is the escape hatch for the worst case: the worker never starts, so there is no engine to ask for
 * an export, but the bytes are still sitting in OPFS and the user is entitled to them.
 */
export async function salvageBytes(directory = '.expanses'): Promise<Uint8Array | null> {
  if (!navigator.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory().catch(() => null);
  const dir = await root?.getDirectoryHandle(directory).catch(() => null);
  if (!dir) return null;

  let best: Uint8Array | null = null;
  for await (const handle of dir.values()) {
    if (handle.kind !== 'file') continue;
    const file = await (handle as FileSystemFileHandle).getFile().catch(() => null);
    if (!file || file.size <= DATA_OFFSET) continue;

    // The slice starts at the database's own first byte, so every offset below is the offset the SQLite
    // file format gives: page size at bytes 16..17 big-endian, page count at bytes 28..31 big-endian.
    const head = new Uint8Array(await file.slice(DATA_OFFSET, DATA_OFFSET + HEADER).arrayBuffer());
    if (head.byteLength < HEADER) continue;
    if (new TextDecoder().decode(head.subarray(0, 16)) !== MAGIC) continue;

    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    // A page size of 1 means 65536; SQLite stores it that way because the field is only two bytes wide.
    const declared = view.getUint16(16);
    const pageSize = declared === 1 ? 65536 : declared || 4096;
    const pages = view.getUint32(28);
    const length = pageSize * pages;
    // A half-written or short file still hands back everything after the pool's header rather than nothing.
    const usable = length > 0 && DATA_OFFSET + length <= file.size ? length : file.size - DATA_OFFSET;
    const bytes = new Uint8Array(await file.slice(DATA_OFFSET, DATA_OFFSET + usable).arrayBuffer());
    if (!best || bytes.length > best.length) best = bytes;
  }
  return best;
}

type SalvageRequest = { op: 'wipe' } | { op: 'import'; bytes: Uint8Array };

/**
 * One request to a worker of its own, which is then thrown away. The recovery screen never holds the
 * app's database open, so it cannot reuse a connection: it borrows the engine for a single operation.
 */
function askWorker(request: SalvageRequest, transfer: Transferable[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const done = (error?: Error) => {
      worker.terminate();
      if (error) reject(error);
      else resolve();
    };
    worker.onmessage = (event: MessageEvent<{ error?: string }>) => done(event.data.error ? new Error(event.data.error) : undefined);
    worker.onerror = (event) => done(new Error(event.message || 'The database engine did not start.'));
    worker.postMessage({ ...request, id: 1 }, transfer);
  });
}

/** Puts saved bytes back as the live database. The engine checks they are an Expanses file before keeping them. */
export async function restoreBytes(bytes: Uint8Array): Promise<void> {
  const copy = bytes.slice();
  await askWorker({ op: 'import', bytes: copy }, [copy.buffer]);
}

/**
 * Removes everything this app stores on the device, at the user's explicit request and nowhere else.
 * The engine is asked first, because it holds the slot files open; if it will not start, the directory
 * itself is removed, so "start fresh" still works on the device where opening is what breaks.
 */
export async function wipeEverything(directory = '.expanses'): Promise<void> {
  try {
    await askWorker({ op: 'wipe' });
    return;
  } catch (error) {
    if (!navigator.storage?.getDirectory) throw error;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(directory, { recursive: true });
  }
}
