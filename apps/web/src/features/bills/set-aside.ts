export interface SetAside {
  /** What all the sinking funds set aside each month, in the reading currency. */
  monthlyMinor: number;
  savedMinor: number;
  targetMinor: number;
  count: number;
  /** True when a fund was left out of the sums because no rate reaches its currency. */
  approximate: boolean;
}

/**
 * What the sinking funds add up to, in one currency: the monthly amounts, what is saved, and the targets. A fund in
 * another currency is brought over with `convert`; where there is none, or no rate, it is left out and `approximate` says so.
 */
export function setAsideOf(
  funds: readonly { monthlyMinor: number; savedMinor: number; targetMinor: number; currency: string }[],
  currency: string,
  convert?: (minor: number, from: string) => number | null,
): SetAside {
  const total: SetAside = { monthlyMinor: 0, savedMinor: 0, targetMinor: 0, count: funds.length, approximate: false };
  for (const fund of funds) {
    const into = (minor: number) => (fund.currency === currency ? minor : (convert?.(minor, fund.currency) ?? null));
    const monthly = into(fund.monthlyMinor);
    const saved = into(fund.savedMinor);
    const target = into(fund.targetMinor);
    if (monthly === null || saved === null || target === null) {
      total.approximate = true;
      continue;
    }
    total.monthlyMinor += monthly;
    total.savedMinor += saved;
    total.targetMinor += target;
  }
  return total;
}
