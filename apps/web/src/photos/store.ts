import { uuidv7 } from '@expanses/core';

/**
 * The receipt photos, kept in this device's own storage and nowhere else.
 *
 * Bytes go into OPFS from the main thread, in a directory of this app's own — never through the worker, and
 * never near `.expanses/.opaque/`, where the SQLite SAH pool holds a sync access handle on every slot file it
 * owns. Nothing here uploads, fetches, or hands a photo to a third party: a picture of a receipt is as private
 * as the ledger it belongs to, and the only copy of it that ever exists is the one on this device.
 *
 * A file name here is an OPFS file name, never a `transaction_photos.id`. The two are different identifiers:
 * the name goes in the row's `fileName`, and the id `addPhoto` returns is what a draft's `photoIds` holds.
 */

/** The write side of a `FileSystemWritableFileStream`, narrowed to what this module uses. */
export interface PhotoWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** The slice of `FileSystemFileHandle` this module uses. */
export interface PhotoFileHandle {
  name: string;
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<PhotoWritable>;
}

/** The slice of `FileSystemDirectoryHandle` this module uses. `memory-directory.ts` implements exactly this. */
export interface PhotoDirectory {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<PhotoFileHandle>;
  removeEntry(name: string): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterator<[string, PhotoFileHandle]>;
}

export interface SavedPhoto {
  /** The OPFS file name, for a `transaction_photos.fileName`. */
  fileName: string;
  byteSize: number;
}

export interface PhotoStore {
  savePhotoBytes(bytes: Uint8Array, mime: string): Promise<SavedPhoto>;
  readPhotoBytes(fileName: string): Promise<Uint8Array | null>;
  /**
   * Writes bytes back under a name chosen elsewhere — the restore side of the photo zip. Answers false, and
   * writes nothing, when a file of that name is already here: a restore adds what is missing and never
   * overwrites a picture this device already holds.
   */
  putPhotoBytes(fileName: string, bytes: Uint8Array): Promise<boolean>;
  deletePhotoFile(fileName: string): Promise<void>;
  listPhotoFiles(): Promise<string[]>;
  /**
   * Deletes every photo file no database row names, and answers how many went.
   *
   * `kept` is every file name in the database, from every workspace — or **null**, meaning this database
   * cannot say. Null is not "none": see `sweepOrphanPhotos` below for why the difference is the whole point.
   */
  sweepOrphanPhotos(kept: Iterable<string> | null): Promise<number>;
  /** An object URL for a thumbnail or the full-size view. The caller revokes it. Null when there is no file. */
  photoUrl(fileName: string): Promise<string | null>;
}

/** The app's own directory under the OPFS root. The database's VFS lives in `.expanses/`; these two never meet. */
const PHOTO_DIRECTORY = 'expanses-photos';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** `bin` rather than a guess: an unknown type still gets a file, and the row carries the real mime anyway. */
export const extensionFor = (mime: string): string => EXTENSIONS[mime.toLowerCase().trim()] ?? 'bin';

const MIMES: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS)
    .reverse()
    .map(([mime, extension]) => [extension, mime]),
);

/** What to tell the browser a file is when it is handed back as an object URL, from its name alone. */
const mimeForName = (fileName: string): string => MIMES[fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

const defaultDirectory = async (): Promise<PhotoDirectory> => {
  const root = await navigator.storage.getDirectory();
  return (await root.getDirectoryHandle(PHOTO_DIRECTORY, { create: true })) as unknown as PhotoDirectory;
};

export function makePhotoStore(getDirectory: () => PhotoDirectory | Promise<PhotoDirectory> = defaultDirectory): PhotoStore {
  /*
   * The directory is asked for once and held. Creating it is a write, and every read below would otherwise pay
   * for one; more importantly the getter is a factory, so calling it twice can hand back two different
   * directories and a photo written to the first would be invisible to the second.
   */
  let opened: Promise<PhotoDirectory> | null = null;
  const directory = (): Promise<PhotoDirectory> => {
    if (!opened) {
      opened = (async () => getDirectory())().catch((error: unknown) => {
        // Not remembered: a private window refuses today, but a reload with storage granted should get a
        // directory rather than the refusal cached for the life of the tab.
        opened = null;
        throw error;
      });
    }
    return opened;
  };

  async function readBytes(fileName: string): Promise<Uint8Array | null> {
    const handle = await (await directory()).getFileHandle(fileName);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  const store: PhotoStore = {
    /**
     * The one function here that does not answer empty when OPFS is missing or refused.
     *
     * There is no empty answer it could give. A caller that is handed a file name writes a `transaction_photos`
     * row naming it, and a row naming a file that was never written is a picture the user believes they
     * attached and will never see again. Throwing lets the form say "photos are not available in this window",
     * which is the truth; a quiet success would not be.
     */
    async savePhotoBytes(bytes, mime) {
      const fileName = `${uuidv7()}.${extensionFor(mime)}`;
      const handle = await (await directory()).getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return { fileName, byteSize: bytes.byteLength };
    },

    async readPhotoBytes(fileName) {
      try {
        return await readBytes(fileName);
      } catch {
        return null;
      }
    },

    async putPhotoBytes(fileName, bytes) {
      const dir = await directory();
      try {
        // Present already: the restore leaves it exactly as it is. Reading it is the only way to ask.
        await dir.getFileHandle(fileName);
        return false;
      } catch {
        // Not there — fall through and write it.
      }
      const handle = await dir.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return true;
    },

    async deletePhotoFile(fileName) {
      try {
        await (await directory()).removeEntry(fileName);
      } catch {
        // Already gone, or no OPFS at all. Either way there is nothing left to do and nothing to report.
      }
    },

    async listPhotoFiles() {
      try {
        const dir = await directory();
        const names: string[] = [];
        for await (const [name] of { [Symbol.asyncIterator]: () => dir[Symbol.asyncIterator]() }) names.push(name);
        // Sorted so two runs over the same directory answer the same way; OPFS promises no order.
        return names.sort();
      } catch {
        return [];
      }
    },

    /**
     * Deleting the pictures nothing points at — and refusing to, the moment it cannot tell.
     *
     * A photo has no second copy anywhere: not in the sqlite backup, not on a server, nowhere. So this is the
     * one function in the app that can destroy user data outright, and it is written to be timid.
     *
     * `kept === null` means the database could not say which files are referenced. That happens for real: a
     * device sitting below `LATEST_VERSION` because an update was blocked (`db/open.ts` — a blocked update is
     * a state the app deliberately opens in, not a hypothetical) has no `transaction_photos` table, so it has
     * no list of names. If that were reported as an empty list it would be indistinguishable from "there are
     * genuinely no photos", and this sweep would read "delete every file in the directory" — including the
     * photograph taken thirty seconds ago. So null deletes nothing. A sweep that cannot prove a file is
     * unreferenced leaves it alone: tidying can wait for the next launch, a deleted photo cannot come back.
     */
    async sweepOrphanPhotos(kept) {
      if (kept === null) {
        console.warn('Photos were not swept: this database cannot say which files are in use, so none can be shown to be unused.');
        return 0;
      }
      const keep = new Set(kept);
      let removed = 0;
      // `listPhotoFiles` answers [] where OPFS is missing or will not be read, so a directory that could not
      // be walked sweeps nothing rather than half of something.
      for (const name of await store.listPhotoFiles()) {
        if (keep.has(name)) continue;
        await store.deletePhotoFile(name);
        removed += 1;
      }
      return removed;
    },

    async photoUrl(fileName) {
      const bytes = await store.readPhotoBytes(fileName);
      if (!bytes) return null;
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
      return URL.createObjectURL(new Blob([bytes.slice()], { type: mimeForName(fileName) }));
    },
  };

  return store;
}

/** The app's one photo store, over the device's real OPFS. */
export const photos: PhotoStore = makePhotoStore();
