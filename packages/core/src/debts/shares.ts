/**
 * A bill split equally between everyone who was there, you included.
 *
 * The remainder goes to you rather than being spread about, so the shares always add back to the bill and
 * nobody is asked for a rupiah more than their share.
 */
export function equalShares(totalMinor: number, people: number): { yours: number; each: number[] } {
  if (people <= 0) return { yours: totalMinor, each: [] };
  const each = Math.floor(totalMinor / (people + 1));
  return { yours: totalMinor - each * people, each: Array.from({ length: people }, () => each) };
}

/** What is left for you once each person's share has been typed. */
export function yourShare(totalMinor: number, shares: readonly number[]): number {
  const theirs = shares.reduce((sum, share) => sum + share, 0);
  if (theirs > totalMinor) throw new Error('Their shares come to more than the bill');
  return totalMinor - theirs;
}
