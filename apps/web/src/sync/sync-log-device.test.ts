import { describe, expect, it } from 'vitest';
import { SnapshotSpaceError } from '../db/snapshots';
import { deviceSyncLog, noteSkippedCopy } from './sync-log-device';

describe('a safety copy skipped for want of room', () => {
  it('is a device-wide entry in the one device log, counted when it happens again', async () => {
    expect(deviceSyncLog()).toBe(deviceSyncLog());
    const error = new SnapshotSpaceError('There is not enough free space on this device for a safety copy beside the older copies being kept.');
    noteSkippedCopy('background', error);
    noteSkippedCopy('background', error);
    noteSkippedCopy('daily', error);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const entries = await deviceSyncLog().entries();
    expect(entries.map((entry) => [entry.op, entry.bookId, entry.name, entry.message, entry.count])).toEqual([
      ['copy', null, 'SnapshotSpaceError', 'No daily copy was taken. There is not enough free space on this device for a safety copy beside the older copies being kept.', 1],
      ['copy', null, 'SnapshotSpaceError', 'No background copy was taken. There is not enough free space on this device for a safety copy beside the older copies being kept.', 2],
    ]);
  });
});
