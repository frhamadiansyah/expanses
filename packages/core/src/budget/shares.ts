import { currencyInfo } from '../money/currencies';
import { assertMinor } from '../money/money';

/** What a budget set as a % is a share of: the month's take-home, or its parent category's budget. */
export type ShareBasis = 'take-home' | 'parent';

/** A budget set as a % rather than an amount: of what, and how much, in hundredths of a percent (1550 = 15.5%). */
export interface BudgetShare {
  basis: ShareBasis;
  bp: number;
}

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareError';
  }
}

/** "15,5", "15.5" or "15,5%" → 1550. More than 0, at most 100, two decimals at most. */
export function parsePercentBp(text: string): number {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/%$/, '').trim());
  if (!m) throw new ShareError('A share is a percentage with at most two decimals, such as 15 or 12,5');
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (bp <= 0 || bp > 10000) throw new ShareError('A share is more than 0% and at most 100%');
  return bp;
}

/** 1550 → "15,5": the share as it would be typed, a comma before its decimals, none when it is whole. */
export function formatBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  if (rest === 0) return String(whole);
  return `${whole},${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * `bp` hundredths of a percent of `baseMinor`, to the nearest whole major unit and never above the basis. BigInt
 * throughout: a take-home times 10000 can pass the safe range of a double.
 */
export function shareOfMinor(baseMinor: number, bp: number, currency: string): number {
  assertMinor(baseMinor);
  if (baseMinor <= 0 || bp <= 0) return 0;
  const unit = BigInt(10 ** currencyInfo(currency).exponent);
  const exact = (BigInt(baseMinor) * BigInt(bp) * 2n + 10000n) / 20000n;
  const whole = ((exact * 2n + unit) / (2n * unit)) * unit;
  return Math.min(Number(whole), baseMinor);
}

/** The share an amount is of a basis, in hundredths of a percent, kept between 1 and 10000; null without a basis. */
export function bpOf(minor: number, baseMinor: number): number | null {
  if (baseMinor <= 0) return null;
  const bp = Number((BigInt(Math.max(0, minor)) * 20000n + BigInt(baseMinor)) / (2n * BigInt(baseMinor)));
  return Math.min(10000, Math.max(1, bp));
}

/** One stored cap: what was saved as a month, this month's own figure if any, and the share it is, if it is one. */
export interface CapToResolve {
  categoryId: string;
  planMinor: number;
  overrideMinor: number | null;
  share: BudgetShare | null;
}

/**
 * The month's figure for every cap, parents before their children. A % of take-home is of this month's take-home; a %
 * of a parent is of the parent's figure this month, its own month's figure included. A % whose parent has no cap here
 * keeps the figure it was saved at. A cap's own figure for this month always wins.
 */
export function resolveCaps(
  caps: readonly CapToResolve[],
  parentOf: (categoryId: string) => string | null,
  takeHomeMinor: number,
  currency: string,
): Map<string, { planMinor: number; amountMinor: number }> {
  const byCategory = new Map(caps.map((cap) => [cap.categoryId, cap]));
  const out = new Map<string, { planMinor: number; amountMinor: number }>();
  const resolving = new Set<string>();
  const resolve = (cap: CapToResolve): { planMinor: number; amountMinor: number } => {
    const done = out.get(cap.categoryId);
    if (done) return done;
    // A loop cannot happen in a category tree, but a figure is never worth hanging the page for.
    if (resolving.has(cap.categoryId)) return { planMinor: cap.planMinor, amountMinor: cap.overrideMinor ?? cap.planMinor };
    resolving.add(cap.categoryId);
    let planMinor = cap.planMinor;
    if (cap.share?.basis === 'take-home') planMinor = shareOfMinor(takeHomeMinor, cap.share.bp, currency);
    if (cap.share?.basis === 'parent') {
      const parentId = parentOf(cap.categoryId);
      const parent = parentId ? byCategory.get(parentId) : undefined;
      if (parent) planMinor = shareOfMinor(resolve(parent).amountMinor, cap.share.bp, currency);
    }
    const figure = { planMinor, amountMinor: cap.overrideMinor ?? planMinor };
    out.set(cap.categoryId, figure);
    return figure;
  };
  for (const cap of caps) resolve(cap);
  return out;
}
