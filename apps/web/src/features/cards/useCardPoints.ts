import {
  bestRedemption,
  categoryAncestors,
  computeCycleEarn,
  type Cycle,
  type CycleEarn,
  cycleFor,
  type EarnRule,
  previousCycle,
  type Redemption,
  type SpendLine,
} from '@expanses/core';
import {
  type AccountRow,
  cardSpendLines,
  type CardTermsRow,
  type Database,
  getCardTerms,
  listCycleActuals,
  listEarnRules,
  listPrograms,
  listRedemptionOptions,
  type RedemptionOptionRow,
  type RewardProgramRow,
  toRedemption,
  type WorkspaceContext,
} from '@expanses/db';

export interface CycleResult {
  cycle: Cycle;
  lines: SpendLine[];
  earn: CycleEarn;
  actual: number | null;
}

export interface CardPoints {
  card: AccountRow;
  terms: CardTermsRow | undefined;
  program: RewardProgramRow | undefined;
  rules: EarnRule[];
  redemptions: RedemptionOptionRow[];
  best: Redemption | null;
  /** Null until the program exists and, for statement cycles, the statement day is set. */
  current: CycleResult | null;
  previous: CycleResult | null;
}

export function expenseAncestors(accounts: AccountRow[]): Record<string, string[]> {
  return categoryAncestors(accounts.filter((a) => a.kind === 'expense'));
}

export function pointsValue(points: number, best: Redemption | null): number | null {
  return best ? Math.floor((points * best.valueMinor) / best.perPoints) : null;
}

/** Loads a card's reward setup and derives earn for the cycle containing `onDate` and the one before it. */
export async function loadCardPoints(
  database: Database,
  ws: WorkspaceContext,
  card: AccountRow,
  accounts: AccountRow[],
  onDate: string,
): Promise<CardPoints> {
  const terms = await getCardTerms(database, ws, card.id);
  const program = (await listPrograms(database, ws)).find((p) => p.cardAccountId === card.id);
  const empty: CardPoints = { card, terms, program, rules: [], redemptions: [], best: null, current: null, previous: null };
  if (!program) return empty;

  const rules = await listEarnRules(database, ws, program.id);
  const redemptions = await listRedemptionOptions(database, ws, program.id);
  const actuals = await listCycleActuals(database, ws, program.id);
  const best = bestRedemption(redemptions.map(toRedemption));
  if (program.cycleAnchor === 'statement' && !terms) return { ...empty, rules, redemptions, best };

  const ancestors = expenseAncestors(accounts);
  const statementDay = terms?.statementDay ?? 1;
  const load = async (cycle: Cycle): Promise<CycleResult> => {
    const lines = await cardSpendLines(database, ws, card.id, cycle.start, cycle.end);
    return {
      cycle,
      lines,
      earn: computeCycleEarn(lines, rules, ancestors),
      actual: actuals.find((a) => a.cycleStart === cycle.start)?.actualPoints ?? null,
    };
  };
  const currentCycle = cycleFor(onDate, program.cycleAnchor, statementDay);
  const current = await load(currentCycle);
  const previous = await load(previousCycle(currentCycle, program.cycleAnchor, statementDay));
  return { card, terms, program, rules, redemptions, best, current, previous };
}

export const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const formatPoints = (n: number) => n.toLocaleString('id-ID');
