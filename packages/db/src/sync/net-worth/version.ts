/*
 * Joint net worth needs every device in on it to understand the feature (spec §9): a device below this app version
 * cannot be a member of a joint proposal it would not otherwise render. `book_devices.app_version` (migration 0057)
 * carries each device's own version to its peers, so any device can tell whether another one meets the minimum
 * before proposing joint mode.
 */

/** The lowest app version that understands joint net worth (spec §9). */
export const NET_WORTH_MIN_APP_VERSION = '0.3.0';

/** One release segment as a number; a missing or non-numeric part reads as 0. */
function segment(parts: readonly string[], i: number): number {
  const n = Number(parts[i]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whether `v` is at least {@link NET_WORTH_MIN_APP_VERSION}, comparing release segments numerically (so '0.10.0' is
 * newer than '0.3.0', not lexicographically older). `null` — a device that never said its version, from before this
 * migration — reads as not meeting it.
 */
export function meetsMinVersion(v: string | null): boolean {
  if (v === null) return false;
  const have = v.split('.');
  const want = NET_WORTH_MIN_APP_VERSION.split('.');
  for (let i = 0; i < Math.max(have.length, want.length); i += 1) {
    const h = segment(have, i);
    const w = segment(want, i);
    if (h !== w) return h > w;
  }
  return true;
}
