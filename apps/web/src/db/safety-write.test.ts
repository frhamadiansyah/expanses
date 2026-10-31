import { describe, expect, it } from 'vitest';
import { hasCreateWritable, writeWithSyncHandle } from './safety-write';

/** A folder holding one file behind a sync access handle that records what was done to it. */
function root(writeShort = false) {
  const log: string[] = [];
  let contents = new Uint8Array([9, 9, 9, 9, 9, 9]);
  const handle = {
    createSyncAccessHandle: async () => ({
      truncate: (size: number) => {
        log.push(`truncate ${size}`);
        contents = contents.slice(0, size);
      },
      write: (bytes: Uint8Array, { at }: { at: number }) => {
        log.push(`write ${bytes.length} at ${at}`);
        contents = bytes.slice();
        return writeShort ? bytes.length - 1 : bytes.length;
      },
      flush: () => void log.push('flush'),
      close: () => void log.push('close'),
    }),
  };
  const folders: string[] = [];
  return {
    log,
    folders,
    contents: () => contents,
    root: {
      getDirectoryHandle: async (name: string) => {
        folders.push(name);
        return { getFileHandle: async () => handle };
      },
    },
  };
}

describe('the write a worker does when createWritable is missing', () => {
  it('empties the file, writes every byte from the start, flushes and closes', async () => {
    const r = root();
    await writeWithSyncHandle(r.root, 'expanses-safety', 'manifest.json', new Uint8Array([1, 2, 3]));
    expect(r.folders).toEqual(['expanses-safety']);
    expect(r.log).toEqual(['truncate 0', 'write 3 at 0', 'flush', 'close']);
    expect(Array.from(r.contents())).toEqual([1, 2, 3]);
  });

  it('fails a short write, and still closes the handle', async () => {
    const r = root(true);
    await expect(writeWithSyncHandle(r.root, 'expanses-safety', 'x', new Uint8Array(10))).rejects.toThrow(/Wrote 9 of 10/);
    expect(r.log.at(-1)).toBe('close');
  });

  it('tells a handle with createWritable from one without', () => {
    expect(hasCreateWritable({ createWritable: () => undefined })).toBe(true);
    expect(hasCreateWritable({})).toBe(false);
    expect(hasCreateWritable(null)).toBe(false);
  });
});
