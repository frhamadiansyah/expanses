import { installmentSplit } from '@expanses/core';
import type { CardInstallmentRow } from '@expanses/db';
import { repaidPercent, monthYearLabel } from '../loans/loan-view';
import { dayMonth } from '../networth/debt-rows';
import type { PlanDebt } from './plan-inputs';

/** All debts (spec §4.3): its chips, its sorts, and the line under each debt. Pure. */

export type DebtFilter = 'all' | 'active' | 'late' | 'paidOff';
export type DebtSort = 'mostLeft' | 'leastLeft' | 'highestRate' | 'endsSoonest' | 'name';

export const SORTS: { key: DebtSort; label: string }[] = [
  { key: 'mostLeft', label: 'Most left' },
  { key: 'leastLeft', label: 'Least left' },
  { key: 'highestRate', label: 'Highest rate' },
  { key: 'endsSoonest', label: 'Ends soonest' },
  { key: 'name', label: 'Name' },
];

const isActive = (d: PlanDebt) => !d.paidOff && d.leftMinor > 0;

export function chipCounts(debts: readonly PlanDebt[]): Record<DebtFilter, number> {
  const active = debts.filter(isActive);
  const paidOff = debts.filter((d) => d.paidOff);
  return { all: active.length + paidOff.length, active: active.length, late: active.filter((d) => d.late).length, paidOff: paidOff.length };
}

export function filterDebts(debts: readonly PlanDebt[], filter: DebtFilter): PlanDebt[] {
  if (filter === 'active') return debts.filter(isActive);
  if (filter === 'late') return debts.filter((d) => isActive(d) && d.late);
  if (filter === 'paidOff') return debts.filter((d) => d.paidOff);
  return debts.filter((d) => isActive(d) || d.paidOff);
}

const byName = (a: PlanDebt, b: PlanDebt) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
/** A debt with no rate to the base currency sorts as nothing left: listed, never weighed against the rest. */
const left = (d: PlanDebt) => d.leftBase ?? -1;

const COMPARE: Record<DebtSort, (a: PlanDebt, b: PlanDebt) => number> = {
  mostLeft: (a, b) => left(b) - left(a) || byName(a, b),
  leastLeft: (a, b) => (a.leftBase ?? Infinity) - (b.leftBase ?? Infinity) || byName(a, b),
  // Unknown rates (a loan with no terms) after every known one, 0% included.
  highestRate: (a, b) => (b.rateBps ?? -1) - (a.rateBps ?? -1) || byName(a, b),
  endsSoonest: (a, b) => (a.endsMonth ?? '9999-99').localeCompare(b.endsMonth ?? '9999-99') || byName(a, b),
  name: byName,
};

/** Active debts in the chosen order, then the paid off ones by name: paid off is always last. */
export function sortDebts(debts: readonly PlanDebt[], sort: DebtSort): PlanDebt[] {
  const active = debts.filter((d) => !d.paidOff).sort(COMPARE[sort]);
  const paidOff = debts.filter((d) => d.paidOff).sort(byName);
  return [...active, ...paidOff];
}

/** "52% repaid · ends Aug 2028" | "Statement due 18 Nov" | "Lend & borrow · no fixed months" | "Late · 40% repaid · 3 of 6 paid". */
export function allDebtsSubtitle(debt: PlanDebt, today: string): string {
  void today;
  if (debt.paidOff) return debt.paidOffMonth ? monthYearLabel(debt.paidOffMonth) : 'Paid off';
  const late = debt.late ? 'Late · ' : '';
  if (debt.kind === 'card') return `${late}${debt.next ? `Statement due ${dayMonth(debt.next.dueOn)}` : 'Nothing billed'}`;
  if (debt.kind === 'person') return `${late}Lend & borrow · ${debt.next ? `due ${dayMonth(debt.next.dueOn)}` : 'no fixed months'}`;
  if (debt.kind === 'payable') return 'No fixed months';
  const repaid = `${repaidPercent(debt.borrowedMinor, debt.leftMinor)}% repaid`;
  if (!debt.hasTerms) return `${repaid} · No terms yet`;
  if (debt.late && debt.instalmentOf !== null && debt.instalmentsPaid !== null) {
    return `Late · ${repaid} · ${debt.instalmentsPaid} of ${debt.instalmentOf} paid`;
  }
  return debt.endsMonth ? `${late}${repaid} · ends ${monthYearLabel(debt.endsMonth)}` : `${late}${repaid}`;
}

const KEY = 'debt-plan.sort';
const KNOWN = new Set<string>(SORTS.map((s) => s.key));

/** The sort kept on this device; Most left when nothing is kept, or the storage cannot be read. */
export function readSort(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DebtSort {
  try {
    const kept = storage?.getItem(KEY) ?? null;
    return kept !== null && KNOWN.has(kept) ? (kept as DebtSort) : 'mostLeft';
  } catch {
    return 'mostLeft';
  }
}

export function writeSort(sort: DebtSort, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, sort);
  } catch {
    // A private window or blocked storage: the sort lasts this visit only.
  }
}

/** One row of All debts' two groups: a debt, or a card's running instalment plan on its own. */
export interface GroupedDebtRow {
  key: string;
  name: string;
  subtitle: string;
  /** Fixed each month: what it asks a month. No fixed amount: what is owed. In its own currency. */
  valueMinor: number;
  currency: string;
  late: boolean;
  /** How far through it is, for the bar: repaid of borrowed, or instalments billed of the plan's months. */
  progress: { current: number; target: number };
  debt: PlanDebt | null;
  plan: { cardAccountId: string; planId: string; number: number; of: number } | null;
}

/** A plan still billing: what the card holds of it, unbilled, is above nothing. */
const running = (plan: CardInstallmentRow, today: string) => installmentSplit(plan, today).unbilledMinor > 0;

/**
 * All debts' active list in two groups (card instalments, option C): Fixed each month — loans with a schedule and each
 * running instalment plan as a row of its own ("Laptop · 1 of 12 · ends Nov 2027", a month's figure) — and No fixed
 * amount — a card's own balance less what its plans still hold, a family loan, anything with no schedule, by what is
 * owed. Nothing is counted twice: the plans' unbilled parts leave their card's figure for their own rows. Debts keep the
 * order they come in (the chosen sort); plans follow the loans.
 */
export function debtGroups(debts: readonly PlanDebt[], plans: readonly CardInstallmentRow[], today: string): { fixed: GroupedDebtRow[]; noFixed: GroupedDebtRow[] } {
  const owing = debts.filter(isActive);
  const live = plans.filter((plan) => running(plan, today));
  const heldBy = (cardAccountId: string) => live.filter((plan) => plan.cardAccountId === cardAccountId).reduce((sum, plan) => sum + installmentSplit(plan, today).unbilledMinor, 0);
  const asRow = (debt: PlanDebt, valueMinor: number): GroupedDebtRow => ({
    key: debt.key,
    name: debt.name,
    subtitle: allDebtsSubtitle(debt, today),
    valueMinor,
    currency: debt.currency,
    late: debt.late,
    progress: { current: debt.repaidMinor, target: Math.max(1, debt.borrowedMinor) },
    debt,
    plan: null,
  });
  const scheduled = (debt: PlanDebt) => debt.kind === 'loan' && debt.hasTerms && debt.endsMonth !== null;
  const fixed = owing.filter(scheduled).map((debt) => asRow(debt, debt.next?.minor ?? 0));
  const currencyOf = (cardAccountId: string) => debts.find((debt) => debt.accountId === cardAccountId)?.currency ?? null;
  for (const plan of live) {
    const split = installmentSplit(plan, today);
    const billed = plan.months - split.monthsLeft;
    fixed.push({
      key: `plan:${plan.id}`,
      name: plan.description,
      subtitle: billed > 0 ? `${billed} of ${plan.months} · ends ${monthYearLabel(split.lastMonth)}` : `starts ${monthYearLabel(plan.firstBilledMonth)} · ends ${monthYearLabel(split.lastMonth)}`,
      valueMinor: plan.monthlyMinor,
      currency: currencyOf(plan.cardAccountId) ?? '',
      late: false,
      progress: { current: billed, target: plan.months },
      debt: null,
      plan: { cardAccountId: plan.cardAccountId, planId: plan.id, number: billed, of: plan.months },
    });
  }
  const noFixed = owing
    .filter((debt) => !scheduled(debt))
    .map((debt) => asRow(debt, debt.kind === 'card' && debt.accountId ? Math.max(0, debt.leftMinor - heldBy(debt.accountId)) : debt.leftMinor));
  return { fixed, noFixed };
}
