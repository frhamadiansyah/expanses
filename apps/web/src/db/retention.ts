/**
 * COPIES FROM BEFORE THIS BUILD ARE KEPT — REVISIT ONCE THE RESTORE INCIDENT HAS BEEN LOOKED AT.
 *
 * A database on a real device was lost and restored, and with it a shared workspace's sharing went missing. The
 * copies taken before that — local safety copies in `expanses-safety/` and this device's iCloud copies — may be the
 * only place the data from before the incident still is. So every copy already on the device the first time this
 * build writes one is kept, untouched, broken or not, for as long as this is on.
 *
 * Which copies those are is written down once, in `kept-copies.json` beside them (`KEPT_COPIES_FILE`), by the first
 * copy this build writes (local or iCloud): the names of the local copies there at that moment, and the moment
 * itself. A copy is kept when its name is on that list, or when it was taken before that moment (so a listing that
 * came back short cannot cost one, and iCloud copies, which are not listed, are kept by time). A record that cannot
 * be read keeps every copy.
 *
 * Copies taken after that follow the ordinary rules again (snapshot-policy.ts: keep two, one background;
 * icloud/names.ts: 7 backup days, at most 14 copies), so storage stops growing. And because the kept copies are space
 * that is never given back, a new copy is only written while there is room for three more of it and
 * `KEPT_HEADROOM_BYTES` besides: on a nearly full device the copy is skipped (and the skip is written in the sync log)
 * rather than taking the room the live database and new photos need.
 *
 * Set to false to let the ordinary rules remove the kept copies too.
 */
export const KEEP_OLDER_COPIES = true;

/** The record of which copies are kept, in the safety folder. Not a copy's name, so no listing ever takes it for one. */
export const KEPT_COPIES_FILE = 'kept-copies.json';

/** What is left free, beside three copies' worth, before a new copy is written while kept copies are on the device. */
export const KEPT_HEADROOM_BYTES = 64 * 1024 * 1024;

export interface KeptCopies {
  /** When the record was made, ISO: a copy taken before this second is kept. */
  recordedAt: string;
  /** The local copies in the safety folder when it was made. */
  files: string[];
}

export function parseKeptCopies(raw: Uint8Array | null): KeptCopies | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as Partial<KeptCopies>;
    if (typeof parsed.recordedAt !== 'string' || Number.isNaN(Date.parse(parsed.recordedAt)) || !Array.isArray(parsed.files)) return null;
    return { recordedAt: parsed.recordedAt, files: parsed.files.filter((file): file is string => typeof file === 'string') };
  } catch {
    return null;
  }
}

const SECOND = 1000;
const wholeSeconds = (iso: string): number => Math.floor(Date.parse(iso) / SECOND);

/**
 * Whether a copy taken at `takenAt` (named `file`, for a local one) is kept by `kept`. `null` is a record that could
 * not be read or written: every copy is kept. By whole seconds and strictly before, because copy names carry whole
 * seconds: the copy written in the same second as the record is this build's own, not an older one.
 */
export function isKeptCopy(kept: KeptCopies | null, copy: { takenAt: string; file?: string }): boolean {
  if (kept === null) return true;
  if (copy.file !== undefined && kept.files.includes(copy.file)) return true;
  const taken = wholeSeconds(copy.takenAt);
  return !Number.isNaN(taken) && taken < wholeSeconds(kept.recordedAt);
}
