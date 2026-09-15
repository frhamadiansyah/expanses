import { categoryAncestors, computeCycleEarn, type Cycle, cycleFor } from '@expanses/core';
import { type AccountRow, cardSpendLines, type Database, getCardTerms, listCycleBonuses, listEarnRules, listPrograms, postingDates, type TransactionView, type WorkspaceContext } from '@expanses/db';

export interface PurchasePoints {
  points: number;
  unit: string;
  approximate: boolean;
}

/** The distinct cycles containing any of the dates, in date order. */
export function cyclesCovering(dates: readonly string[], anchor: 'statement' | 'calendar', statementDay: number): Cycle[] {
  const cycles = new Map<string, Cycle>();
  for (const date of [...dates].sort()) {
    const cycle = cycleFor(date, anchor, statementDay);
    cycles.set(cycle.start, cycle);
  }
  return [...cycles.values()];
}

/** Estimated points for each listed card purchase, computed within the purchase's own cycle so caps and bonuses apply. */
export async function loadPurchasePoints(database: Database, ws: WorkspaceContext, transactions: readonly TransactionView[], accounts: readonly AccountRow[]): Promise<Record<string, PurchasePoints>> {
  const cards = new Set(accounts.filter((a) => a.subtype === 'credit_card').map((a) => a.id));
  const onCard = transactions.filter((tx) => tx.status === 'posted' && tx.entries.some((e) => e.accountKind === 'expense') && tx.entries.some((e) => cards.has(e.accountId)));
  // A purchase the bank posted late earns in the cycle it was billed in, so that is the cycle to compute.
  const posted = await postingDates(database, ws, onCard.map((tx) => tx.id));
  const datesByCard = new Map<string, string[]>();
  for (const tx of onCard) {
    const card = tx.entries.find((e) => cards.has(e.accountId))!;
    datesByCard.set(card.accountId, [...(datesByCard.get(card.accountId) ?? []), posted.get(tx.id) ?? tx.occurredOn]);
  }
  if (datesByCard.size === 0) return {};

  const programs = await listPrograms(database, ws);
  const ancestors = categoryAncestors(accounts.filter((a) => a.kind === 'expense'));
  const points: Record<string, PurchasePoints> = {};
  for (const [cardId, dates] of datesByCard) {
    const program = programs.find((p) => p.cardAccountId === cardId);
    if (!program) continue;
    const terms = await getCardTerms(database, ws, cardId);
    if (program.cycleAnchor === 'statement' && !terms) continue;
    const rules = await listEarnRules(database, ws, program.id);
    if (rules.length === 0) continue;
    const billingCurrency = accounts.find((a) => a.id === cardId)?.currency ?? 'IDR';
    const bonuses = await listCycleBonuses(database, ws, program.id);
    for (const cycle of cyclesCovering(dates, program.cycleAnchor, terms?.statementDay ?? 1)) {
      const lines = await cardSpendLines(database, ws, cardId, cycle.start, cycle.end);
      const earn = computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: cycle.end, billingCurrency });
      const approximate = new Set(earn.approximateTransactionIds);
      for (const line of lines) {
        points[line.transactionId] = { points: earn.pointsByTransaction[line.transactionId] ?? 0, unit: program.unit, approximate: approximate.has(line.transactionId) };
      }
    }
  }
  return points;
}
