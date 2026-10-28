/** One account the Paid from list offers, as the labelling rule reads it. */
export interface PaidFromRow {
  id: string;
  name: string;
  /** The stored last four digits (a bank account's number, a wallet's phone), else null. */
  digits: string | null;
  /** The balance in the account's own currency, already formatted, else null. */
  balanceText: string | null;
  /** The workspace the account belongs to, when it belongs to one; null otherwise. */
  workspaceName: string | null;
  /** The day the account was added, formatted: the last tell-apart, used only when nothing else separates twins. */
  addedText?: string | null;
}

/** The digits as the Paid with sheet writes them. */
export const digitsText = (digits: string): string => `···· ${digits}`;

const twinKey = (row: Pick<PaidFromRow, 'name' | 'digits'>) => `${row.name.trim().toLowerCase()}|${row.digits ?? ''}`;
const lineOf = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

/**
 * The grey line under each account's name, by account id: its digits first, then its balance, joined by " · ".
 * Two or more accounts of the same name and the same digits would read alike, so those also say which workspace
 * they are in — and, when no workspace tells them apart, when each was added, but only if the line would still
 * read the same as another's. Accounts that differ in name or digits get nothing extra.
 */
export function paidFromCaptions(rows: readonly PaidFromRow[]): Record<string, string> {
  const count = new Map<string, number>();
  for (const row of rows) count.set(twinKey(row), (count.get(twinKey(row)) ?? 0) + 1);
  const base = (row: PaidFromRow) => [row.digits ? digitsText(row.digits) : null, row.balanceText];
  const out: Record<string, string> = {};
  const twins = rows.filter((row) => (count.get(twinKey(row)) ?? 0) > 1);
  for (const row of rows) out[row.id] = lineOf(base(row));
  for (const row of twins) out[row.id] = lineOf([...base(row), row.workspaceName]);
  // Twins that still read alike (no workspace, or the same one) are told apart by the day they were added.
  const again = new Map<string, number>();
  const sameKey = (row: PaidFromRow) => `${twinKey(row)}|${out[row.id]}`;
  for (const row of twins) again.set(sameKey(row), (again.get(sameKey(row)) ?? 0) + 1);
  for (const row of twins) {
    if ((again.get(sameKey(row)) ?? 0) > 1 && row.addedText) out[row.id] = lineOf([...base(row), row.workspaceName, row.addedText]);
  }
  return out;
}

/** What the Paid from row and a bill's page call an account: its name, with the digits when they set it apart from a namesake. */
export function paidFromName(row: Pick<PaidFromRow, 'name' | 'digits'>, others: readonly Pick<PaidFromRow, 'name'>[]): string {
  const namesake = others.some((other) => other !== row && other.name.trim().toLowerCase() === row.name.trim().toLowerCase());
  return namesake && row.digits ? `${row.name} ${digitsText(row.digits)}` : row.name;
}
