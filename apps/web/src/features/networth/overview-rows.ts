import { formatMinor } from '@expanses/core';
import type { AccountSetAsideRow, AssetValueRow, GoalPlanRow, IdleCashRow, NetWorthPoint, PersonDebtRow, TradeTemplateRow } from '@expanses/db';

export interface LoanAttention {
  accountId: string;
  lenderName: string;
  currency: string;
  /** A payment due within seven days with nothing recorded for it yet. */
  paymentDueMinor: number | null;
  paymentDueOn: string | null;
  /** A fixed rate ending within sixty days, so the payment is about to change. */
  fixedRateEndsOn: string | null;
  /** The plan whose last instalment is billed this month, named. */
  lastInstallmentOf: string | null;
}

export interface AttentionItem {
  key: string;
  tone: 'warn' | 'info';
  text: string;
  action: string;
  to: '/net-worth/assets' | '/net-worth/trades' | '/goals' | '/net-worth/debts' | '/net-worth/loans' | '/net-worth/assets/$accountId';
  params?: { accountId: string };
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What the owner should deal with: stale prices, monthly buys waiting, goals behind, cash parked to be invested, and accounts that promised more than they hold. */
export function attentionItems(
  values: AssetValueRow[],
  dueTemplates: TradeTemplateRow[],
  goalPlans: GoalPlanRow[] = [],
  idleCash: IdleCashRow[] = [],
  people: PersonDebtRow[] = [],
  loans: LoanAttention[] = [],
  shortAccounts: AccountSetAsideRow[] = [],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const value of values) {
    if (!value.stale) continue;
    if (value.mode === 'market' && value.unitsMicro === 0) continue;
    const what = value.mode === 'market' ? 'price' : 'estimate';
    const text = value.asOf ? `${value.name}: ${what} last updated ${shortDate(value.asOf)}` : `${value.name}: no ${what} yet, showing what you paid`;
    items.push({ key: `stale-${value.accountId}`, tone: 'warn', text, action: 'Update', to: '/net-worth/assets' });
  }
  for (const template of dueTemplates) {
    const name = values.find((value) => value.accountId === template.accountId)?.name ?? 'a holding';
    items.push({ key: `due-${template.id}`, tone: 'warn', text: `Monthly buy of ${name} is due`, action: 'Record', to: '/net-worth/trades' });
  }
  for (const plan of goalPlans) {
    if (plan.status === 'behind') {
      items.push({ key: `goal-${plan.goalId}`, tone: 'warn', text: `${plan.goal.name} needs more each month than you have set up`, action: 'Review', to: '/goals' });
    }
    // A short account is said once, below, for the account; a goal keeps only what could not be converted.
    if (plan.unconvertedWarning) {
      items.push({ key: `earmark-${plan.goalId}`, tone: 'warn', text: `${plan.goal.name}: ${plan.unconvertedWarning}`, action: 'Review', to: '/goals' });
    }
  }
  for (const account of shortAccounts) {
    if (account.state !== 'short') continue;
    items.push({
      key: `short-${account.accountId}`,
      tone: 'warn',
      text: `${account.name}: ${formatMinor(account.setAsideMinor, account.currency)} set aside, ${formatMinor(Math.max(0, account.balanceMinor), account.currency)} here`,
      action: 'Review',
      to: '/net-worth/assets/$accountId',
      params: { accountId: account.accountId },
    });
  }
  for (const row of idleCash) {
    // Money put at a broker was meant to be invested; while it sits as cash it earns nothing.
    if (row.planGroup !== 'invest' || row.amountMinor <= 0) continue;
    items.push({
      key: `idle-${row.accountId}`,
      tone: 'info',
      text: `${formatMinor(row.amountMinor, row.currency)} has been waiting in ${row.name} since ${shortDate(row.since)}`,
      action: 'Buy',
      to: '/net-worth/trades',
    });
  }
  for (const person of people) {
    for (const loan of person.loans) {
      // Only a date the owner agreed to is worth a warning; a loan with no date waits quietly.
      if (loan.dueState === 'none') continue;
      const who = person.direction === 'lent' ? `${person.personName} owes you` : `You owe ${person.personName}`;
      items.push({
        key: `debt-${loan.accountId}`,
        tone: 'warn',
        text: `${who} ${formatMinor(loan.balanceMinor, loan.currency)} · ${loan.dueLabel}`,
        action: person.direction === 'lent' ? 'Chase' : 'Pay',
        to: '/net-worth/debts',
      });
    }
  }
  for (const loan of loans) {
    if (loan.paymentDueMinor !== null && loan.paymentDueOn !== null) {
      items.push({
        key: `loan-due-${loan.accountId}`,
        tone: 'warn',
        text: `${loan.lenderName} wants ${formatMinor(loan.paymentDueMinor, loan.currency)} on ${shortDate(loan.paymentDueOn)}`,
        action: 'Record',
        to: '/net-worth/loans',
      });
    }
    if (loan.fixedRateEndsOn !== null) {
      items.push({
        key: `loan-rate-${loan.accountId}`,
        tone: 'info',
        text: `${loan.lenderName}: the fixed rate ends ${shortDate(loan.fixedRateEndsOn)}, so the payment will change`,
        action: 'Review',
        to: '/net-worth/loans',
      });
    }
    if (loan.lastInstallmentOf !== null) {
      items.push({
        key: `loan-last-${loan.accountId}`,
        tone: 'info',
        text: `${loan.lastInstallmentOf} is on its last instalment this month`,
        action: 'Review',
        to: '/net-worth/loans',
      });
    }
  }
  return items;
}

/** Change in net worth against the point this many months before the last one. */
export function deltaSince(points: NetWorthPoint[], monthsBack: number): number | null {
  if (points.length === 0) return null;
  const index = points.length - 1 - monthsBack;
  if (index < 0) return null;
  const last = points[points.length - 1]!.netWorthMinor;
  const then = points[index]!.netWorthMinor;
  // A point without a figure (a rate missing) measures nothing: no change is better than a change from 0.
  return last === null || then === null ? null : last - then;
}

/** Months from January of the last point's year, for the "since January" figure. */
export function monthsSinceJanuary(points: NetWorthPoint[]): number | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const january = `${last.month.slice(0, 4)}-01`;
  const index = points.findIndex((point) => point.month === january);
  return index === -1 ? null : points.length - 1 - index;
}
