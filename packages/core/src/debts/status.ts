export type DebtStatus = 'open' | 'settled' | 'forgiven';

export type DueState = 'none' | 'due_soon' | 'overdue';

/** Warn this many days before the date agreed. */
export const DUE_SOON_DAYS = 21;

const MS_PER_DAY = 86_400_000;

/** Whole days from one date to the other, both given as YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * What a debt is now. The balance decides between open and settled, because the ledger is the
 * truth; a debt written off stays forgiven whatever the balance says.
 */
export function statusFor(balanceMinor: number, recorded: DebtStatus): DebtStatus {
  if (recorded === 'forgiven') return 'forgiven';
  return balanceMinor > 0 ? 'open' : 'settled';
}

/** Whether the date agreed is close, already past, or nothing to say. */
export function dueStateFor(dueOn: string | null, onDate: string, status: DebtStatus): DueState {
  if (dueOn === null || status !== 'open') return 'none';
  const days = daysBetween(onDate, dueOn);
  if (days < 0) return 'overdue';
  return days <= DUE_SOON_DAYS ? 'due_soon' : 'none';
}

const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The due date in words: "Due in 6 days", "11 days overdue", "Due 30 Nov 2026". */
export function dueLabel(dueOn: string | null, onDate: string, status: DebtStatus): string {
  if (dueOn === null || status !== 'open') return '';
  const days = daysBetween(onDate, dueOn);
  if (days < 0) {
    const late = -days;
    return late === 1 ? '1 day overdue' : `${late} days overdue`;
  }
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return days <= DUE_SOON_DAYS ? `Due in ${days} days` : `Due ${longDate(dueOn)}`;
}
