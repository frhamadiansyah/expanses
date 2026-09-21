import {
  addMonths,
  convertMinor,
  DEFAULT_EMERGENCY_BASE,
  type EmergencyBase,
  emergencyOutgoingMinor,
  fitByRank,
  formatMinor,
  type GoalLink,
  type GoalPlan,
  goalPlan,
  goalUnitsFor,
  isoDate,
  monthOf,
  priceMicroFrom,
  type RankFit,
  roundHalfAwayFromZero,
  unitsValueMinor,
  uuidv7,
} from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database } from '../database';
import { auditLog } from '../schema';
import { investmentTrades } from '../schema-assets';
import { goals } from '../schema-goals';
import { listAssetProfiles } from './assets';
import { assetValuesAt } from './asset-values';
import { periodFlows } from './flows';
import { resolveRates } from './fx';
import { type EmergencyInputs, listGoalCalculators } from './goal-calculators';
import { type GoalRow, GoalDbError, listEarmarks, listGoals } from './goals';
import { nativeBalances } from './ledger';
import { listTrades } from './trades';
import { listTradeTemplates } from './trade-templates';

export interface GoalLinkRow extends GoalLink {
  goalId: string;
  /** Set aside more than the account holds, so the link was capped at the balance. */
  overBalance: boolean;
}

export interface GoalPlanRow extends GoalPlan {
  goal: GoalRow;
  links: GoalLinkRow[];
  earmarkWarning: string | null;
}

export interface GoalSummary {
  plans: GoalPlanRow[];
  neededMonthlyMinor: number;
  plannedMonthlyMinor: number;
  /** Take-home pay minus spending and loan principal, as a monthly figure. */
  capacityMonthlyMinor: number;
  fits: RankFit[];
}

/** Moves a buy to another goal in place. Goals are not ledger data, so no transaction is touched. */
export async function retagTrade(database: Database, ws: WorkspaceContext, tradeId: string, goalId: string | null): Promise<void> {
  await database.transaction(async (tx) => {
    const [trade] = await tx
      .select({ id: investmentTrades.id, goalId: investmentTrades.goalId })
      .from(investmentTrades)
      .where(and(eq(investmentTrades.id, tradeId), eq(investmentTrades.workspaceId, ws.workspaceId), eq(investmentTrades.status, 'active')));
    if (!trade) throw new GoalDbError('That trade was already changed or removed');
    if (goalId !== null) {
      const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
      if (!goal) throw new GoalDbError('Goal not found in this workspace');
    }
    await tx.update(investmentTrades).set({ goalId }).where(eq(investmentTrades.id, tradeId));
    await tx.insert(auditLog).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      action: 'retag_goal',
      entity: 'investment_trade',
      entityId: tradeId,
      payloadJson: JSON.stringify({ from: trade.goalId, to: goalId }),
      createdAt: new Date().toISOString(),
    });
  });
}

/** What funds each goal on a date: units tagged to it, and money set aside from savings. */
export async function goalLinksFor(database: Database, ws: WorkspaceContext, date: string): Promise<GoalLinkRow[]> {
  const goalRows = await listGoals(database, ws);
  if (goalRows.length === 0) return [];
  const known = new Set(goalRows.map((goal) => goal.id));

  const trades = await listTrades(database, ws);
  const unitsByAccount = goalUnitsFor(trades, date);
  const values = await assetValuesAt(database, ws, date);
  const profiles = await listAssetProfiles(database, ws);
  const links: Omit<GoalLinkRow, 'baseMinor'>[] = [];

  for (const [accountId, units] of Object.entries(unitsByAccount)) {
    const value = values.find((row) => row.accountId === accountId);
    if (!value || !value.unitsMicro || value.unitsMicro <= 0) continue;
    const priceMicro = priceMicroFrom(value.valueMinor, value.unitsMicro);
    const risk = profiles.find((profile) => profile.accountId === accountId)?.risk ?? null;
    for (const [goalId, unitsMicro] of Object.entries(units.byGoal)) {
      if (!goalId || !known.has(goalId) || unitsMicro <= 0) continue;
      links.push({
        goalId,
        accountId,
        name: value.name,
        kind: 'tagged',
        unitsMicro,
        // `assetValuesAt` values each account in its own currency — `netWorthAt` has to convert to add them
        // up — so a holding abroad is carried here in its own money too, and the currency comes with it.
        valueMinor: unitsValueMinor(unitsMicro, priceMicro),
        currency: value.currency,
        risk,
        overBalance: false,
      });
    }
  }

  const earmarks = await listEarmarks(database, ws);
  if (earmarks.length > 0) {
    const balances = await nativeBalances(database, ws, date);
    for (const earmark of earmarks) {
      if (!known.has(earmark.goalId)) continue;
      const balanceMinor = Math.max(0, balances[earmark.accountId] ?? 0);
      const account = values.find((row) => row.accountId === earmark.accountId);
      links.push({
        goalId: earmark.goalId,
        accountId: earmark.accountId,
        name: account?.name ?? 'Account',
        kind: 'earmark',
        unitsMicro: null,
        // The set-aside sits on the destination account and is counted in that account's own money:
        // parking US$100 against a goal sets US$100 aside, never Rp 1.600.000 of a USD balance.
        valueMinor: Math.min(earmark.amountMinor, balanceMinor),
        currency: account?.currency ?? ws.baseCurrency,
        risk: null,
        overBalance: earmark.amountMinor > balanceMinor,
      });
    }
  }

  return withBaseAmounts(database, ws, links, date);
}

/**
 * Each link's value in the base currency, or null where no rate is known for the day.
 *
 * No fetcher: a goals screen reads what is already stored. `resolveRates` falls back to the last rate it
 * has and reports the rest as missing, and a missing one stays missing — `toBase` elsewhere answers 0 for
 * an absent rate, which is defensible on a tax form (a figure you cannot substantiate must not be filed)
 * and is the wrong answer here, where it reads as "you have saved nothing".
 */
async function withBaseAmounts(
  database: Database,
  ws: WorkspaceContext,
  links: Omit<GoalLinkRow, 'baseMinor'>[],
  date: string,
): Promise<GoalLinkRow[]> {
  const foreign = [...new Set(links.map((link) => link.currency).filter((currency) => currency !== ws.baseCurrency))];
  const rates: Record<string, number> =
    foreign.length > 0 ? (await resolveRates(database, { currencies: foreign, baseCurrency: ws.baseCurrency, onDate: date, today: isoDate() })).rates : {};
  return links.map((link) => {
    if (link.currency === ws.baseCurrency) return { ...link, baseMinor: link.valueMinor };
    const rate = rates[link.currency];
    return { ...link, baseMinor: rate === undefined ? null : convertMinor(link.valueMinor, link.currency, ws.baseCurrency, rate) };
  });
}

const perMonth = (totalMinor: number, months: number) => (months > 0 ? roundHalfAwayFromZero(totalMinor / months) : 0);

/** Every goal's plan, what they need together, and how they fit into what you can save. */
export async function goalPlansFor(database: Database, ws: WorkspaceContext, date: string): Promise<GoalSummary> {
  const goalRows = await listGoals(database, ws);
  const links = await goalLinksFor(database, ws, date);
  // What you can put away is yours, not one workspace's, and it is counted in your own currency.
  const flows = await periodFlows(database, ownerScope(ws), { from: `${addMonths(monthOf(date), -11)}-01`, to: date });
  // What an emergency goal's months multiply: the function the ratio card divides by, on the base the goal's own
  // working chose — essential unless it said all. Loan principal is inside either way; the interest never twice.
  const baseOf = new Map<string, EmergencyBase>(
    (await listGoalCalculators(database, ws))
      .filter((row) => row.kind === 'emergency')
      .map((row) => [row.goalId, (row.inputs as EmergencyInputs).base ?? DEFAULT_EMERGENCY_BASE]),
  );
  // Summed signed inside emergencyOutgoingMinor, then clamped once here: refunds larger than spending make a month of
  // nothing, never a negative target.
  const outgoingFor = (goalId: string) => Math.max(0, perMonth(emergencyOutgoingMinor(flows, baseOf.get(goalId) ?? DEFAULT_EMERGENCY_BASE), flows.months));
  // What is left over takes the same care: the interest is an expense, so subtracting the whole payment
  // beside spending would take it out twice and make every goal look further away than it is. The principal
  // is still subtracted — it builds equity, but the cash has left the account and cannot fund a goal.
  const capacityMonthlyMinor = Math.max(0, perMonth(flows.incomeMinor - flows.spendingMinor - flows.debtPrincipalMinor, flows.months));

  const templates = (await listTradeTemplates(database, ws)).filter((template) => template.active && template.goalId);
  const values = await assetValuesAt(database, ws, date);
  const monthlyFromTemplates = (goalId: string) =>
    templates
      .filter((template) => template.goalId === goalId)
      .reduce((total, template) => {
        if (template.amountMinor !== null) return total + template.amountMinor;
        const value = values.find((row) => row.accountId === template.accountId);
        if (!value || !value.unitsMicro || value.unitsMicro <= 0 || template.unitsMicro === null) return total;
        return total + unitsValueMinor(template.unitsMicro, priceMicroFrom(value.valueMinor, value.unitsMicro));
      }, 0);

  const plans: GoalPlanRow[] = goalRows.map((goal) => {
    const mine = links.filter((link) => link.goalId === goal.id);
    const plan = goalPlan(goal, mine, monthlyFromTemplates(goal.id), outgoingFor(goal.id), date);
    const over = mine.find((link) => link.overBalance);
    // A link with no rate is left out of the total, so the total is honest; saying so is what keeps the
    // *goal* honest, and `earmarkWarning` is the slot the screen already paints for exactly this.
    const unconverted = mine.filter((link) => link.baseMinor === null);
    const warnings = [
      over ? `You set aside more for this goal than ${over.name} holds, so only what is there counts.` : null,
      unconverted.length > 0
        ? `${unconverted.map((link) => formatMinor(link.valueMinor, link.currency)).join(', ')} is not counted here: no ${ws.baseCurrency} rate for ${date}.`
        : null,
    ].filter((warning): warning is string => warning !== null);
    return {
      ...plan,
      goal,
      links: mine,
      earmarkWarning: warnings.length > 0 ? warnings.join(' ') : null,
    };
  });

  return {
    plans,
    neededMonthlyMinor: plans.reduce((total, plan) => total + plan.requiredMonthlyMinor, 0),
    plannedMonthlyMinor: plans.reduce((total, plan) => total + plan.plannedMonthlyMinor, 0),
    capacityMonthlyMinor,
    fits: fitByRank(plans, goalRows, capacityMonthlyMinor),
  };
}
