/**
 * PRUNING PAUSED — REVISIT BEFORE THE NEXT RELEASE.
 *
 * A database on a real device was lost and restored, and with it a shared workspace's sharing went missing. The
 * copies taken before that — local safety copies in `expanses-safety/` and this device's iCloud copies — may be the
 * only place the data from before the incident still is. Until it has been looked at, no copy is removed
 * automatically: new copies are still written and read back, only the removals after them are skipped.
 *
 * What this costs: copies pile up (local ones in the app's own storage, iCloud ones in the owner's iCloud). A device
 * that is full is still told so before a copy is written (`roomFor`), so this never stops the app; it only stops
 * copies being taken once there is no room. Set to false to bring back the rules in snapshot-policy.ts (keep two,
 * one background) and icloud/names.ts (7 backup days, at most 14 copies).
 */
export const PRUNING_PAUSED = true;
