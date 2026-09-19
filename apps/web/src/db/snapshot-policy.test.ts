import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dailyDue, keepOne, keepTwo, parseSnapshotName, roomFor, type SnapshotInfo, snapshotName } from './snapshot-policy';

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

describe('keepOne', () => {
  it('names every older copy when there is only room for the one just written', () => {
    const list = [snap('2026-09-16T10:00:00.000Z'), snap('2026-09-17T10:00:00.000Z')];
    const incoming = snap('2026-09-18T10:00:00.000Z', 'before-migration');
    expect(keepOne(list, incoming).map((s) => s.takenAt)).toEqual(['2026-09-16T10:00:00.000Z', '2026-09-17T10:00:00.000Z']);
  });

  it('never names the one just written, and still spares Start fresh for seven days', () => {
    const grace = snap('2026-09-10T10:00:00.000Z', 'before-start-fresh');
    const incoming = snap('2026-09-18T10:00:00.000Z', 'daily');
    expect(keepOne([grace, incoming], incoming, new Date('2026-09-15T10:00:00Z'))).toEqual([]);
    expect(keepOne([grace], incoming, new Date('2026-09-30T10:00:00Z')).map((s) => s.reason)).toEqual(['before-start-fresh']);
  });
});

describe('dailyDue', () => {
  /*
   * Pinned to the user base's own zone — UTC+7, no DST — because that is the whole point of the change:
   * on a UTC day a Jakarta user's "once a day" rolled over at seven in the morning. Both assertions below
   * come out the other way round when the day is counted in UTC.
   */
  const outside = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Asia/Jakarta';
  });
  afterAll(() => {
    process.env.TZ = outside;
  });

  const now = new Date('2026-09-18T09:00:00Z');
  it('is due once a calendar day, and not at all without a copy today', () => {
    expect(dailyDue([], now)).toBe(true);
    expect(dailyDue([snap('2026-09-17T13:59:00.000Z')], now)).toBe(true); // 20:59 on the 17th, locally
    expect(dailyDue([snap('2026-09-18T00:01:00.000Z')], now)).toBe(false);
  });

  it('counts the day the user is living in, not the one in Greenwich', () => {
    // 01:00 on the 18th in Jakarta, and so is `now` — one local day, two UTC days.
    expect(dailyDue([snap('2026-09-17T18:00:00.000Z')], now)).toBe(false);
    // And the other way: 07:30 on the 18th locally against 03:00 on the 19th — two local days, one UTC day.
    expect(dailyDue([snap('2026-09-18T00:30:00.000Z')], new Date('2026-09-18T20:00:00.000Z'))).toBe(true);
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
