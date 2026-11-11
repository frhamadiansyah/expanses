import { describe, expect, it, vi } from 'vitest';
import { RestoreCancelledError } from '../../../db/restore-sharing';
import { memorySnapshots } from '../../../db/snapshots';
import { restoreContents } from './runner';

const put = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../photos/store', () => ({ photos: { putPhotoBytes: put } }));
vi.mock('../../../photos/hold-before-restore', () => ({ holdPhotosOrRefuse: async () => undefined }));
// Cancel at the sharing warning.
vi.mock('../../../db/restore-sharing', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../db/restore-sharing')>()), sharingGate: () => async () => false }));

/** The smallest bytes that pass as a SQLite file's header: the magic, a page size and a page count that fit. */
function sqliteBytes(): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set(new TextEncoder().encode('SQLite format 3\0'));
  new DataView(bytes.buffer).setUint16(16, 1024);
  new DataView(bytes.buffer).setUint32(28, 1);
  return bytes;
}

describe('an iCloud restore called off at the sharing warning', () => {
  it('replaces nothing, keeps no copy, leaves no note and puts no photo back', async () => {
    const snapshots = memorySnapshots();
    const importBytes = vi.fn(async () => undefined);
    const database = { exportBytes: async () => sqliteBytes(), importBytes } as unknown as Parameters<typeof restoreContents>[1]['database'];
    const contents = { database: sqliteBytes(), photos: [{ name: 'p1.jpg', bytes: new Uint8Array([1, 2, 3]) }] } as unknown as Parameters<typeof restoreContents>[0];
    await expect(restoreContents(contents, { database, safety: { snapshots } as unknown as Parameters<typeof restoreContents>[1]['safety'] })).rejects.toBeInstanceOf(RestoreCancelledError);
    expect(importBytes).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(await snapshots.list()).toEqual([]);
    expect(await snapshots.importMarker!()).toBeNull();
  });
});
