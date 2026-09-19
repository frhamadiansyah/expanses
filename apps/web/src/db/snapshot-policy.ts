/**
 * The rules for safety copies: what to name them, which to keep, when one is due, and whether
 * there is room to take one. Pure decisions only — no OPFS, no `navigator.storage`, no
 * `Date.now()` except through a `now` argument (default `new Date()`). Task 7 wires this to the
 * real OPFS-backed store and the real clock.
 */

/** Why a copy was taken. Only a copy taken for one of these reasons is ever written. */
export type SnapshotReason = 'before-migration' | 'before-restore' | 'before-start-fresh' | 'daily';

/** One copy in the store, as the store describes it. Task 7 writes the store that produces these. */
export interface SnapshotInfo {
  /** The file name inside the app's own storage. The handle `read` takes. */
  file: string;
  reason: SnapshotReason;
  /** The schema version the bytes were taken at. */
  schemaVersion: number;
  /** Size of the copy in bytes, so the screen can say how big the last good copy is. */
  bytes: number;
  /** When the copy was taken, ISO. */
  takenAt: string;
}

const NAME_PATTERN = /^snapshot-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-v(\d+)\.sqlite3$/;

/**
 * The file name for a copy taken at `takenAt` (ISO, any precision) of schema `schemaVersion`.
 * Sub-second precision is dropped: two copies taken within the same second collide on purpose,
 * since a caller writing a second one that fast is almost certainly retrying the same copy.
 */
export function snapshotName(takenAt: string, schemaVersion: number): string {
  const compact = new Date(takenAt)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, '');
  return `snapshot-${compact}Z-v${schemaVersion}.sqlite3`;
}

/** The inverse of {@link snapshotName}, or `null` for anything that is not one of our names. */
export function parseSnapshotName(file: string): { takenAt: string; schemaVersion: number } | null {
  const match = NAME_PATTERN.exec(file);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, version] = match;
  return {
    takenAt: `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`,
    schemaVersion: Number(version),
  };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** True while a copy taken before "Start fresh" is still within its seven-day grace period. */
function withinStartFreshGrace(snapshot: SnapshotInfo, now: Date): boolean {
  if (snapshot.reason !== 'before-start-fresh') return false;
  return now.getTime() - new Date(snapshot.takenAt).getTime() < SEVEN_DAYS_MS;
}

/**
 * Which of `list` should be deleted now that `incoming` has just been written. The copy just
 * written is never returned, whatever its own timestamp says — a clock that has jumped must not
 * cost the user the copy they just took. Ordinarily this keeps `incoming` plus the single newest
 * survivor of `list` and marks the rest for deletion, except a copy taken before "Start fresh" is
 * spared for seven days regardless of how many that leaves kept.
 */
export function keepTwo(list: SnapshotInfo[], incoming: SnapshotInfo, now: Date = new Date()): SnapshotInfo[] {
  const sorted = [...list].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const [, ...rest] = sorted; // the newest of `list` survives alongside `incoming`; `incoming` itself is never a candidate.
  return rest.filter((snapshot) => !withinStartFreshGrace(snapshot, now));
}

/**
 * Which of `list` to delete when the device has room for the copy just written but not for three: all of
 * them, except a copy taken before "Start fresh" that is still inside its seven-day grace. `incoming` is
 * never a candidate, for the same reason it is never one in {@link keepTwo} — and because this runs only
 * after that copy has been written and read back, there is never a moment with no copy on the device.
 */
export function keepOne(list: SnapshotInfo[], incoming: SnapshotInfo, now: Date = new Date()): SnapshotInfo[] {
  return list.filter((snapshot) => snapshot.file !== incoming.file && !withinStartFreshGrace(snapshot, now));
}

/**
 * The user's own calendar day, from `Date`'s local getters. Pure: the Date is the only input, and no
 * ambient clock or zone is read beyond the one the device is already set to.
 */
const localDay = (when: Date): string => {
  const month = `${when.getMonth() + 1}`.padStart(2, '0');
  const day = `${when.getDate()}`.padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}`;
};

/**
 * True once a full calendar day has passed, **in the user's own time zone**, without any copy being
 * taken. Not UTC: for a user at UTC+7 a UTC day rolls over at seven in the morning, so "once a day"
 * would mean "once a working day, some time after breakfast". The rest of the branch counts local days;
 * this is the same day.
 */
export function dailyDue(list: SnapshotInfo[], now: Date = new Date()): boolean {
  const today = localDay(now);
  return !list.some((snapshot) => localDay(new Date(snapshot.takenAt)) === today);
}

export type Room = 'yes' | 'prune-first' | 'no';

/**
 * Whether there is room in `estimate` (from `navigator.storage.estimate()`) to write a copy of a
 * database `dbBytes` large. `'yes'` needs three times the database free — enough for the copy plus
 * the two already kept; `'prune-first'` means there is room for one more copy but not three;
 * `'no'` means there is not even room for one. A browser that will not estimate (`quota` or
 * `usage` missing) must never stop a rescue copy being taken, so that case answers `'yes'`.
 */
export function roomFor(estimate: { quota?: number; usage?: number }, dbBytes: number): Room {
  const { quota, usage } = estimate;
  if (quota == null || usage == null) return 'yes';
  const free = quota - usage;
  if (free >= dbBytes * 3) return 'yes';
  if (free >= dbBytes) return 'prune-first';
  return 'no';
}
