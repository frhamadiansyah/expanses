import type { TransactionView } from '@expanses/db';

/**
 * What a loan's own page says, worked out apart from the page: the rate as it is written, the month it ends, how much
 * sooner an extra ends it, how much of it is repaid, and the payments recorded against it. Pure, so a test can hold
 * each wording down.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A yearly rate as it is written here: "7,5%", "9%", "11,25%". */
export function rateText(bps: number): string {
  return `${(bps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
}

/** "Sep 2041", from `2041-09` or `2041-09-25`. Anything else comes back as it was. */
export function monthYearLabel(iso: string): string {
  const [year, month] = iso.split('-').map(Number);
  if (!year || !month || month > 12) return iso;
  return `${MONTHS[month - 1]} ${year}`;
}

/** "2 years 6 months sooner", "1 year sooner", "5 months sooner"; nothing when it is no sooner. */
export function soonerText(months: number): string | null {
  if (!(months > 0)) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years > 0 ? `${years} ${years === 1 ? 'year' : 'years'}` : null, rest > 0 ? `${rest} ${rest === 1 ? 'month' : 'months'}` : null];
  return `${parts.filter(Boolean).join(' ')} sooner`;
}

/** How much of what was borrowed is repaid, as a whole percent from 0 to 100, rounded down so 100 means all of it. */
export function repaidPercent(originalMinor: number, owedMinor: number): number {
  if (!(originalMinor > 0)) return 0;
  const share = (originalMinor - Math.max(0, owedMinor)) / originalMinor;
  return Math.min(100, Math.max(0, Math.floor(share * 100)));
}

/** A share typed as "1", "1,5" or "1.5" percent, in basis points; null while it is not a share above nothing. */
export function percentBps(typed: string): number | null {
  const text = typed.trim().replace('%', '').replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

/** One payment recorded against a loan: what came off it, and every other line it paid for, by name. */
export interface LoanPayment {
  id: string;
  occurredOn: string;
  principalMinor: number;
  /** Interest, an insurance or admin charge riding along, a bank's fee: each spending line, by its category's name. */
  charges: { name: string; minor: number }[];
  totalMinor: number;
}

/**
 * The payments recorded against a loan, newest first: every transaction that lowered it. What was owed when it was
 * opened, and anything else that raised it, is not a payment.
 */
export function loanPayments(transactions: readonly TransactionView[], loanAccountId: string): LoanPayment[] {
  const payments: LoanPayment[] = [];
  for (const tx of transactions) {
    const principalMinor = tx.entries.filter((entry) => entry.accountId === loanAccountId).reduce((sum, entry) => sum + entry.amountMinor, 0);
    if (!(principalMinor > 0)) continue;
    const charges = tx.entries.filter((entry) => entry.accountKind === 'expense' && entry.amountMinor > 0).map((entry) => ({ name: entry.accountName, minor: entry.amountMinor }));
    payments.push({ id: tx.id, occurredOn: tx.occurredOn, principalMinor, charges, totalMinor: principalMinor + charges.reduce((sum, charge) => sum + charge.minor, 0) });
  }
  return payments.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
}
