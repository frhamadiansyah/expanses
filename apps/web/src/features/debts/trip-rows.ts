import { formatMinor } from '@expanses/core';
import type { EventBalanceRow } from '@expanses/db';

/** Under a trip on the Debts page (shared events §5): the payments this person is in, by name, or "Settled". */
export function tripSubtitle(row: EventBalanceRow): string {
  if (row.payments.length === 0) return 'Settled';
  return row.payments.map((p) => `${p.fromName} pays ${p.toName} ${formatMinor(p.amountMinor, row.currency)}`).join(' · ');
}
