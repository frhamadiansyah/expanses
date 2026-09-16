import { type CatalogEntry, findEntry } from '@expanses/catalog';
import {
  bestRedemption,
  categoryAncestors,
  computeCycleEarn,
  type Cycle,
  type CycleEarn,
  type CycleBonus,
  type CycleContext,
  cycleFor,
  type EarnRule,
  previousCycle,
  type Redemption,
  type SpendLine,
  type TransferPartner,
} from '@expanses/core';
import {
  type AccountRow,
  type CatalogState,
  cardSpendLines,
  type CardTermsRow,
  type Database,
  getCardTerms,
  getCatalogState,
  listCycleActuals,
  listCycleBonuses,
  listEarnRules,
  listPrograms,
  listRedemptionOptions,
  listTransactionPointActuals,
  listTransferPartners,
  type RedemptionOptionRow,
  type RewardProgramRow,
  toRedemption,
  type TransactionPointActual,
  type WorkspaceContext,
} from '@expanses/db';

export interface CycleResult {
  cycle: Cycle;
  lines: SpendLine[];
  earn: CycleEarn;
  /** Statement total, or for per-purchase crediting the bonus points credited outside purchases. */
  actual: number | null;
  /** Inputs of the cycle's computation, for explaining differences. */
  context: CycleContext;
}

export interface CardPoints {
  card: AccountRow;
  terms: CardTermsRow | undefined;
  program: RewardProgramRow | undefined;
  rules: EarnRule[];
  redemptions: RedemptionOptionRow[];
  best: Redemption | null;
  bonuses: CycleBonus[];
  transferPartners: TransferPartner[];
  catalog: CatalogState & { entry: CatalogEntry | undefined };
  crediting: 'per_transaction' | 'per_statement';
  transactionActuals: TransactionPointActual[];
  /** Null until the program exists and, for statement cycles, the statement day is set. */
  current: CycleResult | null;
  previous: CycleResult | null;
}

const NO_CATALOG: CardPoints['catalog'] = { entryId: null, entryVersion: null, status: null, dismissedVersion: null, snapshot: null, memberLevel: null, entry: undefined };

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
  const empty: CardPoints = { card, terms, program, rules: [], redemptions: [], best: null, bonuses: [], transferPartners: [], catalog: NO_CATALOG, crediting: 'per_statement', transactionActuals: [], current: null, previous: null };
  if (!program) return empty;

  const rules = await listEarnRules(database, ws, program.id);
  const redemptions = await listRedemptionOptions(database, ws, program.id);
  const actuals = await listCycleActuals(database, ws, program.id);
  const best = bestRedemption(redemptions.map(toRedemption));
  const bonuses = await listCycleBonuses(database, ws, program.id);
  const transferPartners = await listTransferPartners(database, ws, program.id);
  const state = await getCatalogState(database, ws, program.id);
  const catalog = { ...state, entry: state.entryId ? findEntry(state.entryId) : undefined };
  const transactionActuals = await listTransactionPointActuals(database, ws, program.id);
  const crediting = program.crediting;
  if (program.cycleAnchor === 'statement' && !terms) return { ...empty, rules, redemptions, best, bonuses, transferPartners, catalog, crediting, transactionActuals };

  const ancestors = expenseAncestors(accounts);
  const statementDay = terms?.statementDay ?? 1;
  const load = async (cycle: Cycle): Promise<CycleResult> => {
    const lines = await cardSpendLines(database, ws, card.id, cycle.start, cycle.end);
    const options = { bonuses, cycleEnd: cycle.end, billingCurrency: card.currency ?? 'IDR' };
    return {
      cycle,
      lines,
      earn: computeCycleEarn(lines, rules, ancestors, options),
      actual: actuals.find((a) => a.cycleStart === cycle.start)?.actualPoints ?? null,
      context: { lines, rules, ancestors, options },
    };
  };
  const currentCycle = cycleFor(onDate, program.cycleAnchor, statementDay);
  const current = await load(currentCycle);
  const previous = await load(previousCycle(currentCycle, program.cycleAnchor, statementDay));
  return { card, terms, program, rules, redemptions, best, bonuses, transferPartners, catalog, crediting, transactionActuals, current, previous };
}

export const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const formatPoints = (n: number) => n.toLocaleString('id-ID');

/**
 * Earn for any one cycle of a card whose setup is already loaded, with the actual recorded for it. Used to check a
 * statement further back than the two cycles the page works out on its own.
 */
export async function loadCycleResult(database: Database, ws: WorkspaceContext, cp: CardPoints, accounts: AccountRow[], cycle: Cycle): Promise<CycleResult> {
  const lines = await cardSpendLines(database, ws, cp.card.id, cycle.start, cycle.end);
  const options = { bonuses: cp.bonuses, cycleEnd: cycle.end, billingCurrency: cp.card.currency ?? 'IDR' };
  const actuals = cp.program ? await listCycleActuals(database, ws, cp.program.id) : [];
  const ancestors = expenseAncestors(accounts);
  return {
    cycle,
    lines,
    earn: computeCycleEarn(lines, cp.rules, ancestors, options),
    actual: actuals.find((a) => a.cycleStart === cycle.start)?.actualPoints ?? null,
    context: { lines, rules: cp.rules, ancestors, options },
  };
}
