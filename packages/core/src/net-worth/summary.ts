import type { ItemTax } from './joint-tax';
/** One owner's item, as sent to the group log (spec §5.2). */
export interface ItemSummary {
  owner: string;
  kind: 'asset' | 'liability';
  subtype: string;
  name: string;
  currency: string;
  balanceMinor: number;
  asOf: string;
  card: { limitMinor: number; cycleStart: string; cycleEnd: string } | null;
  period: { start: string; end: string };
  openingMinor: number;
  householdMinor: number;
  otherUseMinor: number;
  /**
   * The period's transfers between partners on the item (§7.2; wave 4 review): its movements whose transaction is one
   * of this phone's `member_transfer` sides, in the item's currency and sense. Never part of `otherUseMinor`, so the
   * partner's page can list the ones with them without counting them twice. opening + household + otherUse + transfer =
   * balance.
   */
  transferMinor: number;
  monthEnds: { month: string; balanceMinor: number }[];
  /** Only when the group's mode is joint (§8.4): this item's slice of the owner's tax inputs for the latest finished year. */
  tax: ItemTax;
}

export interface PeriodMovement {
  transactionId: string;
  amountMinor: number;
  household: boolean;
  /** One side of a transfer between partners (`member_transfer_postings`): counted in `transferMinor`, never elsewhere. */
  transfer?: boolean;
}

/** Splits a period's movements on one item; amounts signed in the item's balance sense (owed for a liability). */
export function splitPeriod(
  openingMinor: number,
  movements: readonly PeriodMovement[],
): { householdMinor: number; otherUseMinor: number; transferMinor: number; closingMinor: number } {
  let householdMinor = 0;
  let otherUseMinor = 0;
  let transferMinor = 0;
  for (const m of movements) {
    if (m.transfer === true) transferMinor += m.amountMinor;
    else if (m.household) householdMinor += m.amountMinor;
    else otherUseMinor += m.amountMinor;
  }
  return { householdMinor, otherUseMinor, transferMinor, closingMinor: openingMinor + householdMinor + otherUseMinor + transferMinor };
}

/** Clamp to [0, 100], rounding to the nearest integer percent. */
function clampPct(fraction: number): number {
  return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}

export function cardBar(
  limitMinor: number,
  s: Pick<ItemSummary, 'openingMinor' | 'householdMinor' | 'otherUseMinor' | 'transferMinor' | 'balanceMinor'>,
): { householdPct: number; otherPct: number; availableMinor: number } {
  const availableMinor = limitMinor - s.balanceMinor;
  if (limitMinor <= 0) return { householdPct: 0, otherPct: 0, availableMinor };
  const householdPct = clampPct(s.householdMinor / limitMinor);
  // Household is drawn first; other use fills the remaining width so the two bars never overlap
  // past 100%, even when independent rounding of each share would otherwise push the sum over.
  // The other segment is everything not Household: other use and transfers between partners together (wave 4 review).
  const other = s.otherUseMinor + s.transferMinor;
  const otherRaw = other > 0 ? clampPct(other / limitMinor) : 0;
  const otherPct = Math.min(otherRaw, 100 - householdPct);
  return { householdPct, otherPct, availableMinor };
}

/** Stable JSON (sorted keys) of a value, used so key order never changes the hash. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable JSON (sorted keys) → string, used to skip unchanged sends. */
export function summaryHash(s: ItemSummary): string {
  return stableStringify(s);
}

/** ['2026-08', ...] the `count` months before `today`'s month, oldest first, excluding the current month. */
export function lastMonthEnds(today: string, count: number): string[] {
  const [yearStr, monthStr] = today.slice(0, 7).split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  // Index of the current month, 0-based from an arbitrary epoch (year * 12 + month-1).
  const currentIndex = year * 12 + (month - 1);
  const months: string[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const index = currentIndex - i;
    const y = Math.floor(index / 12);
    const m = index - y * 12;
    months.push(`${y}-${String(m + 1).padStart(2, '0')}`);
  }
  return months;
}
