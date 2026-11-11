import {
  addMonths,
  convertMinor,
  type ExtraEffect,
  extraEffect,
  isoDate,
  type MethodSuggestion,
  monthOf,
  type PayoffMethod,
  type PayoffPlan,
  suggestMethod,
} from '@expanses/core';
import { type BillMonthRow, billsInMonth, cardStatement, debtMovements, type DebtPlanSettings, getDebtPlanSettings, listCardTerms, loanPlanFacts, saveDebtPlanSettings } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { useHeldRates } from '../accounts/queries';
import { usePeopleDebts } from '../debts/queries';
import { useCardFacts, useInstallments, useLoanItems, useLoans } from '../loans/queries';
import { type PlanDebt, planDebts, type PlanReadings } from './plan-inputs';
import { methodOf, type PlanSummary, planSummary } from './plan-view';
import { billCurrencyOf } from '../bills/bill-view';
import { cycleDueIn, dueDateAfter } from '../cards/statement-dates';
import type { PlanItem } from './plan-inputs';
import { type CardMonth, dueRow, type DueRowModel, type MonthInput, monthItems } from './schedule-view';

/** Every open loan's standing and schedule from today (spec §6.2). */
export function useLoanPlanFacts(today?: string) {
  const { database, ws } = useApp();
  const onDate = today ?? isoDate();
  return useQuery({ queryKey: ['loan-plan-facts', ws.workspaceId, onDate], queryFn: () => loanPlanFacts(database, ws, onDate) });
}

/** Every posted movement on these debt accounts. */
export function useDebtMovements(accountIds: readonly string[], range?: { from?: string; to?: string }) {
  const { database, ws } = useApp();
  const ids = [...accountIds].sort();
  return useQuery({
    queryKey: ['debt-movements', ws.workspaceId, ids.join(','), range?.from ?? '', range?.to ?? ''],
    queryFn: () => debtMovements(database, ws, ids, range),
  });
}

/** The plan's saved order, method and extra; null when nothing was saved. */
export function useDebtPlanSettings() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['debt-plan-settings', ws.workspaceId], queryFn: () => getDebtPlanSettings(database, ws) });
}

/** Saves and invalidates through useInvalidateAll; errors come back to the caller. */
export function useSaveDebtPlanSettings(): (next: DebtPlanSettings) => Promise<void> {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  return useCallback(
    async (next: DebtPlanSettings) => {
      await saveDebtPlanSettings(database, ws, next);
      await invalidate();
    },
    [database, ws, invalidate],
  );
}

export interface DebtPlanModel {
  debts: PlanDebt[];
  method: PayoffMethod;
  suggestion: MethodSuggestion | null;
  /** The chosen order with no extra (the header's month, spec §7.5). */
  baseline: PayoffPlan;
  /** With the saved extra. */
  effect: ExtraEffect;
  summary: PlanSummary;
  /** In base, after conversion of the saved figure. */
  extraMinor: number;
  /** The saved extra's currency when it has no rate. */
  extraMissing: string | null;
  /** The held rates the plan was read at, for the month views. */
  ratesToBase: Readonly<Record<string, number>>;
}

/** The saved extra in the base currency: as typed, converted at the held rate, or nothing (and named) with no rate. */
function extraInBase(settings: DebtPlanSettings | null, readings: PlanReadings): { extraMinor: number; extraMissing: string | null } {
  const minor = settings?.extraMinor ?? 0;
  const currency = settings?.extraCurrency ?? readings.baseCurrency;
  if (minor === 0 || currency === readings.baseCurrency) return { extraMinor: minor, extraMissing: null };
  const rate = readings.ratesToBase[currency];
  if (rate === undefined || !(rate > 0)) return { extraMinor: 0, extraMissing: currency };
  return { extraMinor: convertMinor(minor, currency, readings.baseCurrency, rate), extraMissing: null };
}

/** Pure: readings + settings → everything the screens draw. */
export function planModel(readings: PlanReadings, settings: DebtPlanSettings | null, today: string): DebtPlanModel {
  const debts = planDebts(readings, today);
  const payoffs = debts.flatMap((d) => (!d.paidOff && d.payoff ? [d.payoff] : []));
  const suggestion = suggestMethod(payoffs);
  const method = methodOf(settings, suggestion);
  const { extraMinor, extraMissing } = extraInBase(settings, readings);
  const effect = extraEffect(payoffs, { startMonth: monthOf(today), method, byHand: settings?.order ?? [], extraMinor });
  return { debts, method, suggestion, baseline: effect.baseline, effect, summary: planSummary(debts, effect.baseline, today), extraMinor, extraMissing, ratesToBase: readings.ratesToBase };
}

/** What the Liabilities page reads, plus each loan's standing, the card plans, the debt movements and the settings. */
export function useDebtPlan(): { model: DebtPlanModel | null; error: unknown; isPending: boolean } {
  const { ws } = useApp();
  const today = isoDate();
  const baseCurrency = ws.baseCurrency;
  const accounts = useAccounts();
  const balances = useBalances();
  const loans = useLoans();
  const items = useLoanItems();
  const people = usePeopleDebts(today);
  const all = accounts.data ?? [];
  const cardIds = all.filter((a) => a.subtype === 'credit_card' && a.archivedAt === null).map((a) => a.id);
  const cards = useCardFacts(cardIds, today);
  const liabilities = all.filter((a) => a.kind === 'liability');
  const owedTo = people.data?.youOwe ?? [];
  const held = useHeldRates([...liabilities.map((a) => a.currency ?? baseCurrency), ...owedTo.map((p) => p.currency), ...(people.data?.settled ?? []).map((p) => p.currency)]);
  const facts = useLoanPlanFacts(today);
  const plans = useInstallments();
  // Cards' movements are never read (a card's figures come from its statement), and they are most of the rows.
  const movements = useDebtMovements(liabilities.filter((a) => a.subtype !== 'credit_card').map((a) => a.id));
  const settings = useDebtPlanSettings();

  const queries = [accounts, balances, loans, items, people, cards, held, facts, plans, movements, settings];
  const error = queries.find((q) => q.error)?.error ?? null;
  const ready = queries.every((q) => q.isSuccess);
  if (!ready) return { model: null, error, isPending: !error };
  const readings: PlanReadings = {
    accounts: all,
    balances: balances.data!,
    loans: loans.data!,
    items: items.data!,
    loanFacts: facts.data!,
    cards: cards.data!,
    cardPlans: plans.data!,
    people: people.data!,
    movements: movements.data!,
    baseCurrency,
    ratesToBase: held.data?.rates ?? {},
  };
  return { model: planModel(readings, settings.data ?? null, today), error: null, isPending: false };
}

/** The late count for the Account row, the sidebar and the corners; 0 until read. */
export function useLateDebtCount(): number {
  return useDebtPlan().model?.summary.counts.late ?? 0;
}

/** Whether any debt exists, active or paid off — for the Net worth corner (spec §4.6). */
export function useHasDebts(): boolean {
  return (useDebtPlan().model?.debts.length ?? 0) > 0;
}

/** Each live card's statement due in each month asked (spec §6.4), read through `cardStatement`, the card page's reader. */
export function useCardMonths(months: readonly (string | null)[]) {
  const { database, ws } = useApp();
  const today = isoDate();
  const accounts = useAccounts();
  const wanted = [...new Set(months.filter((m): m is string => m !== null))].sort();
  const cards = (accounts.data ?? []).filter((a) => a.subtype === 'credit_card' && a.archivedAt === null);
  return useQuery({
    queryKey: ['card-months', ws.workspaceId, today, wanted.join(','), cards.map((c) => c.id).join(',')],
    enabled: accounts.isSuccess && wanted.length > 0,
    queryFn: async (): Promise<Record<string, CardMonth[]>> => {
      const terms = await listCardTerms(database, ws);
      const out: Record<string, CardMonth[]> = {};
      for (const month of wanted) {
        out[month] = [];
        for (const card of cards) {
          const term = terms.find((t) => t.accountId === card.id);
          if (!term) continue;
          const cycle = cycleDueIn(month, term.statementDay, term.dueDay);
          // A statement that has not begun yet has nothing on it.
          if (!cycle || cycle.start > today) continue;
          const statement = await cardStatement(database, ws, card.id, cycle, today);
          out[month].push({ cardId: card.id, name: card.name, currency: card.currency ?? ws.baseCurrency, dueOn: dueDateAfter(cycle.end, term.dueDay), statement });
        }
      }
      return out;
    },
  });
}

/** The open book's bills owed in a month (keyed by the book: bills are per book). Null asks for nothing. */
export function useBillsInMonth(month: string | null) {
  const { database, ws } = useApp();
  const today = isoDate();
  return useQuery({
    queryKey: ['bills-in-month', ws.workspaceId, ws.bookId ?? '', month ?? '', today],
    enabled: month !== null,
    queryFn: (): Promise<BillMonthRow[]> => billsInMonth(database, ws, month!, today),
  });
}

const ALL: MonthInput['show'] = { loans: true, cards: true, bills: true };

/** One month's items for the Schedule and the Cashflow row: the plan's debts, each card's statement and the bills. Null month: nothing. */
export function usePlanMonth(month: string | null, show: MonthInput['show'] = ALL): { items: PlanItem[] | null; error: unknown } {
  const { ws } = useApp();
  const today = isoDate();
  const { model, error } = useDebtPlan();
  const facts = useLoanPlanFacts(today);
  const cards = useCardMonths([month]);
  const before = useBillsInMonth(month === null ? null : addMonths(month, -1));
  const bills = useBillsInMonth(month);
  const accounts = useAccounts();
  const rows = [...(before.data ?? []), ...(bills.data ?? [])];
  const currencyOf = (row: BillMonthRow) => billCurrencyOf(row.bill, accounts.data ?? [], ws.baseCurrency);
  const held = useHeldRates(rows.map(currencyOf));
  const queries = [facts, cards, before, bills, accounts, held];
  const failed = error ?? queries.find((q) => q.error)?.error ?? null;
  if (month === null || !model || !queries.every((q) => q.isSuccess)) return { items: null, error: failed };
  return {
    items: monthItems({
      month,
      today,
      debts: model.debts,
      loanFacts: facts.data!,
      cards: cards.data![month] ?? [],
      bills: rows.map((row) => ({ row, currency: currencyOf(row) })),
      show,
      baseCurrency: ws.baseCurrency,
      ratesToBase: { ...(held.data?.rates ?? {}), ...model.ratesToBase },
    }),
    error: null,
  };
}

/** Several months of debts only (no bills), for the Report's paid-against-due bars. */
export function usePlanMonths(months: readonly string[]): { byMonth: Record<string, PlanItem[]> | null; error: unknown } {
  const { ws } = useApp();
  const today = isoDate();
  const { model, error } = useDebtPlan();
  const facts = useLoanPlanFacts(today);
  const cards = useCardMonths(months);
  const failed = error ?? facts.error ?? cards.error ?? null;
  if (!model || !facts.isSuccess || (months.length > 0 && !cards.isSuccess)) return { byMonth: null, error: failed };
  const byMonth: Record<string, PlanItem[]> = {};
  for (const month of months) {
    byMonth[month] = monthItems({
      month,
      today,
      debts: model.debts,
      loanFacts: facts.data,
      cards: cards.data?.[month] ?? [],
      bills: [],
      show: { loans: true, cards: true, bills: false },
      baseCurrency: ws.baseCurrency,
      ratesToBase: model.ratesToBase,
    });
  }
  return { byMonth, error: null };
}

/** The Cashflow row: what is late or due within three days, this month and — near its end — the start of the next. */
export function useDueRow(): DueRowModel | null {
  const today = isoDate();
  const month = monthOf(today);
  const next = addMonths(month, 1);
  // Only reach into next month when three days from today are already in it.
  const soon = monthOf(addDaysIso(today, 3)) === next ? next : null;
  const current = usePlanMonth(month);
  const ahead = usePlanMonth(soon);
  if (!current.items || (soon !== null && !ahead.items)) return null;
  return dueRow([...current.items, ...(ahead.items ?? []).filter((i) => i.status !== 'late')], today);
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
