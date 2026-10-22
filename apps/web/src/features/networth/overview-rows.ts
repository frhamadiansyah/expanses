import { formatMinor, type SheetGroup, type SheetRow } from '@expanses/core';
import type { AccountRow, AccountSetAsideRow, AssetValueRow, GoalPlanRow, IdleCashRow, NetWorthPoint, PersonDebtRow, TradeTemplateRow } from '@expanses/db';

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
  to: '/net-worth/assets' | '/net-worth/trades' | '/net-worth/trades/plans' | '/goals' | '/net-worth/lend-borrow' | '/net-worth/loans' | '/net-worth/assets/$accountId';
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
    if ((value.mode === 'market' && value.unitsMicro === 0) || (value.mode === 'amount' && value.valueMinor === 0 && value.costMinor === 0)) continue;
    const what = value.mode === 'market' ? 'price' : value.mode === 'amount' ? 'value' : 'estimate';
    const paid = value.mode === 'amount' ? 'the money put in' : 'the price paid';
    const text = value.asOf ? `${value.name}: ${what} last updated ${shortDate(value.asOf)}` : `${value.name}: no ${what} yet, showing ${paid}`;
    items.push({ key: `stale-${value.accountId}`, tone: 'warn', text, action: 'Update', to: '/net-worth/assets' });
  }
  for (const template of dueTemplates) {
    const name = values.find((value) => value.accountId === template.accountId)?.name ?? 'a holding';
    items.push({ key: `due-${template.id}`, tone: 'warn', text: `Monthly buy of ${name} is due`, action: 'Record', to: '/net-worth/trades/plans' });
  }
  for (const plan of goalPlans) {
    if (plan.status === 'behind') {
      items.push({ key: `goal-${plan.goalId}`, tone: 'warn', text: `${plan.goal.name} needs more each month than is set up`, action: 'Review', to: '/goals' });
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
      const who = person.direction === 'lent' ? `Owed by ${person.personName}` : `Owed to ${person.personName}`;
      items.push({
        key: `debt-${loan.accountId}`,
        tone: 'warn',
        text: `${who} ${formatMinor(loan.balanceMinor, loan.currency)} · ${loan.dueLabel}`,
        action: person.direction === 'lent' ? 'Chase' : 'Pay',
        to: '/net-worth/lend-borrow',
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

/** A balance sheet row as the overview draws it: `approx` when it adds up pockets held in more than one currency. */
export type ShownSheetRow = SheetRow & { approx?: boolean };

/**
 * An account with pockets is one row on the overview, as it is on the Assets page: Wise, at its pockets' total in the
 * base currency, where its first pocket stood — not Wise USD and Wise SGD side by side. `approx` marks a total reached
 * through a rate, for the ≈ in front of it. Every other row is as it was.
 */
export function foldPockets(
  groups: readonly SheetGroup[],
  accounts: readonly Pick<AccountRow, 'id' | 'name' | 'kind' | 'parentId' | 'currency'>[],
  baseCurrency: string,
): SheetGroup[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return groups.map((group) => {
    const rows: ShownSheetRow[] = [];
    const at = new Map<string, number>();
    for (const row of group.rows) {
      const account = byId.get(row.accountId);
      const parent = account?.kind === 'asset' && account.parentId ? byId.get(account.parentId) : undefined;
      if (!parent || !account) {
        rows.push(row);
        continue;
      }
      const foreign = (account.currency ?? baseCurrency) !== baseCurrency;
      const seen = at.get(parent.id);
      if (seen === undefined) {
        at.set(parent.id, rows.length);
        rows.push({ accountId: parent.id, name: parent.name, amountMinor: row.amountMinor, note: null, approx: foreign });
      } else {
        const was = rows[seen]!;
        rows[seen] = { ...was, amountMinor: was.amountMinor + row.amountMinor, approx: was.approx || foreign };
      }
    }
    return { ...group, rows };
  });
}
