import { formatMinor } from '@expanses/core';
import type { EventBalanceRow } from '@expanses/db';

/**
 * Under a trip on the Debts page (shared events §5): the payments this person is in, by name, or "Settled" — then how
 * many records still wait for an account here, since the balance above leaves them out until they are taken over.
 */
export function tripSubtitle(row: EventBalanceRow): string {
  const waiting = row.waitingCount ?? 0;
  const payments = row.payments.length === 0 ? 'Settled' : row.payments.map((p) => `${p.fromName} pays ${p.toName} ${formatMinor(p.amountMinor, row.currency)}`).join(' · ');
  return waiting > 0 ? `${payments} · ${waiting} not in the books yet` : payments;
}
