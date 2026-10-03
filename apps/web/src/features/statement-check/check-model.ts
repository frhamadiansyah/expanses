/**
 * What the check screen says about a prepared statement check, worked out without React: the counts, the headline,
 * when Record all may go, and the missing rows laid out by day as the Cashflow list draws them.
 */
import type { CheckDraftRow, PreparedCheck } from '@expanses/db';

export interface CheckCounts {
  matched: number;
  differs: number;
  missing: number;
  flagged: number;
  payments: number;
  /** Rows alike enough that the owner says which recorded transaction each is. */
  ask: number;
}

export type Headline =
  | { kind: 'reconciled' }
  | { kind: 'differs'; differenceMinor: number; likely: string }
  | { kind: 'no-summary' };

/** A row recorded under a category: a missing purchase, fee or refund. A card payment needs none. */
export function needsCategory(row: CheckDraftRow): boolean {
  return row.outcome.status === 'missing' && row.outcome.as !== 'payment';
}

/** What recording the missing rows does to what the card owes: purchases and fees add, money back takes away. */
function missingNet(rows: readonly CheckDraftRow[]): number {
  return rows.filter((r) => r.outcome.status === 'missing').reduce((sum, r) => sum + (r.direction === 'out' ? r.amountMinor : -r.amountMinor), 0);
}

/**
 * The counts, and the headline: the statement's closing balance against the card's in cicis. When they differ, the
 * likely cause is what recording would close — the missing rows (with the payments line that goes with them), or
 * a flagged transaction whose amount is what is left.
 */
export function summaryOf(prepared: PreparedCheck): { counts: CheckCounts; headline: Headline } {
  const count = (status: CheckDraftRow['outcome']['status']) => prepared.rows.filter((r) => r.outcome.status === status).length;
  const counts: CheckCounts = {
    matched: count('matched'),
    differs: count('differs'),
    missing: count('missing'),
    flagged: prepared.flagged.length,
    payments: prepared.untrackedPaymentsCount,
    ask: count('ask'),
  };
  if (prepared.closingMinor === null) return { counts, headline: { kind: 'no-summary' } };
  const difference = prepared.closingMinor - prepared.cardBalanceAtEndMinor;
  if (difference === 0) return { counts, headline: { kind: 'reconciled' } };
  const recorded = missingNet(prepared.rows) - prepared.untrackedPaymentsMinor;
  const left = difference - recorded;
  let likely: string;
  if (left === 0) likely = counts.missing > 0 ? `the ${counts.missing} missing row${counts.missing === 1 ? '' : 's'}` : 'the payments not tracked';
  else if (prepared.flagged.some((f) => f.amountMinor === Math.abs(left))) likely = 'a flagged transaction';
  else likely = 'rows not matched';
  return { counts, headline: { kind: 'differs', differenceMinor: difference, likely } };
}

/** Every missing row has its category, and every ask is answered with one of its own candidates, each taken once. */
export function canRecordAll(rows: readonly CheckDraftRow[], ask: Readonly<Record<number, string>>): boolean {
  if (rows.some((r) => needsCategory(r) && r.categoryId === null)) return false;
  const taken = new Set<string>();
  for (const r of rows) {
    if (r.outcome.status !== 'ask') continue;
    const pick = ask[r.index];
    if (pick === undefined || !r.outcome.candidateIds.includes(pick) || taken.has(pick)) return false;
    taken.add(pick);
  }
  return true;
}

/** The candidates other ask rows already chose: one recorded transaction is one statement row. */
export function takenByOthers(rows: readonly CheckDraftRow[], ask: Readonly<Record<number, string>>, index: number): Set<string> {
  return new Set(
    rows
      .filter((r) => r.outcome.status === 'ask' && r.index !== index)
      .map((r) => ask[r.index])
      .filter((id): id is string => id !== undefined),
  );
}

/** Tied candidates no ask row chose: these are recorded but not on this statement, so they are flagged too. */
export function unchosenTied(rows: readonly CheckDraftRow[], ask: Readonly<Record<number, string>>): string[] {
  const chosen = new Set(Object.values(ask));
  const out: string[] = [];
  for (const r of rows) {
    if (r.outcome.status !== 'ask') continue;
    for (const id of r.outcome.candidateIds) if (!chosen.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface MissingDay {
  date: string;
  rows: CheckDraftRow[];
  /** Money in less money out, as Cashflow's day header counts it. */
  net: number;
}

/** The missing rows by day, in the order the statement prints them. */
export function missingByDay(rows: readonly CheckDraftRow[]): MissingDay[] {
  const days: MissingDay[] = [];
  for (const r of rows) {
    if (r.outcome.status !== 'missing') continue;
    let day = days.find((d) => d.date === r.on);
    if (!day) {
      day = { date: r.on, rows: [], net: 0 };
      days.push(day);
    }
    day.rows.push(r);
    day.net += r.direction === 'in' ? r.amountMinor : -r.amountMinor;
  }
  return days;
}

/** Days before the period's end a recorded transaction may still be billed on the next statement. */
const NEXT_STATEMENT_DAYS = 3;

/** A transaction the statement does not show, dated so near its end that the bank may bill it on the next one. */
export function mayBeOnNextStatement(on: string, period: { start: string; end: string }): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return false;
  const days = (Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000;
  return days >= 0 && days <= NEXT_STATEMENT_DAYS;
}

/** "Record all 9", or with what still holds it back. */
export function recordLabel(total: number, gaps: number): string {
  if (gaps === 0) return `Record all ${total}`;
  return `Record all ${total} · ${gaps} still ${gaps === 1 ? 'needs' : 'need'} a category`;
}

/** The statement's name: the month it starts in, as "May". */
export function statementMonth(period: { start: string; end: string }): string {
  return new Date(`${period.start}T00:00:00`).toLocaleDateString('en-GB', { month: 'long' });
}
