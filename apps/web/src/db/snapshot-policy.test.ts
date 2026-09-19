import { describe, expect, it } from 'vitest';
import { dailyDue, keepTwo, parseSnapshotName, roomFor, type SnapshotInfo, snapshotName } from './snapshot-policy';

const snap = (takenAt: string, reason: SnapshotInfo['reason'] = 'daily'): SnapshotInfo => ({
  file: snapshotName(takenAt, 46),
  takenAt,
  schemaVersion: 46,
  bytes: 1_372_160,
  reason,
});

describe('names', () => {
  it('writes a name that can be read back', () => {
    expect(snapshotName('2026-09-18T09:12:00.412Z', 46)).toBe('snapshot-20260918T091200Z-v46.sqlite3');
    expect(parseSnapshotName('snapshot-20260918T091200Z-v46.sqlite3')).toEqual({ takenAt: '2026-09-18T09:12:00.000Z', schemaVersion: 46 });
    expect(parseSnapshotName('sample.sqlite3')).toBeNull();
  });
});

describe('keepTwo', () => {
  it('keeps the two newest and names the rest for deletion', () => {
    const list = [snap('2026-09-16T10:00:00.000Z'), snap('2026-09-17T10:00:00.000Z')];
    const incoming = snap('2026-09-18T10:00:00.000Z', 'before-migration');
    expect(keepTwo(list, incoming).map((s) => s.takenAt)).toEqual(['2026-09-16T10:00:00.000Z']);
  });

  it('never deletes the one just written, whatever the clock says', () => {
    const list = [snap('2027-01-01T10:00:00.000Z'), snap('2027-01-02T10:00:00.000Z')];
    const incoming = snap('2026-09-18T10:00:00.000Z', 'before-migration');
    expect(keepTwo(list, incoming).map((s) => s.file)).not.toContain(incoming.file);
  });

  it('spares a copy taken before Start fresh for seven days', () => {
    const list = [snap('2026-09-10T10:00:00.000Z', 'before-start-fresh'), snap('2026-09-17T10:00:00.000Z')];
    const incoming = snap('2026-09-18T10:00:00.000Z', 'daily');
    expect(keepTwo(list, incoming, new Date('2026-09-15T10:00:00Z'))).toEqual([]);
    expect(keepTwo(list, incoming, new Date('2026-09-30T10:00:00Z')).map((s) => s.reason)).toEqual(['before-start-fresh']);
  });
});

describe('dailyDue', () => {
  const now = new Date('2026-09-18T09:00:00Z');
  it('is due once a calendar day, and not at all without a copy today', () => {
    expect(dailyDue([], now)).toBe(true);
    expect(dailyDue([snap('2026-09-17T23:59:00.000Z')], now)).toBe(true);
    expect(dailyDue([snap('2026-09-18T00:01:00.000Z')], now)).toBe(false);
  });
});

describe('roomFor', () => {
  it('needs three times the database free, and says so honestly when the browser will not estimate', () => {
    expect(roomFor({ quota: 100_000_000, usage: 10_000_000 }, 1_372_160)).toBe('yes');
    expect(roomFor({ quota: 12_000_000, usage: 10_000_000 }, 1_372_160)).toBe('prune-first');
    expect(roomFor({ quota: 10_500_000, usage: 10_000_000 }, 1_372_160)).toBe('no');
    expect(roomFor({}, 1_372_160)).toBe('yes');
  });
});
