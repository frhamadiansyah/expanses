import {
  GoalError,
  type GoalMoney,
  goalMoneyOf,
  type GoalUnits,
  addMonths,
  convertMinor,
  DEFAULT_EMERGENCY_BASE,
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
  retagFits,
  resplitFits,
  splitFits,
  tradedByMoney,
  type GoalPart,
  type RankFit,
  roundHalfAwayFromZero,
  unitsValueMinor,
  uuidv7,
  wholeSince,
} from '@expanses/core';
import { and, eq, inArray } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, auditLog } from '../schema';
import { investmentTrades } from '../schema-assets';
import { goals } from '../schema-goals';
import { listAssetProfiles } from './assets';
import { assetValuesAt } from './asset-values';
import { periodFlows } from './flows';
import { goalContributionEvents } from './goal-contributions';
import { resolveRates } from './fx';
import { type EmergencyInputs, listGoalCalculators } from './goal-calculators';
import { type GoalRow, GoalDbError, listEarmarks, listGoals } from './goals';
import { type DrawRow, listDraws, setAsideViews } from './set-aside';
import { activeTrades, listTrades, switchPairTx } from './trades';
import { markTradeGoalsDirtyTx, writeGoalPartsTx } from './goal-parts';
import { listTradeTemplates } from './trade-templates';

/** A switch's two trades carry money with no goal, and only that: neither is given one. */
const SWITCH_NO_GOAL = 'A switch takes only money with no goal';

export interface GoalLinkRow extends GoalLink {
  goalId: string;
  /** `valueMinor` in the goal's own currency; null when no rate is known for the day. */
  goalMinor: number | null;
  /** Set aside more than the account holds, so the link was capped at the balance. */
  overBalance: boolean;
  /** What the goal promised on this account, in its own money. Null for tagged units. */
  promisedMinor: number | null;
  /** What of that promise the account does not hold (`setAsideOn`). 0 for tagged units. */
  shortMinor: number;
}

export interface GoalPlanRow extends GoalPlan {
  goal: GoalRow;
  links: GoalLinkRow[];
  earmarkWarning: string | null;
  /** The no-rate sentence alone, without the short-account one (spec §7.3). */
  unconvertedWarning: string | null;
  /** The currency every `…Minor` figure of this plan is in: the goal's own. */
  currency: string;
  /** What this plan's monthly need, set-up amount and funds hold in the base currency; null when the goal's currency has no rate. */
  requiredMonthlyBaseMinor: number | null;
  plannedMonthlyBaseMinor: number | null;
  currentBaseMinor: number | null;
  /** Base currency per 1 major unit of `currency` on the day (1 for a base goal); null when no rate is stored. */
  rateToBase: number | null;
}

export interface GoalSummary {
  plans: GoalPlanRow[];
  /** Totals across goals, in the base currency: each goal's figure converted at the day's rate (a goal with no rate is left out). */
  neededMonthlyMinor: number;
  plannedMonthlyMinor: number;
  /** Take-home pay minus spending and loan principal, as a monthly figure. */
  capacityMonthlyMinor: number;
  fits: RankFit[];
}

/**
 * Splits a recorded buy (or sell) between goals in place, or — with no parts — clears its split. Goals are not ledger
 * data, so no transaction is touched. Refused when the parts do not fit the trade, or a goal that later sold from it
 * would be left short. One part that takes the whole trade is that one goal, as `retagTrade` saves it.
 */
export async function resplitTrade(database: Database, ws: WorkspaceContext, tradeId: string, parts: readonly GoalPart[]): Promise<void> {
  await database.transaction(async (tx) => {
    const trades = await activeTrades(tx, ws);
    const trade = trades.find((row) => row.id === tradeId);
    if (!trade) throw new GoalDbError('That trade was already changed or removed');
    if (trade.switchedWith) throw new GoalDbError(SWITCH_NO_GOAL);
    const holding = trades.filter((row) => row.accountId === trade.accountId);
    const byMoney = tradedByMoney(holding);
    const kept = parts.filter((part) => (byMoney ? part.moneyMinor : part.unitsMicro) > 0);
    const ids = [...new Set(kept.map((part) => part.goalId))];
    if (ids.length > 0) {
      const found = await tx.select({ id: goals.id }).from(goals).where(and(inArray(goals.id, ids), eq(goals.workspaceId, ws.workspaceId)));
      if (found.length !== ids.length) throw new GoalDbError('Goal not found in this workspace');
    }
    if (!resplitFits(holding, tradeId, kept)) {
      throw new GoalDbError(
        kept.length > 0 && !splitFits(trade, kept, byMoney)
          ? 'The goals take more than this trade; enter up to its own amount'
          : 'Units from this purchase were already sold from its goal, so it cannot move',
      );
    }
    const whole = byMoney ? trade.grossMinor : trade.unitsMicro;
    const one = kept.length === 1 && (byMoney ? kept[0]!.moneyMinor : kept[0]!.unitsMicro) === whole ? kept[0]!.goalId : null;
    await markTradeGoalsDirtyTx(tx, tradeId);
    await tx.update(investmentTrades).set({ goalId: one }).where(eq(investmentTrades.id, tradeId));
    await writeGoalPartsTx(tx, tradeId, one ? [] : kept);
    await markTradeGoalsDirtyTx(tx, tradeId);
    await tx.insert(auditLog).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      action: 'retag_goal',
      entity: 'investment_trade',
      entityId: tradeId,
      payloadJson: JSON.stringify({ from: trade.goalParts ?? trade.goalId, to: one ?? kept }),
      createdAt: new Date().toISOString(),
    });
  });
}

/** Moves a buy to another goal in place. Goals are not ledger data, so no transaction is touched. */
export async function retagTrade(database: Database, ws: WorkspaceContext, tradeId: string, goalId: string | null): Promise<void> {
  await database.transaction(async (tx) => {
    const [trade] = await tx
      .select({ id: investmentTrades.id, goalId: investmentTrades.goalId, accountId: investmentTrades.accountId })
      .from(investmentTrades)
      .where(and(eq(investmentTrades.id, tradeId), eq(investmentTrades.workspaceId, ws.workspaceId), eq(investmentTrades.status, 'active')));
    if (!trade) throw new GoalDbError('That trade was already changed or removed');
    if (await switchPairTx(tx, ws, tradeId)) throw new GoalDbError(SWITCH_NO_GOAL);
    if (goalId !== null) {
      const [goal] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
      if (!goal) throw new GoalDbError('Goal not found in this workspace');
    }
    // A goal that sold units after this buy needs them: moving the buy away would leave it selling what it never held,
    // and every goal's figures are read from these units.
    if (!retagFits(await activeTrades(tx, ws, trade.accountId), tradeId, goalId)) {
      throw new GoalDbError('Units from this purchase were already sold from its goal, so it cannot move');
    }
    await markTradeGoalsDirtyTx(tx, tradeId);
    await tx.update(investmentTrades).set({ goalId }).where(eq(investmentTrades.id, tradeId));
    await markTradeGoalsDirtyTx(tx, tradeId);
    // One goal now: a split it had is gone with the move.
    await writeGoalPartsTx(tx, tradeId, []);
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
  return (await goalLinksWithRates(database, ws, date)).links;
}

/**
 * `amountMinor` of `from` in `to`, going through the base currency the stored rates are all against (`rates[c]` is
 * base per 1 major unit of c). The same currency is returned as it is, exact; null where a rate is missing.
 */
export function viaBaseMinor(amountMinor: number, from: string, to: string, base: string, rates: Record<string, number>): number | null {
  if (from === to) return amountMinor;
  const fromRate = from === base ? 1 : rates[from];
  const toRate = to === base ? 1 : rates[to];
  if (fromRate === undefined || toRate === undefined) return null;
  return convertMinor(amountMinor, from, to, fromRate / toRate);
}

interface LinksWithRates {
  links: GoalLinkRow[];
  rates: Record<string, number>;
}

async function goalLinksWithRates(database: Database, ws: WorkspaceContext, date: string): Promise<LinksWithRates> {
  const goalRows = await listGoals(database, ws);
  if (goalRows.length === 0) return { links: [], rates: {} };
  const known = new Set(goalRows.map((goal) => goal.id));

  const trades = await listTrades(database, ws);
  const values = await assetValuesAt(database, ws, date);
  // A fund tracked by money is shared out by money below; units are walked only for holdings counted in units.
  const byMoney = new Set(values.filter((value) => value.mode === 'amount').map((value) => value.accountId));
  const unitsByAccount: Record<string, GoalUnits | null> = goalUnitsFor(trades.filter((trade) => !byMoney.has(trade.accountId)), date);
  for (const accountId of byMoney) if (trades.some((trade) => trade.accountId === accountId)) unitsByAccount[accountId] = null;
  const profiles = await listAssetProfiles(database, ws);
  const links: Omit<GoalLinkRow, 'baseMinor' | 'goalMinor'>[] = [];

  for (const [accountId, units] of Object.entries(unitsByAccount)) {
    const value = values.find((row) => row.accountId === accountId);
    if (value?.mode === 'amount') {
      /* A fund tracked by money: each goal holds its share of the value by the money it put in (spec
         2026-10-19-fund-by-amount) — 600.000 of 1.500.000 in a fund worth 1.552.000 is 620.800. */
      const own = trades.filter((trade) => trade.accountId === accountId);
      let money: GoalMoney;
      try {
        money = goalMoneyOf(own, date);
      } catch (e) {
        // One fund whose history no longer adds up must not take every goal's figures with it.
        if (e instanceof GoalError) continue;
        throw e;
      }
      const risk = profiles.find((profile) => profile.accountId === accountId)?.risk ?? null;
      for (const [goalId, moneyMinor] of Object.entries(money.byGoal)) {
        if (!goalId || !known.has(goalId) || moneyMinor <= 0 || money.costMinor <= 0) continue;
        links.push({
          goalId,
          accountId,
          name: value.name,
          kind: 'tagged',
          unitsMicro: null,
          moneyMinor,
          valueMinor: Math.round((value.valueMinor * moneyMinor) / money.costMinor),
          currency: value.currency,
          risk,
          overBalance: false,
          promisedMinor: null,
          shortMinor: 0,
        });
      }
      continue;
    }
    if (!units || !value || !value.unitsMicro || value.unitsMicro <= 0) continue;
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
        promisedMinor: null,
        shortMinor: 0,
      });
    }
  }

  const earmarks = await listEarmarks(database, ws);
  if (earmarks.length > 0) {
    // Shared out across the account's goals, never capped goal by goal: two goals cannot both count the same money.
    const views = await setAsideViews(database, ws, { date });
    for (const earmark of earmarks) {
      if (!known.has(earmark.goalId)) continue;
      const view = views[earmark.accountId];
      const share = view?.goals.find((goal) => goal.goalId === earmark.goalId);
      const account = values.find((row) => row.accountId === earmark.accountId);
      links.push({
        goalId: earmark.goalId,
        accountId: earmark.accountId,
        name: view?.name ?? account?.name ?? 'Account',
        kind: 'earmark',
        unitsMicro: null,
        // In the account's own money: parking US$100 against a goal sets US$100 aside, never Rp 1.600.000.
        valueMinor: share?.coveredMinor ?? 0,
        currency: view?.currency ?? account?.currency ?? ws.baseCurrency,
        risk: null,
        promisedMinor: earmark.amountMinor,
        shortMinor: share?.shortMinor ?? 0,
        overBalance: (share?.shortMinor ?? 0) > 0,
      });
    }
  }

  return withBaseAmounts(database, ws, links, date, new Map(goalRows.map((goal) => [goal.id, goal.currency])));
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
  links: Omit<GoalLinkRow, 'baseMinor' | 'goalMinor'>[],
  date: string,
  goalCurrency: Map<string, string>,
): Promise<LinksWithRates> {
  // The goals' own currencies are wanted too: a link is counted in the goal's money, via the base.
  const wanted = [...links.map((link) => link.currency), ...goalCurrency.values()];
  const foreign = [...new Set(wanted.filter((currency) => currency !== ws.baseCurrency))];
  const rates: Record<string, number> =
    foreign.length > 0 ? (await resolveRates(database, { currencies: foreign, baseCurrency: ws.baseCurrency, onDate: date, today: isoDate() })).rates : {};
  return {
    rates,
    links: links.map((link) => {
      const baseMinor = viaBaseMinor(link.valueMinor, link.currency, ws.baseCurrency, ws.baseCurrency, rates);
      const goalMinor = viaBaseMinor(link.valueMinor, link.currency, goalCurrency.get(link.goalId) ?? ws.baseCurrency, ws.baseCurrency, rates);
      return { ...link, baseMinor, goalMinor };
    }),
  };
}

const perMonth = (totalMinor: number, months: number) => (months > 0 ? roundHalfAwayFromZero(totalMinor / months) : 0);

/** Every goal's plan, what they need together, and how they fit into what you can save. */
export async function goalPlansFor(database: Database, ws: WorkspaceContext, date: string): Promise<GoalSummary> {
  const goalRows = await listGoals(database, ws);
  const { links, rates } = await goalLinksWithRates(database, ws, date);
  const base = ws.baseCurrency;
  const inGoal = (goal: GoalRow, baseMinor: number) => viaBaseMinor(baseMinor, base, goal.currency, base, rates) ?? 0;
  const inBase = (goal: GoalRow, goalMinor: number) => viaBaseMinor(goalMinor, goal.currency, base, base, rates);
  // What you can put away is yours, not one workspace's, and it is counted in your own currency.
  const flows = await periodFlows(database, ownerScope(ws), { from: `${addMonths(monthOf(date), -11)}-01`, to: date });
  // What an emergency goal's months multiply: the function the ratio card divides by, on the base the goal's own
  // working chose — essential unless it said all. Loan principal is inside either way; the interest never twice.
  const emergencyWorkings = new Map(
    (await listGoalCalculators(database, ws)).filter((row) => row.kind === 'emergency').map((row) => [row.goalId, row.inputs as EmergencyInputs]),
  );
  // Summed signed inside emergencyOutgoingMinor, then clamped once here: refunds larger than spending make a month of
  // nothing, never a negative target. A working that typed its own monthly figure uses that instead of the records.
  const outgoingFor = (goalId: string) => {
    const working = emergencyWorkings.get(goalId);
    if (working?.monthlyOutgoingMinor !== undefined) return working.monthlyOutgoingMinor;
    return Math.max(0, perMonth(emergencyOutgoingMinor(flows, working?.base ?? DEFAULT_EMERGENCY_BASE), flows.months));
  };
  // What is left over takes the same care: the interest is an expense, so subtracting the whole payment
  // beside spending would take it out twice and make every goal look further away than it is. The principal
  // is still subtracted — it builds equity, but the cash has left the account and cannot fund a goal.
  const capacityMonthlyMinor = Math.max(0, perMonth(flows.incomeMinor - flows.spendingMinor - flows.debtPrincipalMinor, flows.months));

  const templates = (await listTradeTemplates(database, ws)).filter((template) => template.active && template.goalId);
  const values = await assetValuesAt(database, ws, date);
  // A monthly buy is counted in the base currency (its amount is money paid from the owner's accounts).
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
    const plan = goalPlan(goal, mine, inGoal(goal, monthlyFromTemplates(goal.id)), inGoal(goal, outgoingFor(goal.id)), date);
    // A link with no rate is left out of the total, so the total is honest; saying so is what keeps the
    // *goal* honest, and `earmarkWarning` is the slot the screen already paints for exactly this.
    const unconverted = mine.filter((link) => link.goalMinor === null);
    const short = mine.filter((link) => link.shortMinor > 0);
    const shortWarning = short.length
      ? short.map((link) => `${link.name} holds less than is set aside, so this goal is short by ${formatMinor(link.shortMinor, link.currency)} there.`).join(' ')
      : null;
    const unconvertedWarning =
      unconverted.length > 0
        ? `${unconverted.map((link) => formatMinor(link.valueMinor, link.currency)).join(', ')} is not counted here: no ${goal.currency} rate for ${date}.`
        : null;
    const warnings = [shortWarning, unconvertedWarning].filter((warning): warning is string => warning !== null);
    return {
      ...plan,
      goal,
      links: mine,
      earmarkWarning: warnings.length > 0 ? warnings.join(' ') : null,
      unconvertedWarning,
      currency: goal.currency,
      requiredMonthlyBaseMinor: inBase(goal, plan.requiredMonthlyMinor),
      plannedMonthlyBaseMinor: inBase(goal, plan.plannedMonthlyMinor),
      currentBaseMinor: inBase(goal, plan.currentMinor),
      rateToBase: goal.currency === base ? 1 : (rates[goal.currency] ?? null),
    };
  });

  // The totals and the fit against what can be saved are in the base currency, as that saving is.
  const inBasePlan = (plan: GoalPlanRow) => ({ ...plan, requiredMonthlyMinor: plan.requiredMonthlyBaseMinor ?? 0, plannedMonthlyMinor: plan.plannedMonthlyBaseMinor ?? 0 });
  return {
    plans,
    neededMonthlyMinor: plans.reduce((total, plan) => total + (plan.requiredMonthlyBaseMinor ?? 0), 0),
    plannedMonthlyMinor: plans.reduce((total, plan) => total + (plan.plannedMonthlyBaseMinor ?? 0), 0),
    capacityMonthlyMinor,
    fits: fitByRank(plans.map(inBasePlan), goalRows, capacityMonthlyMinor),
  };
}

export interface GoalWholeness {
  /** Covered set-aside at least the target, and short on no account. Derived, never stored. */
  whole: boolean;
  /** The day it last became whole, when the records can say (spec §7.2); null otherwise. */
  since: string | null;
}

export async function goalWholeness(database: Database, ws: WorkspaceContext, date: string): Promise<Record<string, GoalWholeness>> {
  const summary = await goalPlansFor(database, ws, date);
  const events = await goalContributionEvents(database, ws, { to: date });
  const draws = await listDraws(database, ws, date);
  const out: Record<string, GoalWholeness> = {};
  for (const plan of summary.plans) {
    const whole = plan.totalTargetMinor > 0 && plan.currentMinor >= plan.totalTargetMinor && plan.links.every((link) => link.shortMinor === 0);
    // Only a goal held wholly in base-currency set-asides has a dated trail: units and foreign money move for reasons no log keeps.
    const traceable = plan.goal.currency === ws.baseCurrency && plan.links.length > 0 && plan.links.every((link) => link.kind === 'earmark' && link.currency === ws.baseCurrency);
    if (!whole || !traceable) {
      out[plan.goalId] = { whole, since: null };
      continue;
    }
    const mine = draws.filter((draw) => draw.goalId === plan.goalId);
    const trail = [
      ...events.filter((event) => event.goalId === plan.goalId && event.kind !== 'buy').map((event) => ({ occurredOn: event.occurredOn, amountMinor: event.amountMinor })),
      ...mine.filter((draw) => draw.intent === 'spend').map((draw) => ({ occurredOn: draw.occurredOn, amountMinor: -draw.amountMinor })),
    ];
    const lastBorrow = mine.filter((draw) => draw.intent === 'borrow').map((draw) => draw.occurredOn).sort().at(-1) ?? null;
    out[plan.goalId] = { whole, since: wholeSince(trail, plan.currentMinor, plan.totalTargetMinor, lastBorrow) };
  }
  return out;
}

export interface GoalHistoryEntry {
  key: string;
  /** The local record behind the line (not `key`, which is an index): stable between reads. Absent on "reached". */
  sourceId?: string;
  /** The stage a spend paid. */
  stageId?: string | null;
  kind: 'set-aside' | 'taken-back' | 'borrowed' | 'spent' | 'moved' | 'reached';
  occurredOn: string;
  /** Signed, in `currency`. Null for "reached the target", which is a day, not a movement. */
  amountMinor: number | null;
  currency: string;
  text: string;
}

/** How many history lines a goal's card shows. */
export const GOAL_HISTORY_LENGTH = 6;

/**
 * Per goal, its history newest first: the newest `limit` (six, the card's) or, with `limit: null`, all of it — what a
 * reader that looks past the six (the "Fully funded" window's reached day) must read.
 */
export async function goalHistory(
  database: Database,
  ws: WorkspaceContext,
  date: string,
  { limit = GOAL_HISTORY_LENGTH }: { limit?: number | null } = {},
): Promise<Record<string, GoalHistoryEntry[]>> {
  const events = await goalContributionEvents(database, ws, { to: date });
  const draws = await listDraws(database, ws, date);
  const accountRows = await database.db.select({ id: accounts.id, name: accounts.name, currency: accounts.currency }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId));
  const account = new Map(accountRows.map((row) => [row.id, row]));
  const byGoal: Record<string, GoalHistoryEntry[]> = {};
  const push = (goalId: string, entry: GoalHistoryEntry) => (byGoal[goalId] ??= []).push(entry);

  events.forEach((event, index) => {
    if (event.kind === 'buy') return;
    const where = event.accountId ? account.get(event.accountId) : undefined;
    push(event.goalId, {
      key: `event-${index}`,
      sourceId: event.sourceId,
      kind: event.amountMinor >= 0 ? 'set-aside' : 'taken-back',
      occurredOn: event.occurredOn,
      amountMinor: event.amountMinor,
      // A set-aside change is in its account's money; a tagged transfer is counted in base, as the monthly figure counts it.
      currency: event.kind === 'earmark' ? (where?.currency ?? ws.baseCurrency) : ws.baseCurrency,
      text: where?.name ?? '',
    });
  });
  for (const draw of draws) {
    // A goal's own money moved by a tagged transfer (Task 6: a move with no destination) is already in the history
    // twice over — the promise taken back off the source, the transfer set aside at the destination. A third line
    // reading "Moved … to another account" would be the same money again.
    if (draw.intent === 'move' && draw.toAccountId === null) continue;
    const currency = account.get(draw.accountId)?.currency ?? ws.baseCurrency;
    const kind = draw.intent === 'borrow' ? 'borrowed' : draw.intent === 'spend' ? 'spent' : 'moved';
    push(draw.goalId, {
      key: draw.id,
      sourceId: draw.id,
      stageId: draw.stageId,
      kind,
      occurredOn: draw.occurredOn,
      amountMinor: draw.intent === 'move' ? draw.amountMinor : -draw.amountMinor,
      currency,
      text: draw.intent === 'move' ? `to ${account.get(draw.toAccountId ?? '')?.name ?? 'another account'}` : draw.description,
    });
  }
  const reached = new Map<string, DrawRow>();
  for (const draw of draws) {
    if (draw.intent !== 'borrow' || !draw.wasWhole || !draw.wholeSince) continue;
    const known = reached.get(draw.goalId);
    if (!known || known.occurredOn < draw.occurredOn) reached.set(draw.goalId, draw);
  }
  for (const [goalId, draw] of reached) push(goalId, { key: `reached-${draw.id}`, kind: 'reached', occurredOn: draw.wholeSince!, amountMinor: null, currency: ws.baseCurrency, text: 'Reached the target' });

  for (const goalId of Object.keys(byGoal)) {
    byGoal[goalId] = byGoal[goalId]!
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || Number(b.kind === 'reached') - Number(a.kind === 'reached'))
      .slice(0, limit ?? undefined);
  }
  return byGoal;
}
