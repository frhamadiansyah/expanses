/**
 * The rules for safety copies: what to name them, which to keep, when one is due, and whether
 * there is room to take one. Pure decisions only — no OPFS, no `navigator.storage`, no
 * `Date.now()` except through a `now` argument (default `new Date()`). Task 7 wires this to the
 * real OPFS-backed store and the real clock.
 */

/**
 * Why a copy was taken. Only a copy taken for one of these reasons is ever written.
 *
 * `background` is the copy taken as the app leaves the foreground, when something changed since the last
 * one (`background-copy.ts`). It is kept apart from the others in every rule below: at most one is kept,
 * it never takes a regular copy's place, and it is never the day's copy.
 */
export type SnapshotReason = 'before-migration' | 'before-restore' | 'before-start-fresh' | 'before-delete' | 'daily' | 'background';

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

/**
 * The smallest file that can be a copy of a database: one 512-byte page, SQLite's smallest. Anything less
 * is a write that stopped half way, and is never listed, kept or offered.
 */
export const MIN_COPY_BYTES = 512;

const REASONS: SnapshotReason[] = ['before-migration', 'before-restore', 'before-start-fresh', 'before-delete', 'daily', 'background'];

/*
 * Adding a reason widens this pattern, and it must only ever widen: every name an older build wrote has to keep
 * parsing. The reverse is worth knowing too. An older build's pattern has no `background` in it, so a
 * `-background.sqlite3` name does not match there at all and that build's survey skips the file as "not one of
 * ours": never listed, offered, counted or pruned. Background copies are also never written into the manifest
 * (`snapshots.ts`), so an older build installed over this one simply does not see them; the one file stays on
 * the device until a build that knows the name prunes it.
 */
const NAME_PATTERN = new RegExp(`^snapshot-(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z-v(\\d+)(?:-(${REASONS.join('|')}))?\\.sqlite3$`);

/**
 * The file name for a copy taken at `takenAt` (ISO, any precision) of schema `schemaVersion`, for
 * `reason`. Sub-second precision is dropped: two copies taken within the same second collide on purpose,
 * since a caller writing a second one that fast is almost certainly retrying the same copy.
 *
 * The reason is in the name because the directory has to be able to answer without the manifest. A copy
 * whose manifest entry is lost is still listed and still restorable — that is the point of the fallback —
 * and until the name carried it, every such copy was reported as the common reason, `before-migration`.
 * That is the one answer that must never be guessed: a `before-restore` copy is the undo net for a restore
 * that went wrong, so reading it as `before-migration` put a copy of whatever was just replaced back into
 * the running for "the last good copy". A name written by an older build has no reason in it and still
 * parses; only the reason is then unknown.
 */
export function snapshotName(takenAt: string, schemaVersion: number, reason?: SnapshotReason): string {
  const compact = new Date(takenAt)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, '');
  return `snapshot-${compact}Z-v${schemaVersion}${reason ? `-${reason}` : ''}.sqlite3`;
}

/**
 * The inverse of {@link snapshotName}, or `null` for anything that is not one of our names. `reason` is
 * `null` for a name written before reasons were part of one.
 */
export function parseSnapshotName(file: string): { takenAt: string; schemaVersion: number; reason: SnapshotReason | null } | null {
  const match = NAME_PATTERN.exec(file);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, version, reason] = match;
  return {
    takenAt: `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`,
    schemaVersion: Number(version),
    reason: (reason as SnapshotReason | undefined) ?? null,
  };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** True while a copy taken before "Start fresh" is still within its seven-day grace period. */
function withinStartFreshGrace(snapshot: SnapshotInfo, now: Date): boolean {
  if (snapshot.reason !== 'before-start-fresh') return false;
  return now.getTime() - new Date(snapshot.takenAt).getTime() < SEVEN_DAYS_MS;
}

const isBackground = (snapshot: SnapshotInfo): boolean => snapshot.reason === 'background';

const newestFirst = (list: SnapshotInfo[]): SnapshotInfo[] => [...list].sort((a, b) => b.takenAt.localeCompare(a.takenAt));

/**
 * Which of `list` should be deleted now that `incoming` has just been written. The copy just
 * written is never returned, whatever its own timestamp says — a clock that has jumped must not
 * cost the user the copy they just took.
 *
 * Two pools, pruned apart:
 *
 * - **The regular copies** (every reason but `background`). Ordinarily this keeps `incoming` plus the single
 *   newest survivor and marks the rest for deletion, except a copy taken before "Start fresh" is spared for
 *   seven days regardless of how many that leaves kept. Exactly as if background copies did not exist: a
 *   background copy is never the "newest survivor" that pushes the copy before an update out, and writing
 *   one never deletes a regular copy at all. Background copies can be taken every ten minutes; without this,
 *   an afternoon of them would leave nothing older than the afternoon.
 * - **Background copies**: only the newest is kept — `incoming` itself when it is one.
 *
 * Across both, the largest good copy is spared when `incoming` is under half its size (see
 * {@link largerThanIncoming}), so on the rare device that has just lost most of its data a second background
 * copy can be kept: the one that held everything, beside the newest.
 */
export function keepTwo(list: SnapshotInfo[], incoming: SnapshotInfo, now: Date = new Date()): SnapshotInfo[] {
  const background = newestFirst(list.filter(isBackground));
  const regular = list.filter((snapshot) => !isBackground(snapshot));
  const backgroundGone = isBackground(incoming) ? background : background.slice(1);
  const regularGone = isBackground(incoming) ? [] : keepNewestRegular(regular, incoming, now);
  const spared = largerThanIncoming(list, incoming);
  return [...backgroundGone, ...regularGone].filter((snapshot) => snapshot.file !== incoming.file && snapshot.file !== spared?.file);
}

/** The rule {@link keepTwo} has always applied, over the regular copies alone. */
function keepNewestRegular(list: SnapshotInfo[], incoming: SnapshotInfo, now: Date): SnapshotInfo[] {
  const [, ...rest] = newestFirst(list); // the newest of `list` survives alongside `incoming`; `incoming` itself is never a candidate.
  const spared = largerThanIncoming(list, incoming);
  return rest.filter((snapshot) => !withinStartFreshGrace(snapshot, now) && snapshot.file !== spared?.file);
}

/**
 * The largest good copy, when `incoming` is less than half its size — or null.
 *
 * A database does not halve in a day. A copy that small next to the biggest one held is far likelier a
 * device that has just lost most of its data than a user who deleted it, and two such copies in a row
 * would otherwise prune away the last one that held everything. A `before-restore` copy is never the one
 * spared: it is the undo of a restore, not a good copy.
 */
function largerThanIncoming(list: SnapshotInfo[], incoming: SnapshotInfo): SnapshotInfo | null {
  const largest = list.filter((snapshot) => snapshot.reason !== 'before-restore').sort((a, b) => b.bytes - a.bytes)[0];
  return largest && incoming.bytes < largest.bytes / 2 ? largest : null;
}

/**
 * Which of `list` to delete when the device has room for the copy just written but not for three: all of
 * them, except a copy taken before "Start fresh" that is still inside its seven-day grace. `incoming` is
 * never a candidate, for the same reason it is never one in {@link keepTwo} — and because this runs only
 * after that copy has been written and read back, there is never a moment with no copy on the device.
 *
 * It does not spare the large copy {@link keepTwo} spares. This is the no-room path, where keeping it would
 * mean keeping no new copy at all; a device that full is told so by `roomFor` before it gets here.
 *
 * Nor does it keep background copies apart, and this is the one way a background copy can remove a daily,
 * before-update or before-restore copy: on a device with room for the copy just written but not for three, the
 * newest copy is the one kept whatever its reason, as it always was for a daily one. A background copy is only
 * taken of a file that has just passed `quick_check`, so it is as good a copy as the day's — and the newest.
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
 * taken (a background copy does not count). Not UTC: for a user at UTC+7 a UTC day rolls over at seven in the morning, so "once a day"
 * would mean "once a working day, some time after breakfast". The rest of the branch counts local days;
 * this is the same day.
 */
export function dailyDue(list: SnapshotInfo[], now: Date = new Date()): boolean {
  const today = localDay(now);
  // A background copy is not the day's copy: it is pruned by the next one, ten minutes later, and the day
  // still gets a copy of its own that the regular rules keep.
  return !list.some((snapshot) => !isBackground(snapshot) && localDay(new Date(snapshot.takenAt)) === today);
}

export type Room = 'yes' | 'prune-first' | 'no';

/**
 * Whether there is room in `estimate` (from `navigator.storage.estimate()`) to write a copy of a
 * database `dbBytes` large. `'yes'` needs three times the database free — enough for the copy plus
 * the two already kept; `'prune-first'` means there is room for one more copy but not three;
 * `'no'` means there is not even room for one. A browser that will not estimate (`quota` or
 * `usage` missing) must never stop a rescue copy being taken, so that case answers `'yes'`.
 *
 * `headroom` is space that must stay free whatever the copies need: counted as already used.
 */
export function roomFor(estimate: { quota?: number; usage?: number }, dbBytes: number, headroom = 0): Room {
  const { quota, usage } = estimate;
  if (quota == null || usage == null) return 'yes';
  const free = quota - usage - headroom;
  if (free >= dbBytes * 3) return 'yes';
  if (free >= dbBytes) return 'prune-first';
  return 'no';
}
