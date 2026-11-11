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
import { type BillMonthRow, billsInMonth, cardStatements, debtMovements, type DebtPlanSettings, getDebtPlanSettings, listCardTerms, type LoanPlanFact, loanPlanFacts, paidOffLoanFacts, saveDebtPlanSettings } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
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
import { type CardMonth, type DueBill, dueItems, dueRow, type DueRowModel, type MonthInput, monthItems } from './schedule-view';
import { useMonthlyBills } from '../bills/queries';

/** Every open loan's standing and schedule from today (spec §6.2). */
export function useLoanPlanFacts(today?: string) {
  const { database, ws } = useApp();
  const onDate = today ?? isoDate();
  return useQuery({ queryKey: ['loan-plan-facts', ws.workspaceId, onDate], queryFn: () => loanPlanFacts(database, ws, onDate) });
}

/** The loans paid off, with their instalments up to the pay-off: the Schedule's and the Report's months behind. */
export function usePaidOffLoanFacts(today?: string) {
  const { database, ws } = useApp();
  const onDate = today ?? isoDate();
  return useQuery({ queryKey: ['paid-off-loan-facts', ws.workspaceId, onDate], queryFn: () => paidOffLoanFacts(database, ws, onDate) });
}

/** Open loans' facts and paid-off ones together, for the months; null until both are read. */
function useMonthLoanFacts(today: string): { data: LoanPlanFact[] | null; error: unknown } {
  const open = useLoanPlanFacts(today);
  const gone = usePaidOffLoanFacts(today);
  return { data: open.data && gone.data ? [...open.data, ...gone.data] : null, error: open.error ?? gone.error ?? null };
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
  // Worked out again only when a reading changes, not on every render of every screen that asks.
  const model = useMemo(() => {
    if (!ready) return null;
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
    return planModel(readings, settings.data ?? null, today);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query data references are the inputs
  }, [ready, accounts.data, balances.data, loans.data, items.data, facts.data, cards.data, plans.data, people.data, movements.data, held.data, settings.data, baseCurrency, today]);
  if (!model) return { model: null, error, isPending: !error };
  return { model, error: null, isPending: false };
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
      const out: Record<string, CardMonth[]> = Object.fromEntries(wanted.map((month) => [month, []]));
      for (const card of cards) {
        const term = terms.find((t) => t.accountId === card.id);
        if (!term) continue;
        // A statement that has not begun yet has nothing on it.
        const asked = wanted.flatMap((month) => {
          const cycle = cycleDueIn(month, term.statementDay, term.dueDay);
          return cycle && cycle.start <= today ? [{ month, cycle }] : [];
        });
        if (asked.length === 0) continue;
        // One read of the card's lines for every month asked.
        const statements = await cardStatements(database, ws, card.id, asked.map((a) => a.cycle), today);
        asked.forEach(({ month, cycle }, index) => {
          out[month]!.push({ cardId: card.id, name: card.name, currency: card.currency ?? ws.baseCurrency, dueOn: dueDateAfter(cycle.end, term.dueDay), statement: statements[index]! });
        });
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
  const facts = useMonthLoanFacts(today);
  const cards = useCardMonths([month]);
  const before = useBillsInMonth(month === null ? null : addMonths(month, -1));
  const bills = useBillsInMonth(month);
  const accounts = useAccounts();
  const rows = [...(before.data ?? []), ...(bills.data ?? [])];
  const currencyOf = (row: BillMonthRow) => billCurrencyOf(row.bill, accounts.data ?? [], ws.baseCurrency);
  /** A bill paid from a credit card, by the card's name: its statement already counts it. */
  const cardNameOf = (accountId: string) => {
    const payer = (accounts.data ?? []).find((a) => a.id === accountId);
    return payer?.subtype === 'credit_card' ? payer.name : null;
  };
  const held = useHeldRates(rows.map(currencyOf));
  const queries = [cards, before, bills, accounts, held];
  const failed = error ?? facts.error ?? queries.find((q) => q.error)?.error ?? null;
  if (month === null || !model || !facts.data || !queries.every((q) => q.isSuccess)) return { items: null, error: failed };
  return {
    items: monthItems({
      month,
      today,
      debts: model.debts,
      loanFacts: facts.data,
      cards: cards.data![month] ?? [],
      bills: rows.map((row) => ({ row, currency: currencyOf(row), onCard: cardNameOf(row.bill.moneyAccountId) })),
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
  const facts = useMonthLoanFacts(today);
  const cards = useCardMonths(months);
  const failed = error ?? facts.error ?? cards.error ?? null;
  if (!model || !facts.data || (months.length > 0 && !cards.isSuccess)) return { byMonth: null, error: failed };
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
  const { ws } = useApp();
  const today = isoDate();
  // Nothing read for it alone: the plan (each card's statement through useCardFacts), the loans' standing, and the
  // bills exactly as the Recurring line beside it has them.
  const { model } = useDebtPlan();
  const facts = useLoanPlanFacts(today);
  const bills = useMonthlyBills(today);
  const accounts = useAccounts();
  if (!model || !facts.data || !bills.data || !accounts.data) return null;
  const all = accounts.data;
  const onCard = (accountId: string) => {
    const payer = all.find((a) => a.id === accountId);
    return payer?.subtype === 'credit_card' ? payer.name : null;
  };
  const due: DueBill[] = bills.data.map((bill) => ({ bill, currency: billCurrencyOf(bill, all, ws.baseCurrency), onCard: onCard(bill.moneyAccountId) }));
  return dueRow(dueItems({ debts: model.debts, loanFacts: facts.data, bills: due, today, baseCurrency: ws.baseCurrency, ratesToBase: model.ratesToBase }), today);
}
