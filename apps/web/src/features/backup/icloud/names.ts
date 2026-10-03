/**
 * The copies in iCloud, as names. Everything the Restore list shows about a copy — when, which device, how big,
 * whether photos are in it — is written into its file name, so listing the folder never downloads anything.
 *
 *   cicis_20261002T001200Z_iPhone_1a2b3c4d_p_2516582.cicisbackup
 *         taken at (UTC)   model  device   photos? bytes
 *
 * Pure functions with the clock as an argument, so the keep-and-remove rule is tested as a rule.
 */

export const SUFFIX = '.cicisbackup';

/** Copies a device keeps: the last 7 days it backed up on, and never more than 14 however many big changes there were. */
export const KEEP_DAYS = 7;
export const KEEP_MAX = 14;

export interface CloudCopy {
  name: string;
  takenAt: string;
  /** "iPhone", "iPad" — what iOS calls the device, never its owner-given name. */
  model: string;
  /** The first 8 characters of the device's id for this app, so each device prunes only its own copies. */
  device: string;
  withPhotos: boolean;
  bytes: number;
}

const compact = (iso: string): string => iso.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');

const expand = (stamp: string): string | null => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
};

/** The short device id a name carries: letters and digits only, 8 of them. */
export const shortDevice = (deviceId: string): string => (deviceId.toLowerCase().replace(/[^a-z0-9]/g, '') + '00000000').slice(0, 8);

export function copyName(copy: Omit<CloudCopy, 'name'>): string {
  const model = copy.model.replace(/[^A-Za-z]/g, '') || 'Device';
  return `cicis_${compact(copy.takenAt)}_${model}_${shortDevice(copy.device)}_${copy.withPhotos ? 'p' : 'n'}_${Math.max(0, Math.round(copy.bytes))}${SUFFIX}`;
}

/** A name read back, or null for anything that is not one of ours. */
export function parseName(name: string): CloudCopy | null {
  if (!name.endsWith(SUFFIX)) return null;
  const parts = name.slice(0, -SUFFIX.length).split('_');
  if (parts.length !== 6 || parts[0] !== 'cicis') return null;
  const [, stamp, model, device, photos, size] = parts as [string, string, string, string, string, string];
  const takenAt = expand(stamp);
  if (!takenAt || !/^[A-Za-z]+$/.test(model) || !/^[a-z0-9]{8}$/.test(device) || (photos !== 'p' && photos !== 'n') || !/^\d+$/.test(size)) return null;
  return { name, takenAt, model, device, withPhotos: photos === 'p', bytes: Number(size) };
}

/** Every copy that parses, newest first. */
export function listCopies(names: readonly string[]): CloudCopy[] {
  return names
    .map(parseName)
    .filter((copy): copy is CloudCopy => copy !== null)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** The device's own calendar day, as YYYY-MM-DD: "today" means what the owner means by it, not UTC's. */
export function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * The copies this device should remove after writing one: anything of its own outside the 7 most recent days it
 * backed up on, and anything past the 14th newest. Another device's copies are never touched — an old phone's last
 * copies may be the very thing a new phone is about to restore.
 *
 * Days are counted by the days that have a copy rather than by the calendar, so a phone left in a drawer for a month
 * comes back to find its last week of copies still there, not an empty folder.
 */
export function copiesToRemove(copies: readonly CloudCopy[], device: string): string[] {
  const mine = copies.filter((copy) => copy.device === shortDevice(device)).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const days: string[] = [];
  const remove: string[] = [];
  mine.forEach((copy, index) => {
    const day = localDay(new Date(copy.takenAt));
    if (!days.includes(day)) days.push(day);
    if (days.indexOf(day) >= KEEP_DAYS || index >= KEEP_MAX) remove.push(copy.name);
  });
  return remove;
}

/**
 * Whether a copy is due now: the switch is on, there is something worth keeping, and either something big has
 * happened since the last copy (an import, a restore) or this device has no copy from today yet.
 */
export function backupDue(state: { enabled: boolean; hasData: boolean; bigChange: boolean; copies: readonly CloudCopy[]; device: string; now: Date }): boolean {
  if (!state.enabled || !state.hasData) return false;
  if (state.bigChange) return true;
  const today = localDay(state.now);
  return !state.copies.some((copy) => copy.device === shortDevice(state.device) && localDay(new Date(copy.takenAt)) === today);
}

/** The newest copy this device made, for the "Last backup" row. */
export function lastOwnCopy(copies: readonly CloudCopy[], device: string): CloudCopy | null {
  return listCopies(copies.map((copy) => copy.name)).find((copy) => copy.device === shortDevice(device)) ?? null;
}
