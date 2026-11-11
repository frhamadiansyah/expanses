import {
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
import { debtMovements, type DebtPlanSettings, getDebtPlanSettings, loanPlanFacts, saveDebtPlanSettings } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { useHeldRates } from '../accounts/queries';
import { usePeopleDebts } from '../debts/queries';
import { useCardFacts, useInstallments, useLoanItems, useLoans } from '../loans/queries';
import { type PlanDebt, planDebts, type PlanReadings } from './plan-inputs';
import { methodOf, type PlanSummary, planSummary } from './plan-view';

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
  return { debts, method, suggestion, baseline: effect.baseline, effect, summary: planSummary(debts, effect.baseline, today), extraMinor, extraMissing };
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
  const movements = useDebtMovements(liabilities.map((a) => a.id));
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
