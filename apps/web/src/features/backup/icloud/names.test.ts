import { describe, expect, it } from 'vitest';
import { backupDue, type CloudCopy, copiesToRemove, copyName, KEEP_DAYS, KEEP_MAX, lastOwnCopy, listCopies, parseName, shortDevice } from './names';

const DEVICE = '1A2B3C4D-0000-4000-8000-000000000001';
const OTHER = '9F8E7D6C-0000-4000-8000-000000000002';

const copy = (takenAt: string, device = DEVICE, withPhotos = true, bytes = 2_516_582): CloudCopy => {
  const name = copyName({ takenAt, model: 'iPhone', device, withPhotos, bytes });
  return parseName(name)!;
};

describe('copy names', () => {
  it('round-trip everything the Restore list shows', () => {
    const name = copyName({ takenAt: '2026-10-02T00:12:00.123Z', model: 'iPhone', device: DEVICE, withPhotos: true, bytes: 2_516_582 });
    expect(name).toBe('cicis_20261002T001200Z_iPhone_1a2b3c4d_p_2516582.cicisbackup');
    expect(parseName(name)).toEqual({ name, takenAt: '2026-10-02T00:12:00.000Z', model: 'iPhone', device: '1a2b3c4d', withPhotos: true, bytes: 2_516_582 });
  });

  it('refuse anything that is not one of ours', () => {
    for (const name of ['notes.txt', 'cicis_x_iPhone_1a2b3c4d_p_1.cicisbackup', 'cicis_20261002T001200Z_iPh one_1a2b3c4d_p_1.cicisbackup', 'cicis_20261002T001200Z_iPhone_1a2b3c4d_q_1.cicisbackup'])
      expect(parseName(name)).toBeNull();
  });

  it('keep a model name to letters, so it cannot add a separator', () => {
    expect(copyName({ takenAt: '2026-10-02T00:12:00.000Z', model: 'iPad_Pro 13"', device: DEVICE, withPhotos: false, bytes: 1 })).toContain('_iPadPro_');
  });

  it('list newest first and drop strangers', () => {
    const names = [copy('2026-09-30T00:00:00.000Z').name, 'other.txt', copy('2026-10-02T00:00:00.000Z').name, copy('2026-10-01T00:00:00.000Z').name];
    expect(listCopies(names).map((c) => c.takenAt.slice(0, 10))).toEqual(['2026-10-02', '2026-10-01', '2026-09-30']);
  });
});

describe('which copies are removed', () => {
  const daily = (days: number, device = DEVICE) =>
    Array.from({ length: days }, (_, i) => copy(new Date(Date.UTC(2026, 9, 20 - i, 5)).toISOString(), device));

  it('keeps the last 7 days a device backed up on, and removes older ones', () => {
    const copies = daily(10);
    const removed = copiesToRemove(copies, DEVICE);
    expect(removed).toEqual(copies.slice(KEEP_DAYS).map((c) => c.name));
  });

  it('never touches another device’s copies', () => {
    const copies = [...daily(3), ...daily(12, OTHER)];
    expect(copiesToRemove(copies, DEVICE)).toEqual([]);
  });

  it('counts days with a copy, not calendar days, so a long gap removes nothing', () => {
    const copies = [copy('2026-10-20T05:00:00.000Z'), copy('2026-06-01T05:00:00.000Z'), copy('2026-01-01T05:00:00.000Z')];
    expect(copiesToRemove(copies, DEVICE)).toEqual([]);
  });

  it('keeps several copies on a day with big changes, up to the cap', () => {
    const sameDay = Array.from({ length: KEEP_MAX + 2 }, (_, i) => copy(new Date(Date.UTC(2026, 9, 20, 1, i)).toISOString()));
    const removed = copiesToRemove(sameDay, DEVICE);
    expect(removed).toHaveLength(2);
    // The two oldest go.
    expect(removed).toEqual(listCopies(sameDay.map((c) => c.name)).slice(KEEP_MAX).map((c) => c.name));
  });
});

describe('when a copy is due', () => {
  const now = new Date(2026, 9, 2, 9, 0);
  const base = { enabled: true, hasData: true, bigChange: false, copies: [] as CloudCopy[], device: DEVICE, now };

  it('is due when this device has no copy from today', () => {
    expect(backupDue(base)).toBe(true);
    expect(backupDue({ ...base, copies: [copy(new Date(2026, 9, 1, 23, 59).toISOString())] })).toBe(true);
  });

  it('is not due once today’s copy exists', () => {
    expect(backupDue({ ...base, copies: [copy(new Date(2026, 9, 2, 0, 5).toISOString())] })).toBe(false);
  });

  it('another device’s copy from today does not count', () => {
    expect(backupDue({ ...base, copies: [copy(new Date(2026, 9, 2, 0, 5).toISOString(), OTHER)] })).toBe(true);
  });

  it('a big change makes it due again the same day', () => {
    expect(backupDue({ ...base, bigChange: true, copies: [copy(new Date(2026, 9, 2, 0, 5).toISOString())] })).toBe(true);
  });

  it('is never due with the switch off or nothing to keep', () => {
    expect(backupDue({ ...base, enabled: false })).toBe(false);
    expect(backupDue({ ...base, hasData: false, bigChange: true })).toBe(false);
  });

  it('names this device’s newest copy as the last backup', () => {
    const copies = [copy('2026-10-02T06:00:00.000Z', OTHER), copy('2026-10-01T06:00:00.000Z'), copy('2026-09-30T06:00:00.000Z')];
    expect(lastOwnCopy(copies, DEVICE)?.takenAt).toBe('2026-10-01T06:00:00.000Z');
    expect(shortDevice(DEVICE)).toBe('1a2b3c4d');
  });
});
