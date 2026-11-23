import type { MonthlyBill } from '@expanses/db';
import { amountOf, isDueSoon } from './bill-view';

/*
 * The four status tiles on the Mac Bills (v1, owner approved 2026-11-23): how many bills of the month are paid, due
 * soon, later and late, and what each adds up to. The buckets are the table's own groups (`deskGroups`), so a tile and
 * the rows under it never disagree:
 * - Paid: paid this month (a skipped bill comes to nothing and is in no tile);
 * - Late: still to pay past its day;
 * - Due soon: still to pay, not late, due within the few days `isDueSoon` gives (the table's Due soon less its late);
 * - Later: every other bill still to pay.
 * Late, Due soon and Later add up to the month's still to pay (`monthBoxOf`'s left). Paused bills are in none.
 * `approximate` when a bill still to pay has no fixed amount and its estimate stands in.
 */

export type BillTileKey = 'paid' | 'dueSoon' | 'later' | 'late';

export interface BillTile {
  key: BillTileKey;
  count: number;
  minor: number;
  approximate: boolean;
}

export function bucketOf(bill: Pick<MonthlyBill, 'state' | 'window'>, today: string): BillTileKey | null {
  if (bill.state === 'paid') return 'paid';
  if (bill.state === 'overdue') return 'late';
  if (isDueSoon(bill, today)) return 'dueSoon';
  if (bill.state === 'open' || bill.state === 'upcoming') return 'later';
  return null;
}

export function billTiles(rows: readonly MonthlyBill[], today: string): BillTile[] {
  const keys: BillTileKey[] = ['paid', 'dueSoon', 'later', 'late'];
  return keys.map((key) => {
    const list = rows.filter((bill) => bucketOf(bill, today) === key);
    return {
      key,
      count: list.length,
      minor: list.reduce((sum, bill) => sum + amountOf(bill), 0),
      approximate: key !== 'paid' && list.some((bill) => bill.amountMinor === null),
    };
  });
}

/** "7 bills", "1 bill". */
export const billCount = (n: number) => `${n} ${n === 1 ? 'bill' : 'bills'}`;
