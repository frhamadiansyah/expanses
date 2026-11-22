/**
 * One figure as the same share of another: a part of a purchase charged in one currency, read in the currency it was
 * bought in (a split of a USD bill charged in rupiah). Worked out in whole integers, so a large charge times a large
 * figure is never rounded by a double on the way.
 */

/** `part` of `whole`, as the same share of `other` — rounded half away from nought. Nothing when `whole` is nothing. */
export function proportionalMinor(part: number, whole: number, other: number): number {
  if (whole === 0) return 0;
  const num = BigInt(part) * BigInt(other);
  const den = BigInt(whole);
  const negative = num < 0n !== den < 0n && num !== 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const rounded = (2n * n + d) / (2n * d);
  return Number(negative ? -rounded : rounded);
}

/**
 * Each part of `whole` as its share of `other`, the last part taking what rounding leaves — so the figures always add up
 * to `other` exactly. A part typed in the finer-grained of the two figures reads back as it was typed.
 */
export function partFigures(parts: readonly number[], whole: number, other: number): number[] {
  if (parts.length === 0) return [];
  if (whole === 0) return parts.map(() => 0);
  const shares = parts.slice(0, -1).map((part) => proportionalMinor(part, whole, other));
  return [...shares, other - shares.reduce((sum, share) => sum + share, 0)];
}
