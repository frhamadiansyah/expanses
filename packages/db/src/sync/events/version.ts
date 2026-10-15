/*
 * Shared events need every phone in on them to know the seven entities (shared events §7, "App version"; ruling R10).
 * A joiner below this version is refused before it claims anything; a build that predates events altogether refuses the
 * invite itself, by its preview's currency ('XXX').
 */

/** The lowest app version that understands shared events. */
export const SHARED_EVENTS_MIN_APP_VERSION = '0.4.0';

const segment = (parts: readonly string[], i: number) => {
  const n = Number(parts[i]);
  return Number.isFinite(n) ? n : 0;
};

/** Whether `have` is at least `want`, release segment by release segment; an unknown version never is. */
export function meetsVersion(have: string | null, want: string): boolean {
  if (have === null) return false;
  const a = have.split('.');
  const b = want.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (segment(a, i) !== segment(b, i)) return segment(a, i) > segment(b, i);
  }
  return true;
}
