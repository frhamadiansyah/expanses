import { WATCH_BAND, type RatioStatus } from '../assets/health';
import type { CategoryNeed } from './needs';

/**
 * Essential · Lifestyle · Debts & savings: where a period's income went.
 *
 * Income and spending are the figures Cashflow already shows for the period; each spending category counts under its
 * resolved mark (unmarked is essential, as on the budget sheet and the emergency fund). Debts & savings is what is
 * left of the income once both are taken off, so the three always add back to the income — and it can go below
 * nought, when more went out than came in.
 *
 * Cashflow's Income page, the Budget box and the Financial health card all read this one function.
 */

/** The share of income each part is held against, in whole percent. The three add up to 100. */
export interface SpendingGuide {
  essential: number;
  lifestyle: number;
  debtsSavings: number;
}

export const DEFAULT_SPENDING_GUIDE: SpendingGuide = { essential: 50, lifestyle: 30, debtsSavings: 20 };

/** What is left to place before the three add up to 100: negative when they add up to more. */
export const guideLeft = (guide: SpendingGuide): number => 100 - guide.essential - guide.lifestyle - guide.debtsSavings;

/** Whole percents from 0 to 100 that add up to exactly 100. */
export function isValidGuide(guide: SpendingGuide): boolean {
  const parts = [guide.essential, guide.lifestyle, guide.debtsSavings];
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 100) && guideLeft(guide) === 0;
}

/** A stored guide read back: anything that is not a valid guide reads as the default. */
export function readGuide(value: unknown): SpendingGuide {
  if (!value || typeof value !== 'object') return DEFAULT_SPENDING_GUIDE;
  const raw = value as Record<string, unknown>;
  const guide = { essential: Number(raw.essential), lifestyle: Number(raw.lifestyle), debtsSavings: Number(raw.debtsSavings) };
  return isValidGuide(guide) ? guide : DEFAULT_SPENDING_GUIDE;
}

export interface EssentialSplitInput {
  /** What Cashflow counts as income over the period. */
  incomeMinor: number;
  /** What Cashflow counts as spending over the period, by category, signed: a refund lowers its category. */
  spending: readonly { accountId: string; amountBaseMinor: number }[];
  /** Each spending category's resolved mark. Missing counts as essential. */
  needs: Readonly<Record<string, CategoryNeed>>;
}

export interface EssentialSplitParts {
  essential: number;
  lifestyle: number;
  debtsSavings: number;
}

export interface EssentialSplit {
  incomeMinor: number;
  spendingMinor: number;
  essentialMinor: number;
  lifestyleMinor: number;
  /** Income less both kinds of spending. Below nought when more was spent than earned. */
  debtsSavingsMinor: number;
  /** How much more was spent than earned, or 0. */
  overspentMinor: number;
  /** Whole percents of income, or null with no income to divide by. Debts & savings is 0 when it went below nought. */
  percents: EssentialSplitParts | null;
  /** How much of the bar each part takes, 0 to 1, or null with no income. Adds up to 1 whenever anything was spent or kept. */
  bar: EssentialSplitParts | null;
}

/** Whole percents that add up to `total`, each as close to its exact share as the total allows. */
function roundTo(values: readonly number[], total: number): number[] {
  const floors = values.map(Math.floor);
  let short = total - floors.reduce((sum, value) => sum + value, 0);
  const order = values.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (short <= 0) break;
    floors[index] = floors[index]! + 1;
    short -= 1;
  }
  return floors;
}

export function essentialSplit(input: EssentialSplitInput): EssentialSplit {
  let essentialMinor = 0;
  let lifestyleMinor = 0;
  for (const row of input.spending) {
    if (input.needs[row.accountId] === 'lifestyle') lifestyleMinor += row.amountBaseMinor;
    else essentialMinor += row.amountBaseMinor;
  }
  const spendingMinor = essentialMinor + lifestyleMinor;
  const incomeMinor = input.incomeMinor;
  const debtsSavingsMinor = incomeMinor - spendingMinor;
  const overspentMinor = Math.max(0, -debtsSavingsMinor);
  const base = { incomeMinor, spendingMinor, essentialMinor, lifestyleMinor, debtsSavingsMinor, overspentMinor };
  if (incomeMinor <= 0) return { ...base, percents: null, bar: null };

  const essential = Math.max(0, essentialMinor);
  const lifestyle = Math.max(0, lifestyleMinor);
  const kept = Math.max(0, debtsSavingsMinor);
  // The bar is the income when something was kept; when more went out than came in, it is what went out.
  const whole = essential + lifestyle + kept;
  const bar = whole > 0 ? { essential: essential / whole, lifestyle: lifestyle / whole, debtsSavings: kept / whole } : { essential: 0, lifestyle: 0, debtsSavings: 0 };

  const exact = [essentialMinor, lifestyleMinor, debtsSavingsMinor].map((part) => (part / incomeMinor) * 100);
  const percents =
    debtsSavingsMinor >= 0 && essentialMinor >= 0 && lifestyleMinor >= 0
      ? (([e, l, d]) => ({ essential: e!, lifestyle: l!, debtsSavings: d! }))(roundTo(exact, 100))
      : { essential: Math.round(exact[0]!), lifestyle: Math.round(exact[1]!), debtsSavings: Math.max(0, Math.round(exact[2]!)) };
  return { ...base, percents, bar };
}

/**
 * The Financial health card's grade: on track once Debts & savings reaches the guide's share, then the same watch band
 * every other "at least" ratio uses. Nothing to grade without income.
 */
export function gradeSplit(split: EssentialSplit, guide: SpendingGuide): RatioStatus {
  if (split.percents === null) return 'unknown';
  const kept = (split.debtsSavingsMinor / split.incomeMinor) * 100;
  if (kept >= guide.debtsSavings) return 'good';
  return kept >= guide.debtsSavings / WATCH_BAND ? 'watch' : 'act';
}

/** What a month's caps plan for each kind of spending: only the outermost cap in each branch, as the cap total reads them. */
export interface CapPlanNode {
  id: string;
  capMinor: number | null;
  children: readonly CapPlanNode[];
}

export function capsByNeed(lines: readonly CapPlanNode[], needs: Readonly<Record<string, CategoryNeed>>): { essentialMinor: number; lifestyleMinor: number; any: boolean } {
  let essentialMinor = 0;
  let lifestyleMinor = 0;
  let any = false;
  const walk = (rows: readonly CapPlanNode[]) => {
    for (const row of rows) {
      if (row.capMinor === null) {
        walk(row.children);
        continue;
      }
      any = true;
      if (needs[row.id] === 'lifestyle') lifestyleMinor += row.capMinor;
      else essentialMinor += row.capMinor;
    }
  };
  walk(lines);
  return { essentialMinor, lifestyleMinor, any };
}

export interface NeedsPlanRow {
  key: 'essential' | 'lifestyle' | 'debtsSavings';
  usedMinor: number;
  /** Null when no cap is set at all: the row shows what was used and nothing to measure it against. */
  plannedMinor: number | null;
  /** Spending past its plan, or Debts & savings below nought. */
  warn: boolean;
  /** How full the bar is, 0 to 1. */
  fill: number;
}

/**
 * The Budget box: what each part used of what the month planned. Essential and Lifestyle plan what their caps add up
 * to; Debts & savings plans the rest of the month's income — the take-home typed on the plan, else what came in so far.
 */
export function needsPlan(
  split: EssentialSplit,
  caps: { essentialMinor: number; lifestyleMinor: number; any: boolean },
  incomePlanMinor: number,
): NeedsPlanRow[] {
  const income = incomePlanMinor > 0 ? incomePlanMinor : split.incomeMinor;
  const planned = caps.any ? { essential: caps.essentialMinor, lifestyle: caps.lifestyleMinor, debtsSavings: income - caps.essentialMinor - caps.lifestyleMinor } : null;
  const fillOf = (used: number, plan: number | null) => (plan === null ? 0 : plan > 0 ? Math.max(0, Math.min(1, used / plan)) : used > 0 ? 1 : 0);
  return [
    { key: 'essential', usedMinor: split.essentialMinor, plannedMinor: planned?.essential ?? null, warn: planned !== null && split.essentialMinor > planned.essential, fill: fillOf(split.essentialMinor, planned?.essential ?? null) },
    { key: 'lifestyle', usedMinor: split.lifestyleMinor, plannedMinor: planned?.lifestyle ?? null, warn: planned !== null && split.lifestyleMinor > planned.lifestyle, fill: fillOf(split.lifestyleMinor, planned?.lifestyle ?? null) },
    { key: 'debtsSavings', usedMinor: split.debtsSavingsMinor, plannedMinor: planned?.debtsSavings ?? null, warn: split.debtsSavingsMinor < 0, fill: fillOf(split.debtsSavingsMinor, planned?.debtsSavings ?? null) },
  ];
}
