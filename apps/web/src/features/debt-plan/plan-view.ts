import { daysFrom, formatMinor, type MethodSuggestion, type PayoffMethod, type PayoffPlan } from '@expanses/core';
import type { DebtPlanSettings } from '@expanses/db';
import { rateTextPer, repaidPercent } from '../loans/loan-view';
import { dayMonth } from '../networth/debt-rows';
import type { PayTarget } from './pay-target';
import type { PlanDebt, PlanItem } from './plan-inputs';

/**
 * What the plan's screens say: the header's figures, Pay next, the suggestion, and the Pay first rows. Pure, so every
 * wording is held down by a test (spec §4.0, §4.1, §6.6–§6.8, §8).
 */

export interface PlanSummary {
  leftMinor: number | null;
  borrowedMinor: number | null;
  repaidMinor: number | null;
  /** repaidPercent(borrowed, left), over the debts that have a rate. */
  percent: number;
  /** Currencies with no rate, sorted. */
  missing: string[];
  counts: { active: number; late: number; paidOff: number };
  /** "August 2028" or null, and the line naming why when it is unknown. */
  debtFree: { month: string | null; why: string | null };
  payNext: { debt: PlanDebt; item: PlanItem; when: string } | null;
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "August 2028": the month written out with its year. */
export function longMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const name = LONG_MONTHS[index];
  return name && year ? `${name} ${year}` : month;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 days late", "1 day late", "due today", "due tomorrow", "due 18 Nov". */
export function whenWords(item: Pick<PlanItem, 'status' | 'daysLate' | 'dueOn'>, today: string): string {
  if (item.status === 'late') return `${plural(Math.max(1, item.daysLate), 'day')} late`;
  if (item.status === 'paid') return `paid ${dayMonth(item.dueOn)}`;
  const days = daysFrom(today, item.dueOn);
  if (days < 0) return `${plural(-days, 'day')} late`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due ${dayMonth(item.dueOn)}`;
}

const active = (debts: readonly PlanDebt[]) => debts.filter((d) => !d.paidOff && d.leftMinor > 0);
const nameOf = (debts: readonly PlanDebt[], key: string) => debts.find((d) => d.key === key)?.name ?? key;

/** "No terms on Dollar car loan yet" | "Payments never clear Dewi" | "No USD rate yet". */
export function unknownWords(plan: PayoffPlan | null, debts: readonly PlanDebt[], missing: readonly string[]): string | null {
  if (missing.length > 0) return `No ${missing.join(', ')} rate yet`;
  if (!plan?.unknown) return null;
  const names = plan.unknown.keys.map((key) => nameOf(debts, key)).join(', ');
  return plan.unknown.reason === 'noRate' ? `No terms on ${names} yet` : `Payments never clear ${names}`;
}

/** The order's index of each key, for ties; keys outside the order come after it. */
const rankIn = (order: readonly string[]) => (key: string) => {
  const index = order.indexOf(key);
  return index === -1 ? order.length : index;
};

export function planSummary(debts: readonly PlanDebt[], baseline: PayoffPlan | null, today: string): PlanSummary {
  const owing = active(debts);
  const missing = [...new Set(debts.filter((d) => d.missing !== null && (d.leftMinor > 0 || d.borrowedMinor > 0)).map((d) => d.missing!))].sort();
  const known = debts.filter((d) => d.missing === null);
  const sum = (pick: (d: PlanDebt) => number | null, from: readonly PlanDebt[]) => from.reduce((total, d) => total + (pick(d) ?? 0), 0);
  const knownLeft = sum((d) => (d.paidOff ? 0 : d.leftBase), known);
  const knownBorrowed = sum((d) => d.borrowedBase, known);
  const withMissing = missing.length > 0;

  let debtFree: PlanSummary['debtFree'] = { month: null, why: null };
  if (owing.length > 0) {
    const why = unknownWords(baseline, debts, missing);
    debtFree = why !== null || !baseline?.debtFreeMonth ? { month: null, why } : { month: longMonth(baseline.debtFreeMonth), why: null };
  }

  const rank = rankIn(baseline?.order ?? []);
  const items = owing.flatMap((debt) => (debt.next && debt.next.status !== 'paid' ? [{ debt, item: debt.next }] : []));
  const late = items.filter((x) => x.item.status === 'late').sort((a, b) => b.item.daysLate - a.item.daysLate || rank(a.debt.key) - rank(b.debt.key));
  const upcoming = items.filter((x) => x.item.status !== 'late').sort((a, b) => a.item.dueOn.localeCompare(b.item.dueOn) || rank(a.debt.key) - rank(b.debt.key));
  const first = late[0] ?? upcoming[0];

  return {
    leftMinor: withMissing && owing.some((d) => d.missing !== null) ? null : knownLeft,
    borrowedMinor: withMissing ? null : knownBorrowed,
    repaidMinor: withMissing ? null : knownBorrowed - knownLeft,
    percent: repaidPercent(knownBorrowed, knownLeft),
    missing,
    counts: { active: owing.length, late: owing.filter((d) => d.late).length, paidOff: debts.filter((d) => d.paidOff).length },
    debtFree,
    payNext: first ? { ...first, when: whenWords(first.item, today) } : null,
  };
}

export function methodLabel(method: PayoffMethod): 'Snowball' | 'Avalanche' | 'By hand' {
  return method === 'snowball' ? 'Snowball' : method === 'avalanche' ? 'Avalanche' : 'By hand';
}

/** The saved method, else the suggestion's, else Avalanche. */
export function methodOf(saved: DebtPlanSettings | null, suggestion: MethodSuggestion | null): PayoffMethod {
  return saved?.method ?? suggestion?.method ?? 'avalanche';
}

/** A rate with its period always said: "2,95% a month", "7,5% a year" (`rateTextPer` leaves a year's unsaid). */
export function ratePerWords(bps: number, per: 'month' | 'year'): string {
  return per === 'month' ? rateTextPer(bps, 'month') : `${rateTextPer(bps, 'year')} a year`;
}

const rateWords = (debt: PlanDebt | undefined) => (debt && debt.rateBps !== null ? ratePerWords(debt.rateBps, debt.ratePer) : '');

/** Spec §8's words, each rate in its own loan's wording. */
export function suggestionWords(s: MethodSuggestion | null, debts: readonly PlanDebt[]): string | null {
  if (!s) return null;
  if (s.reason === 'ratesDiffer') {
    const high = debts.find((d) => d.key === s.highestKey);
    const low = debts.find((d) => d.key === s.lowestKey);
    return `Suggested: Avalanche. Rates are known for every debt and differ a lot (${rateWords(high)} vs ${rateWords(low)}).`;
  }
  if (s.reason === 'manySmall') return `Suggested: Snowball. ${s.smallCount ?? 0} small debts: clearing them first shortens the list quickly.`;
  return 'Suggested: Snowball. Not every rate is known, so the smallest go first.';
}

export interface PayFirstRow {
  debt: PlanDebt;
  /** Null for a late debt, drawn as "!". */
  place: number | null;
  subtitle: string;
  amountMinor: number | null;
  lateTag: string | null;
  pay: PayTarget | null;
  extraTag: string | null;
}

function subtitleOf(debt: PlanDebt): string {
  if (debt.kind === 'loan') return debt.hasTerms && debt.rateBps !== null ? `${ratePerWords(debt.rateBps, debt.ratePer)} · left ${formatMinor(debt.leftMinor, debt.currency)}` : 'No terms yet';
  if (debt.kind === 'card') return debt.next ? `Statement due ${dayMonth(debt.next.dueOn)}` : 'Nothing billed';
  return debt.next ? `Due ${dayMonth(debt.next.dueOn)}` : 'No fixed months';
}

/** Every active debt in pay order: late ones first with "!", the rest numbered; debts the engine left out go last. */
export function payFirstRows(debts: readonly PlanDebt[], order: readonly string[], extraMinor: number, baseCurrency: string): PayFirstRow[] {
  const owing = active(debts);
  const rank = rankIn(order);
  const sorted = [...owing].sort((a, b) => rank(a.key) - rank(b.key));
  let place = 0;
  return sorted.map((debt, index) => {
    const late = debt.late;
    if (!late) place += 1;
    const lateDays = debt.next?.status === 'late' ? debt.next.daysLate : debt.daysLate;
    return {
      debt,
      place: late ? null : place,
      subtitle: subtitleOf(debt),
      amountMinor: debt.next?.minor ?? null,
      lateTag: late ? `${plural(Math.max(1, lateDays), 'day')} late` : null,
      pay: debt.next?.pay ?? null,
      extraTag: index === 0 && order[0] === debt.key && debt.kind === 'loan' && debt.hasTerms && extraMinor > 0 ? `+ extra ${formatMinor(extraMinor, baseCurrency)}` : null,
    };
  });
}

/** "Goes to Kredit, then rolls to Akulaku" | "Goes to Kredit" | null. */
export function rollsWords(order: readonly string[], debts: readonly PlanDebt[]): string | null {
  const [first, second] = order.filter((key) => debts.some((d) => d.key === key && !d.paidOff));
  if (!first) return null;
  return second ? `Goes to ${nameOf(debts, first)}, then rolls to ${nameOf(debts, second)}` : `Goes to ${nameOf(debts, first)}`;
}

/** The late count the Account row, the sidebar and the corner read: "1 late" | undefined. */
export function lateNote(count: number): string | undefined {
  return count > 0 ? `${count} late` : undefined;
}
