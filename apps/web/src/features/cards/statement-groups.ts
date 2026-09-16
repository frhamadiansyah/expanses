import type { CardRow, StatementLine } from '@expanses/db';

export interface StatementGroup {
  key: string;
  /** Null for a card alone on its account, whose statement needs no sections. */
  title: string | null;
  /** The card's last four digits, printed after the title in a lighter hand. Null where the section is not a card. */
  digits: string | null;
  kind: 'card' | 'unassigned' | 'account' | 'all';
  lines: StatementLine[];
  /** What the section adds to the statement. */
  totalMinor: number;
}

const total = (lines: readonly StatementLine[]) => lines.reduce((sum, line) => sum + line.countedMinor, 0);

/**
 * A statement split the way the bank prints one for an account with more than one card: each card's purchases
 * and refunds under its own heading, primary first, then payments, which belong to the account rather than a card.
 * A purchase whose card was never recorded gets a section of its own, so it can be spotted and put right.
 */
export function groupStatementLines(lines: readonly StatementLine[], cards: readonly CardRow[]): StatementGroup[] {
  if (cards.length < 2) return [{ key: 'all', title: null, digits: null, kind: 'all', lines: [...lines], totalMinor: total(lines) }];
  const ordered = [...cards].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const groups: StatementGroup[] = [];
  for (const card of ordered) {
    const own = lines.filter((line) => line.spending && line.cardId === card.id);
    if (own.length === 0) continue;
    // The heading says which card, not who holds it: the digits are what a statement is read by.
    groups.push({ key: card.id, title: card.isPrimary ? 'Primary' : 'Supplementary', digits: `···· ${card.last4 ?? '????'}`, kind: 'card', lines: own, totalMinor: total(own) });
  }
  const known = new Set(cards.map((card) => card.id));
  const unassigned = lines.filter((line) => line.spending && (line.cardId === null || !known.has(line.cardId)));
  if (unassigned.length > 0) groups.push({ key: 'unassigned', title: 'Card not recorded', digits: null, kind: 'unassigned', lines: unassigned, totalMinor: total(unassigned) });
  const account = lines.filter((line) => !line.spending);
  if (account.length > 0) groups.push({ key: 'account', title: 'Payment', digits: null, kind: 'account', lines: account, totalMinor: total(account) });
  return groups;
}
