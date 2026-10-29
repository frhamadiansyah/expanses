import { type CatalogEntry, findEntry } from '@expanses/catalog';
import {
  bestRedemption,
  pointsWorth,
  type PointsWorth,
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
  programmeOfCard,
  type ProgrammeRow,
  type Database,
  getCardTerms,
  getCatalogState,
  getProgrammeValuePerPoint,
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
  /** The points programme the card earns into: where its balance, expiry and redemptions live. */
  programme: ProgrammeRow | undefined;
  rules: EarnRule[];
  redemptions: RedemptionOptionRow[];
  best: Redemption | null;
  /** The programme's own value per point (0105), scaled; null when none is set. */
  valuePerPoint: number | null;
  /** The workspace's base currency, which that value is in. */
  baseCurrency: string;
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

/** What a count of a card's points is worth: its programme's value per point, else the card's best redemption option. */
export function pointsValue(points: number, cp: Pick<CardPoints, 'best' | 'valuePerPoint' | 'baseCurrency'>): PointsWorth | null {
  return pointsWorth(points, cp.valuePerPoint, cp.best, cp.baseCurrency);
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
  const programme = program ? await programmeOfCard(database, ws, program.id) : undefined;
  const empty: CardPoints = { card, terms, program, programme, rules: [], redemptions: [], best: null, valuePerPoint: null, baseCurrency: ws.baseCurrency, bonuses: [], transferPartners: [], catalog: NO_CATALOG, crediting: 'per_statement', transactionActuals: [], current: null, previous: null };
  if (!program) return empty;

  const rules = await listEarnRules(database, ws, program.id);
  const redemptions = await listRedemptionOptions(database, ws, program.id);
  const actuals = await listCycleActuals(database, ws, program.id);
  const best = bestRedemption(redemptions.map(toRedemption));
  const valuePerPoint = programme ? await getProgrammeValuePerPoint(database, ws, programme.id) : null;
  const bonuses = await listCycleBonuses(database, ws, program.id);
  const transferPartners = await listTransferPartners(database, ws, program.id);
  const state = await getCatalogState(database, ws, program.id);
  const catalog = { ...state, entry: state.entryId ? findEntry(state.entryId) : undefined };
  const transactionActuals = await listTransactionPointActuals(database, ws, program.id);
  const crediting = program.crediting;
  if (program.cycleAnchor === 'statement' && !terms) return { ...empty, rules, redemptions, best, valuePerPoint, bonuses, transferPartners, catalog, crediting, transactionActuals };

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
  return { card, terms, program, programme, rules, redemptions, best, valuePerPoint, baseCurrency: ws.baseCurrency, bonuses, transferPartners, catalog, crediting, transactionActuals, current, previous };
}

export const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// Kept in a plain module of its own; still offered from here, where every card screen already reads it.
export { formatPoints } from './format-points';

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
