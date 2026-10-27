import { monthsBetween, roundUpToMajor } from '@expanses/core';

export interface NeedBill {
  id: string;
  /** Null: the amount varies. */
  amountMinor: number | null;
  estimateMinor: number | null;
  currency: string;
  /** YYYY-MM-DD the bill next comes out. */
  dueOn: string;
}

export interface NeedFund {
  billId: string;
  monthlyMinor: number;
}

export interface BillNeed {
  billId: string;
  /** What this bill needs this month, in its own currency; null when it has no amount and no estimate. */
  needMinor: number | null;
  currency: string;
  /** True when a sinking fund backs the bill. */
  funded: boolean;
  /** The same in the read currency; null when no rate reaches the currency (or no need). */
  readMinor: number | null;
}

export interface RepeatingNeeds {
  bills: BillNeed[];
  /** In the read currency: the part backed by sinking funds, and the part that is not. */
  fundedMinor: number;
  unfundedMinor: number;
  totalMinor: number;
  /** True when a bill was left out of the sums: no rate reaches its currency, or it has no amount to go by. */
  approximate: boolean;
}

/** A fund's monthly figure for this month. One door, so a recalculated figure (skips, extras) flows into the hero and the rows alike. */
export function fundNeedOf(fund: Pick<NeedFund, 'monthlyMinor'>): number {
  return fund.monthlyMinor;
}

/** What a bill with no fund needs this month: the amount over the months left (this one and the due month counted, at least one), rounded up to a whole unit, as a fund's 'Each month' is. */
export function unfundedNeedOf(amountMinor: number, currency: string, today: string, dueOn: string): number {
  const monthsLeft = Math.max(1, monthsBetween(today.slice(0, 7), dueOn.slice(0, 7)));
  return roundUpToMajor(Math.ceil(amountMinor / monthsLeft), currency);
}

/**
 * What every repeating bill needs this month, per bill and in total. A bill with a sinking fund needs the fund's
 * monthly figure; one without needs what is still to save over the months left (nothing is saved). A varying amount
 * goes by its estimate, else is left out. Totals are in `currency`; a bill with no rate is left out and `approximate` says so.
 */
export function repeatingNeeds(
  bills: readonly NeedBill[],
  funds: readonly NeedFund[],
  today: string,
  currency: string,
  convert?: (minor: number, from: string) => number | null,
): RepeatingNeeds {
  const fundOf = new Map(funds.map((fund) => [fund.billId, fund]));
  const out: RepeatingNeeds = { bills: [], fundedMinor: 0, unfundedMinor: 0, totalMinor: 0, approximate: false };
  for (const bill of bills) {
    const fund = fundOf.get(bill.id);
    const amount = bill.amountMinor ?? bill.estimateMinor;
    const own = bill.currency;
    const needMinor = fund ? fundNeedOf(fund) : amount === null ? null : unfundedNeedOf(amount, own, today, bill.dueOn);
    const readMinor = needMinor === null ? null : own === currency ? needMinor : (convert?.(needMinor, own) ?? null);
    out.bills.push({ billId: bill.id, needMinor, currency: own, funded: Boolean(fund), readMinor });
    if (readMinor === null) {
      out.approximate = true;
      continue;
    }
    if (fund) out.fundedMinor += readMinor;
    else out.unfundedMinor += readMinor;
  }
  out.totalMinor = out.fundedMinor + out.unfundedMinor;
  return out;
}
