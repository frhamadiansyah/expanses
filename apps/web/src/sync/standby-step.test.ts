import { SyncTransportError } from '@expanses/db';
import { describe, expect, it, vi } from 'vitest';
import { removeGone } from './standby-step';

/*
 * Link my devices, review fix C: taking unlinked devices out of shared workspaces goes item by item. One failure holds
 * up none of the others; one the relay no longer has is done (its removal read in). Invented ids.
 */
describe('taking unlinked devices out of shared workspaces', () => {
  it('carries on past a failure, and takes a device the relay no longer has as done', async () => {
    const removed: string[] = [];
    const synced: string[] = [];
    const household = {
      removeDevice: vi.fn(async (bookId: string, deviceId: string) => {
        if (bookId === 'book-a') throw new Error('offline');
        if (bookId === 'book-b') throw new SyncTransportError(404, 'no such device');
        removed.push(`${bookId}:${deviceId}`);
      }),
      syncOnce: vi.fn(async (bookId: string) => void synced.push(bookId)),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await removeGone(household, [
      { bookId: 'book-a', deviceId: 'mac' },
      { bookId: 'book-b', deviceId: 'mac' },
      { bookId: 'book-c', deviceId: 'mac' },
    ]);
    expect(household.removeDevice).toHaveBeenCalledTimes(3);
    expect(removed).toEqual(['book-c:mac']);
    expect(synced).toEqual(['book-b']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
