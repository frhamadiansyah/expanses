import type { PhotoDirectory, PhotoFileHandle, PhotoWritable } from './store';

/**
 * A tiny in-memory stand-in for the slice of `FileSystemDirectoryHandle` that `store.ts` actually uses.
 *
 * It exists so the photo store can be tested without OPFS, which no test runner here has. Nothing in the app
 * imports it: it is a test dependency, and the shapes it implements are the narrow ones `store.ts` declares,
 * so if the store ever asks a directory for something new this file stops compiling rather than quietly
 * diverging from the real thing.
 *
 * The behaviours copied from OPFS on purpose, because the store leans on them:
 * - `getFileHandle(name)` without `{ create: true }` rejects when the file is not there, which is how
 *   `readPhotoBytes` learns a name it was given no longer names anything.
 * - `removeEntry(name)` rejects for a name that is not there, rather than shrugging.
 */
export function memoryDirectory(files: Map<string, Uint8Array> = new Map()): PhotoDirectory {
  const handleFor = (name: string): PhotoFileHandle => ({
    name,
    async getFile() {
      const bytes = files.get(name);
      if (!bytes) throw new Error(`NotFoundError: ${name}`);
      // A copy, so a caller that keeps the buffer cannot reach back into the directory's own bytes.
      const copy = bytes.slice();
      return { size: copy.byteLength, arrayBuffer: async () => copy.buffer as ArrayBuffer };
    },
    async createWritable() {
      const chunks: Uint8Array[] = [];
      const writable: PhotoWritable = {
        async write(data: Uint8Array) {
          chunks.push(data.slice());
        },
        async close() {
          let size = 0;
          for (const chunk of chunks) size += chunk.byteLength;
          const joined = new Uint8Array(size);
          let cursor = 0;
          for (const chunk of chunks) {
            joined.set(chunk, cursor);
            cursor += chunk.byteLength;
          }
          files.set(name, joined);
        },
      };
      return writable;
    },
  });

  return {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new Error(`NotFoundError: ${name}`);
      return handleFor(name);
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new Error(`NotFoundError: ${name}`);
    },
    async *[Symbol.asyncIterator]() {
      // A snapshot of the names, so a caller that deletes while iterating — which the sweep does — is not
      // iterating a map it is mutating.
      for (const name of [...files.keys()]) yield [name, handleFor(name)] as [string, PhotoFileHandle];
    },
  };
}
