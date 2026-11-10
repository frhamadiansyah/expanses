import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dailyDue, keepOne, keepTwo, parseSnapshotName, roomFor, type SnapshotInfo, snapshotName } from './snapshot-policy';

const snap = (takenAt: string, reason: SnapshotInfo['reason'] = 'daily'): SnapshotInfo => ({
  file: snapshotName(takenAt, 46, reason),
  takenAt,
  schemaVersion: 46,
  bytes: 1_372_160,
  reason,
});

describe('names', () => {
  it('writes a name that can be read back', () => {
    expect(snapshotName('2026-09-18T09:12:00.412Z', 46, 'before-migration')).toBe('snapshot-20260918T091200Z-v46-before-migration.sqlite3');
    expect(parseSnapshotName('snapshot-20260918T091200Z-v46-before-migration.sqlite3')).toEqual({
      takenAt: '2026-09-18T09:12:00.000Z',
      schemaVersion: 46,
      reason: 'before-migration',
    });
    expect(parseSnapshotName('sample.sqlite3')).toBeNull();
  });

  /**
   * The reason is in the name so that the directory can answer without the manifest. Read back as
   * `before-migration`, a copy taken before a restore would be offered as "the last good copy" on the one
   * device where the manifest is what broke — and that copy is a copy of whatever was just replaced.
   */
  it('carries why the copy was taken, and still reads a name written before it did', () => {
    for (const reason of ['before-migration', 'before-restore', 'before-start-fresh', 'daily'] as const) {
      expect(parseSnapshotName(snapshotName('2026-09-18T09:12:00.412Z', 46, reason))?.reason).toBe(reason);
    }
    // An older build's name: still a copy, still restorable, only the reason unknown.
    expect(parseSnapshotName('snapshot-20260918T091200Z-v46.sqlite3')).toMatchObject({ schemaVersion: 46, reason: null });
    // And nothing that merely looks close is taken for one of ours.
    expect(parseSnapshotName('snapshot-20260918T091200Z-v46-before-lunch.sqlite3')).toBeNull();
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

describe('keepTwo, against a copy far smaller than the one it would replace', () => {
  const sized = (takenAt: string, bytes: number, reason: SnapshotInfo['reason'] = 'daily'): SnapshotInfo => ({ ...snap(takenAt, reason), bytes });

  it('keeps the largest copy when the new one is less than half its size', () => {
    const big = sized('2026-09-15T10:00:00.000Z', 8_000_000);
    const list = [big, sized('2026-09-16T10:00:00.000Z', 900_000), sized('2026-09-17T10:00:00.000Z', 900_000)];
    const incoming = sized('2026-09-18T10:00:00.000Z', 900_000);
    expect(keepTwo(list, incoming).map((s) => s.takenAt)).toEqual(['2026-09-16T10:00:00.000Z']);
  });

  it('lets it go when the new copy is about the same size', () => {
    const list = [sized('2026-09-15T10:00:00.000Z', 1_000_000), sized('2026-09-16T10:00:00.000Z', 900_000), sized('2026-09-17T10:00:00.000Z', 900_000)];
    const incoming = sized('2026-09-18T10:00:00.000Z', 600_000);
    expect(keepTwo(list, incoming).map((s) => s.takenAt)).toEqual(['2026-09-16T10:00:00.000Z', '2026-09-15T10:00:00.000Z']);
  });

  it('does not hold on to a large copy taken before a restore: that one is the undo, not a good copy', () => {
    const list = [sized('2026-09-15T10:00:00.000Z', 8_000_000, 'before-restore'), sized('2026-09-16T10:00:00.000Z', 900_000), sized('2026-09-17T10:00:00.000Z', 900_000)];
    const incoming = sized('2026-09-18T10:00:00.000Z', 900_000);
    expect(keepTwo(list, incoming).map((s) => s.reason)).toEqual(['daily', 'before-restore']);
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

describe('copies taken when the app goes to the background', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 9, minute)).toISOString();
  /** What the store does after each write: the incoming copy joins, and whatever the rule names goes. */
  const write = (list: SnapshotInfo[], incoming: SnapshotInfo, rule = keepTwo): SnapshotInfo[] => {
    const doomed = new Set(rule(list, incoming, new Date(incoming.takenAt)).map((s) => s.file));
    return [incoming, ...list.filter((s) => !doomed.has(s.file))];
  };

  it('are named for their reason, and a name an older build wrote still reads', () => {
    const name = snapshotName('2026-11-10T09:12:00.412Z', 108, 'background');
    expect(name).toBe('snapshot-20261110T091200Z-v108-background.sqlite3');
    expect(parseSnapshotName(name)).toEqual({ takenAt: '2026-11-10T09:12:00.000Z', schemaVersion: 108, reason: 'background' });
    expect(parseSnapshotName('snapshot-20261110T091200Z-v108.sqlite3')).toMatchObject({ reason: null });
    expect(parseSnapshotName('snapshot-20261110T091200Z-v108-daily.sqlite3')).toMatchObject({ reason: 'daily' });
  });

  /**
   * An older build's pattern, as it shipped: the reasons before `background` existed. It does not match a
   * background copy's name at all, so that build's survey skips the file as "not one of ours" — never listed,
   * never offered, never pruned — and since a background copy is never written into the manifest either, an
   * older build installed over this one simply does not see it.
   */
  it('are invisible to an older build, which does not recognise the name', () => {
    const older = /^snapshot-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-v(\d+)(?:-(before-migration|before-restore|before-start-fresh|before-delete|daily))?\.sqlite3$/;
    expect(older.test(snapshotName('2026-11-10T09:12:00.000Z', 108, 'background'))).toBe(false);
    expect(older.test(snapshotName('2026-11-10T09:12:00.000Z', 108, 'daily'))).toBe(true);
  });

  it('ten in a row leave one of them, and the daily and before-update copies untouched', () => {
    const update = snap(at(0), 'before-migration');
    const daily = snap(at(1), 'daily');
    let list = [daily, update];
    for (let i = 0; i < 10; i += 1) list = write(list, snap(at(10 + i * 11), 'background'));
    const background = list.filter((s) => s.reason === 'background');
    expect(background.map((s) => s.takenAt)).toEqual([at(10 + 9 * 11)]);
    expect(list.filter((s) => s.reason !== 'background').map((s) => s.file).sort()).toEqual([daily.file, update.file].sort());
  });

  it('never cost a before-restore copy its place either', () => {
    const undo = snap(at(0), 'before-restore');
    const daily = snap(at(1), 'daily');
    let list = [daily, undo];
    for (let i = 0; i < 3; i += 1) list = write(list, snap(at(10 + i * 11), 'background'));
    expect(list.map((s) => s.reason).sort()).toEqual(['background', 'before-restore', 'daily']);
  });

  it('do not count as the newer copy a daily one keeps beside itself', () => {
    // Before this, the background copy was "the newest survivor" and the copy before the update was the one to go.
    const update = snap(at(0), 'before-migration');
    const background = snap(at(30), 'background');
    const daily = snap(at(40), 'daily');
    expect(keepTwo([update, background], daily, new Date(daily.takenAt))).toEqual([]);
    // And the next day's copy prunes among the regular copies as it always did, leaving the background one be.
    const next = snap(new Date(Date.UTC(2026, 10, 11, 9)).toISOString(), 'daily');
    expect(keepTwo([update, background, daily], next, new Date(next.takenAt)).map((s) => s.file)).toEqual([update.file]);
  });

  it('a daily copy clears a stray second background copy, keeping the newest', () => {
    const older = snap(at(10), 'background');
    const newer = snap(at(20), 'background');
    const daily = snap(at(30), 'daily');
    expect(keepTwo([older, newer], daily, new Date(daily.takenAt)).map((s) => s.file)).toEqual([older.file]);
  });

  it('keep the copy that held everything when the next one is under half its size', () => {
    const whole = { ...snap(at(10), 'background'), bytes: 8_000_000 };
    let list = [whole];
    for (let i = 0; i < 3; i += 1) list = write(list, { ...snap(at(20 + i * 11), 'background'), bytes: 900_000 });
    expect(list.map((s) => s.file)).toContain(whole.file);
    // Bounded all the same: the big one and the newest, never a pile.
    expect(list).toHaveLength(2);
  });

  it('on a device without room for three, keep only the newest copy whatever its reason, as before', () => {
    const grace = snap(at(0), 'before-start-fresh');
    const update = snap(at(1), 'before-migration');
    const daily = snap(at(2), 'daily');
    const older = snap(at(3), 'background');
    const incoming = snap(at(20), 'background');
    const doomed = keepOne([grace, update, daily, older], incoming, new Date(incoming.takenAt));
    expect(doomed.map((s) => s.file).sort()).toEqual([update.file, daily.file, older.file].sort());
  });

  it('never stand in for the day’s copy', () => {
    const now = new Date(at(50));
    expect(dailyDue([snap(at(10), 'background')], now)).toBe(true);
    expect(dailyDue([snap(at(10), 'background'), snap(at(5), 'daily')], now)).toBe(false);
  });
});
