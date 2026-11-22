/**
 * One payment, several bills (2026-11-22): which part of a split each bill it settles is paid by. A link is a bill and
 * a month, never a line — the ledger makes every line again on an edit — so the part is found by one rule, the same on
 * the Bills page (what each bill was paid) and in the Split sheet (the part's "Bill:"):
 *
 *   1. a part in the bill's category for exactly the bill's own amount;
 *   2. then a part in the bill's category;
 *   3. then any part left.
 *
 * Bills are taken in the order given at each step, and a part pays one bill at most. A bill with no part left gets
 * null. Two bills of one category and one amount may swap parts: their figures are the same either way.
 */
export interface BillToMatch {
  categoryId: string;
  /** The bill's own fixed amount, or null for one that varies. */
  amountMinor: number | null;
}

export interface LineToMatch {
  categoryId: string;
  amountMinor: number;
}

export function matchBillsToLines(bills: readonly BillToMatch[], lines: readonly LineToMatch[]): (number | null)[] {
  const out: (number | null)[] = bills.map(() => null);
  const taken = new Set<number>();
  const pass = (fits: (bill: BillToMatch, line: LineToMatch) => boolean) => {
    bills.forEach((bill, b) => {
      if (out[b] !== null) return;
      const at = lines.findIndex((line, l) => !taken.has(l) && fits(bill, line));
      if (at < 0) return;
      out[b] = at;
      taken.add(at);
    });
  };
  pass((bill, line) => line.categoryId === bill.categoryId && bill.amountMinor !== null && line.amountMinor === bill.amountMinor);
  pass((bill, line) => line.categoryId === bill.categoryId);
  pass(() => true);
  return out;
}
