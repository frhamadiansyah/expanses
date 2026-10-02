import { describe, expect, it } from 'vitest';
import { copyName, listCopies } from './names';
import type { ICloudBackupPlugin } from './plugin';
import { backUpIfDue, backUpNow, ICloudUnavailableError, openCopy } from './service';

const DEVICE = '1A2B3C4D-0000-4000-8000-000000000001';

function fakeICloud(options: { available?: boolean; keys?: Record<string, string> } = {}) {
  const files = new Map<string, string>();
  const keys = new Map(Object.entries(options.keys ?? {}));
  const plugin: ICloudBackupPlugin = {
    status: async () => ({ available: options.available ?? true, deviceId: DEVICE, model: 'iPhone' }),
    list: async () => ({ names: [...files.keys()] }),
    write: async ({ name, base64 }) => {
      files.set(name, base64);
      return { bytes: base64.length };
    },
    read: async ({ name }) => {
      const base64 = files.get(name);
      if (!base64) throw Object.assign(new Error('gone'), { code: 'not_found' });
      return { base64 };
    },
    remove: async ({ name }) => {
      files.delete(name);
    },
    key: async (asked) => {
      if (asked?.keyId) {
        const key = keys.get(asked.keyId);
        if (!key) throw Object.assign(new Error('no key'), { code: 'no_key' });
        return { keyId: asked.keyId, key };
      }
      const first = [...keys.entries()][0];
      if (first) return { keyId: first[0], key: first[1] };
      const made = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      keys.set('made', made);
      return { keyId: 'made', key: made };
    },
    openSettings: async () => {},
  };
  return { plugin, files, keys };
}

const source = {
  database: async () => new TextEncoder().encode('SQLite format 3\0'.padEnd(120, 'x')),
  counts: async () => ({ accounts: 14, transactions: 3218 }),
  photoNames: async () => ['a.jpg', 'gone.jpg'],
  readPhoto: async (name: string) => (name === 'gone.jpg' ? null : new Uint8Array([1, 2, 3])),
};

describe('backing up to iCloud', () => {
  it('writes one locked copy that opens to the data, the summary and the photos', async () => {
    const icloud = fakeICloud();
    const copy = await backUpNow(icloud.plugin, source, { withPhotos: true, now: new Date('2026-10-02T00:12:00.000Z') });
    expect(copy).toMatchObject({ takenAt: '2026-10-02T00:12:00.000Z', model: 'iPhone', withPhotos: true });
    expect([...icloud.files.keys()]).toEqual([copy.name]);
    const opened = await openCopy(icloud.plugin, copy.name);
    expect(new TextDecoder().decode(opened.database).startsWith('SQLite format 3')).toBe(true);
    expect(opened.summary).toEqual({ takenAt: '2026-10-02T00:12:00.000Z', model: 'iPhone', accounts: 14, transactions: 3218, photos: 1 });
    expect(opened.photos.map((p) => p.name)).toEqual(['a.jpg']);
  });

  it('leaves the photos out when asked', async () => {
    const icloud = fakeICloud();
    const copy = await backUpNow(icloud.plugin, source, { withPhotos: false });
    expect(copy.withPhotos).toBe(false);
    expect((await openCopy(icloud.plugin, copy.name)).photos).toEqual([]);
  });

  it('removes this device’s copies past the last 7 days after writing', async () => {
    const icloud = fakeICloud();
    for (let day = 1; day <= 9; day += 1) await backUpNow(icloud.plugin, source, { withPhotos: false, now: new Date(Date.UTC(2026, 8, day, 5)) });
    const left = listCopies([...icloud.files.keys()]);
    expect(left).toHaveLength(7);
    expect(left.at(-1)?.takenAt).toBe('2026-09-03T05:00:00.000Z');
  });

  it('says iCloud is off rather than failing quietly', async () => {
    await expect(backUpNow(fakeICloud({ available: false }).plugin, source, { withPhotos: true })).rejects.toBeInstanceOf(ICloudUnavailableError);
  });

  it('explains a copy whose key has not reached this device', async () => {
    const icloud = fakeICloud();
    const copy = await backUpNow(icloud.plugin, source, { withPhotos: false });
    icloud.keys.clear();
    await expect(openCopy(icloud.plugin, copy.name)).rejects.toThrow(/iCloud Keychain/);
  });

  it('runs once a day, again after a big change, and never with nothing to keep', async () => {
    const icloud = fakeICloud();
    const now = new Date(2026, 9, 2, 9);
    const state = { enabled: true, withPhotos: false, hasData: true, bigChange: false, now };
    expect(await backUpIfDue(icloud.plugin, source, state)).toBe(true);
    expect(await backUpIfDue(icloud.plugin, source, { ...state, now: new Date(2026, 9, 2, 10) })).toBe(false);
    expect(await backUpIfDue(icloud.plugin, source, { ...state, bigChange: true, now: new Date(2026, 9, 2, 11) })).toBe(true);
    expect(await backUpIfDue(icloud.plugin, source, { ...state, hasData: false, now: new Date(2026, 9, 3, 9) })).toBe(false);
    expect(icloud.files.size).toBe(2);
  });

  it('ignores files in the folder that are not ours', async () => {
    const icloud = fakeICloud();
    icloud.files.set('cicis_garbage.cicisbackup', 'AAAA');
    icloud.files.set(copyName({ takenAt: new Date(2026, 9, 2, 1).toISOString(), model: 'iPhone', device: 'someone-else', withPhotos: true, bytes: 1 }), 'AAAA');
    expect(await backUpIfDue(icloud.plugin, source, { enabled: true, withPhotos: false, hasData: true, bigChange: false, now: new Date(2026, 9, 2, 9) })).toBe(true);
  });
});
