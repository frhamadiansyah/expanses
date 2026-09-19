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
  /** Answers whether the file really went. False is "it may still be there", never "there was nothing to do". */
  deletePhotoFile(fileName: string): Promise<boolean>;
  listPhotoFiles(): Promise<string[]>;
  /**
   * Deletes every photo file no database row names, and answers how many went.
   *
   * `kept` is every file name in the database, from every workspace — or **null**, meaning this database
   * cannot say. Null is not "none": see `sweepOrphanPhotos` below for why the difference is the whole point.
   */
  sweepOrphanPhotos(kept: readonly string[] | null): Promise<number>;
  /**
   * Puts every photo now on this device beyond the sweep's reach, and answers which names are held.
   *
   * Called immediately before a restore replaces the database. See `sweepOrphanPhotos` for why.
   */
  holdPhotosBeforeRestore(): Promise<readonly string[]>;
  /** An object URL for a thumbnail or the full-size view. The caller revokes it. Null when there is no file. */
  photoUrl(fileName: string): Promise<string | null>;
}

/** The app's own directory under the OPFS root. The database's VFS lives in `.expanses/`; these two never meet. */
const PHOTO_DIRECTORY = 'expanses-photos';

/**
 * The names the sweep is forbidden to touch, kept on the device rather than in the data.
 *
 * It has to outlive the database it protects photos from — a restore replaces the whole file — so the one
 * place it cannot live is inside it. `localStorage` is where this app already keeps the other facts that are
 * about this device rather than about the user's money (`features/backup/reminder-state.ts`).
 */
export interface SweepShield {
  /** The names to spare. **Throws** when this device cannot say — which stands the sweep down entirely. */
  read(): readonly string[];
  write(names: readonly string[]): void;
}

/** Where the hold is written on a real device. Namespaced like the other keys this app owns. */
const SHIELD_KEY = 'expanses.photos.held-before-restore';

const deviceShield: SweepShield = {
  read() {
    // No web storage at all (a test runner, an odd embedding) is not a corrupt answer: there is nothing held
    // because nothing could ever have been written. A storage that exists and throws *is* an unreadable
    // answer, and it is allowed to propagate.
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SHIELD_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('The list of held photos is not a list.');
    return parsed.filter((name): name is string => typeof name === 'string');
  },
  write(names) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SHIELD_KEY, JSON.stringify([...names]));
  },
};

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

export function makePhotoStore(
  getDirectory: () => PhotoDirectory | Promise<PhotoDirectory> = defaultDirectory,
  shield: SweepShield = deviceShield,
): PhotoStore {
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

    /**
     * Answers whether the file really went.
     *
     * The failures are still swallowed — a caller asking for a picture to go has nothing useful to do about
     * a directory that will not take the instruction — but they are no longer reported as successes. A
     * read-only directory used to leave the sweep saying it had removed a file that is still on the device,
     * and a count that overstates is worse than none: it is what a later "nothing left to sweep" would trust.
     */
    async deletePhotoFile(fileName) {
      try {
        await (await directory()).removeEntry(fileName);
        return true;
      } catch {
        // Already gone, refused, or no OPFS at all. This cannot tell which, so it does not claim one.
        return false;
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
     * There are three ways this can fail to prove it, and each one deletes nothing.
     *
     * **1. The database cannot say.** `kept === null`. That happens for real: a device sitting below
     * `LATEST_VERSION` because an update was blocked (`db/open.ts` — a blocked update is a state the app
     * deliberately opens in, not a hypothetical) has no `transaction_photos` table, so it has no list of
     * names. If that were reported as an empty list it would be indistinguishable from "there are genuinely
     * no photos", and this sweep would read "delete every file in the directory" — including the photograph
     * taken thirty seconds ago.
     *
     * **2. The caller did not hand over a list at all.** `undefined` is not `null`, and — the one that
     * actually type-checked — a bare `string` is an `Iterable<string>`, so `sweepOrphanPhotos(row.fileName)`
     * used to compile and turn into a set of *characters* that matches no file name on earth. The parameter
     * is now `readonly string[] | null`, and the guard asks what the value is rather than what it is not.
     *
     * **3. The database is out of date, because a restore just replaced it.** This is the one that cost a
     * photograph: restore a backup taken before a picture was attached and every picture since is, to that
     * database, an orphan. The row comes back the moment the newer backup is restored; the photograph never
     * does, because it has no second copy anywhere. So a restore writes down what is on the device first
     * (`holdPhotosBeforeRestore`), and those names are spared until some database in use names one — at
     * which point the hold on it is let go, because a file a live database names is no longer at risk from
     * the restore that put it there. If the hold itself cannot be read, that is a fourth way of not knowing,
     * and it too deletes nothing.
     *
     * Tidying can wait for the next launch. A deleted photo cannot come back.
     */
    async sweepOrphanPhotos(kept) {
      if (kept == null || typeof kept === 'string') {
        console.warn('Photos were not swept: this database cannot say which files are in use, so none can be shown to be unused.');
        return 0;
      }
      let held: readonly string[];
      try {
        held = shield.read();
      } catch (error) {
        console.warn('Photos were not swept: this device cannot say which photos a restore is still holding.', error);
        return 0;
      }
      const keep = new Set(kept);
      const stillHeld = held.filter((name) => !keep.has(name));
      if (stillHeld.length !== held.length) {
        try {
          shield.write(stillHeld);
        } catch (error) {
          // The hold not shrinking costs nothing but a little tidying, so it is never worth failing over.
          console.warn('The list of held photos could not be shortened', error);
        }
      }
      const holding = new Set(stillHeld);
      let removed = 0;
      // `listPhotoFiles` answers [] where OPFS is missing or will not be read, so a directory that could not
      // be walked sweeps nothing rather than half of something.
      for (const name of await store.listPhotoFiles()) {
        if (keep.has(name) || holding.has(name)) continue;
        if (await store.deletePhotoFile(name)) removed += 1;
      }
      return removed;
    },

    /**
     * What a restore does before it replaces the database: write down every photo on the device.
     *
     * The database restore already forces a safety copy of the data it is about to overwrite. The pictures —
     * the one thing in this app with no second copy anywhere — used to get nothing, and the sweep that ran
     * on the very next load was pointed at a database that had never heard of them. This is their equivalent
     * step, and it is cheaper than a copy: nothing is duplicated, the files are simply put out of reach.
     */
    async holdPhotosBeforeRestore() {
      const here = await store.listPhotoFiles();
      let held: readonly string[] = [];
      try {
        held = shield.read();
      } catch {
        // Unreadable, so it is replaced rather than added to. What is on the device right now is what matters.
      }
      const names = [...new Set([...held, ...here])].sort();
      shield.write(names);
      return names;
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
