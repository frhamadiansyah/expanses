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
  /**
   * The transfers `transferMinor` counted (wave 4 review round 2): each `member_transfer`'s group-log id — an id every
   * group member already holds, never a local transaction id — with its part, in the item's currency and sense. They
   * sum to `transferMinor`, so a partner's page can tell exactly which of the transfers it lists the summary holds.
   */
  transfers: { transferId: string; minor: number }[];
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
  /** With `transfer`: the `member_transfer`'s group-log id. */
  transferId?: string;
}

/** Splits a period's movements on one item; amounts signed in the item's balance sense (owed for a liability). */
export function splitPeriod(
  openingMinor: number,
  movements: readonly PeriodMovement[],
): { householdMinor: number; otherUseMinor: number; transferMinor: number; transfers: ItemSummary['transfers']; closingMinor: number } {
  let householdMinor = 0;
  let otherUseMinor = 0;
  let transferMinor = 0;
  const byTransfer = new Map<string, number>();
  for (const m of movements) {
    if (m.transfer === true) {
      transferMinor += m.amountMinor;
      const id = m.transferId ?? '';
      byTransfer.set(id, (byTransfer.get(id) ?? 0) + m.amountMinor);
    } else if (m.household) householdMinor += m.amountMinor;
    else otherUseMinor += m.amountMinor;
  }
  const transfers = [...byTransfer].map(([transferId, minor]) => ({ transferId, minor }));
  return { householdMinor, otherUseMinor, transferMinor, transfers, closingMinor: openingMinor + householdMinor + otherUseMinor + transferMinor };
}

/**
 * A card's limit bar (§8.3; final review item 3): "From earlier" (what the cycle opened owing), Household, and other use
 * (with transfers between partners), drawn in that order, then what is available. The three segments fill exactly the
 * balance, clamped to the limit — so the filled width is balance ÷ limit and `availableMinor` = limit − balance.
 *
 * A negative part (a payment, a refund) takes no width of its own: it pays down what was owed from earlier first, then
 * other use, then Household. Each segment is the difference of rounded cumulative boundaries, so rounding never makes
 * the bar overshoot or fall short of the balance.
 */
export function cardBar(
  limitMinor: number,
  s: Pick<ItemSummary, 'openingMinor' | 'householdMinor' | 'otherUseMinor' | 'transferMinor' | 'balanceMinor'>,
): { openingPct: number; householdPct: number; otherPct: number; availableMinor: number } {
  const availableMinor = limitMinor - s.balanceMinor;
  if (limitMinor <= 0) return { openingPct: 0, householdPct: 0, otherPct: 0, availableMinor };
  const parts = { opening: s.openingMinor, household: s.householdMinor, other: s.otherUseMinor + s.transferMinor };
  let credit = 0;
  for (const key of ['opening', 'household', 'other'] as const) {
    if (parts[key] < 0) {
      credit += -parts[key];
      parts[key] = 0;
    }
  }
  for (const key of ['opening', 'other', 'household'] as const) {
    const off = Math.min(parts[key], credit);
    parts[key] -= off;
    credit -= off;
  }
  const cap = Math.max(0, Math.min(limitMinor, s.balanceMinor));
  const edge = (minor: number) => Math.round((Math.min(minor, cap) / limitMinor) * 100);
  const afterOpening = edge(parts.opening);
  const afterHousehold = edge(parts.opening + parts.household);
  const afterOther = edge(parts.opening + parts.household + parts.other);
  return { openingPct: afterOpening, householdPct: afterHousehold - afterOpening, otherPct: afterOther - afterHousehold, availableMinor };
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
