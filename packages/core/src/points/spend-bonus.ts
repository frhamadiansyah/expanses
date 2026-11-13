import { type BonusTier, type CycleBonus, matchesSpend, nextBonusTier, type SpendLine } from './earn';
import { nextFeeDate } from './fee-date';

/*
 * Spend bonuses on a card: the programme's cycle bonuses, and the two ways a bank waives an annual fee (a yearly
 * spending target, or a challenge it set after a call). All of them are "spend this much by then" and read alike.
 */

/**
 * A yearly spending target the bank waives the fee for by itself, a challenge the bank gave for one fee, or a fee that
 * is always waived ('lifetime': nothing to spend, no days, no amount — 0).
 */
export interface FeeWaiver {
  kind: 'automatic' | 'challenge' | 'lifetime';
  /** The spend to reach; 0 for a lifetime one. */
  amountMinor: number;
  /** A challenge: the day counting starts. Not used by an automatic one. */
  countedFrom: string | null;
  /** A challenge: the day the spend has to be reached by. Not used by an automatic one. */
  spendBy: string | null;
  /** Categories (and their descendants) that count; empty = every purchase. */
  categoryIds: string[];
}

const DAY = 86_400_000;
const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY);
}

const addDays = (date: string, days: number) => isoOf(utc(date) + days * DAY);

/** The same day a year earlier; 29 Feb becomes 28 Feb. */
function yearBefore(date: string): string {
  const year = Number(date.slice(0, 4)) - 1;
  const month = date.slice(5, 7);
  let day = Number(date.slice(8, 10));
  if (month === '02' && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) day = 28;
  return `${String(year).padStart(4, '0')}-${month}-${String(day).padStart(2, '0')}`;
}

export interface WaiverWindow {
  from: string;
  to: string;
}

/**
 * The days a waiver counts spend over. An automatic one looks at the 12 months ending on the coming fee date (the day
 * after the same date a year earlier, up to the fee date); with no fee date it is the 12 months ending today. A
 * challenge counts from the day given to the day it must be reached by.
 */
export function waiverWindow(waiver: FeeWaiver, feeOn: string | null, today: string): WaiverWindow {
  if (waiver.kind === 'challenge') return { from: waiver.countedFrom ?? today, to: waiver.spendBy ?? today };
  const to = feeOn ? nextFeeDate(feeOn, today) : today;
  return { from: addDays(yearBefore(to), 1), to };
}

/** What a waiver has counted: the matching purchases inside its window, never below nothing. */
export function waiverSpend(waiver: FeeWaiver, window: WaiverWindow, lines: readonly SpendLine[], ancestors: Record<string, string[]>, billingCurrency = 'IDR'): number {
  const match = { categoryIds: waiver.categoryIds };
  const total = lines
    .filter((line) => line.occurredOn >= window.from && line.occurredOn <= window.to && matchesSpend(match, line, ancestors, billingCurrency))
    .reduce((sum, line) => sum + line.amountMinor, 0);
  return Math.max(0, total);
}

export type SpendBonusKind = 'bonus' | 'challenge' | 'target';

/** One thing to spend toward, read the same whatever it is. */
export interface SpendBonusItem {
  /** The cycle bonus's id; 'challenge' or 'target' for a fee waiver. */
  id: string;
  kind: SpendBonusKind;
  name: string;
  /** Points a bonus pays at the tier it is working toward (or paid, once the top tier is reached); null for a waiver. */
  rewardPoints: number | null;
  /** The fee a waiver saves; null for a bonus. */
  rewardMinor: number | null;
  spentMinor: number;
  /** The spend that earns it: the next tier's, or the top tier's once reached. */
  goalMinor: number;
  remainingMinor: number;
  /** 0 to 1. */
  fraction: number;
  reached: boolean;
  /** The last day it can be reached, and the days from today to it (0 = today, negative = passed). */
  endsOn: string | null;
  daysLeft: number | null;
}

/** A cycle bonus as an item: toward its next tier, or its top one once that is reached. */
export function bonusItem(bonus: CycleBonus, eligibleSpendMinor: number, awarded: number, cycleEnd: string, today: string): SpendBonusItem {
  const next: BonusTier | null = nextBonusTier(bonus, eligibleSpendMinor);
  const top = [...bonus.tiers].sort((a, b) => b.minSpendMinor - a.minSpendMinor)[0];
  const tier = next ?? top ?? { minSpendMinor: 0, bonus: 0 };
  const reached = next === null;
  return {
    id: bonus.id,
    kind: 'bonus',
    name: bonus.name,
    rewardPoints: reached ? awarded : tier.bonus,
    rewardMinor: null,
    spentMinor: eligibleSpendMinor,
    goalMinor: tier.minSpendMinor,
    remainingMinor: Math.max(0, tier.minSpendMinor - eligibleSpendMinor),
    fraction: tier.minSpendMinor > 0 ? Math.min(1, eligibleSpendMinor / tier.minSpendMinor) : 1,
    reached,
    endsOn: cycleEnd,
    daysLeft: daysBetween(today, cycleEnd),
  };
}

/** Whether a waiver has a spend to reach: a lifetime one has none, so it is never a spend bonus. */
export function hasSpendTarget(waiver: FeeWaiver): boolean {
  return waiver.kind !== 'lifetime';
}

/** A fee waiver as an item (never a lifetime one: see `hasSpendTarget`). `feeMinor` is the fee it saves (null when no amount is set). */
export function waiverItem(waiver: FeeWaiver, window: WaiverWindow, spentMinor: number, feeMinor: number | null, today: string): SpendBonusItem {
  const goal = waiver.amountMinor;
  const challenge = waiver.kind === 'challenge';
  return {
    id: challenge ? 'challenge' : 'target',
    kind: challenge ? 'challenge' : 'target',
    name: challenge ? 'Fee waiver challenge' : 'Fee waiver target',
    rewardPoints: null,
    rewardMinor: feeMinor,
    spentMinor,
    goalMinor: goal,
    remainingMinor: Math.max(0, goal - spentMinor),
    fraction: goal > 0 ? Math.min(1, spentMinor / goal) : 1,
    reached: spentMinor >= goal,
    endsOn: window.to,
    daysLeft: daysBetween(today, window.to),
  };
}

/** Nearest to its goal first: the fullest bar, then the least left to spend. */
export function nearestFirst<T extends Pick<SpendBonusItem, 'fraction' | 'remainingMinor'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.fraction - a.fraction || a.remainingMinor - b.remainingMinor);
}

/** "9 days left", "1 day left", "Ends today", "4 months left", "Ended". */
export function timeLeftText(daysLeft: number): string {
  if (daysLeft < 0) return 'Ended';
  if (daysLeft === 0) return 'Ends today';
  if (daysLeft === 1) return '1 day left';
  if (daysLeft < 60) return `${daysLeft} days left`;
  return `${Math.round(daysLeft / 30)} months left`;
}
