import { expenseInEvent, type ExpenseRecord, type SettlementRecord, SharedEventError } from './split';

/*
 * Who owes whom in a shared event (spec §4). A balance is paid − own shares + settlements paid − settlements received,
 * in the event currency: positive, the group owes this person; negative, this person owes the group. The sum over
 * everyone is always zero, because every expense nets to zero (`expenseInEvent`) and every settlement moves the same
 * figure from one person to another.
 */

export function balances(expenses: readonly ExpenseRecord[], settlements: readonly SettlementRecord[], eventCurrency: string, people: readonly string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (personId: string, minor: number) => (out[personId] = (out[personId] ?? 0) + minor);
  for (const personId of people) out[personId] = 0;
  for (const expense of expenses) {
    if (expense.voided) continue;
    const { paidMinor, shares } = expenseInEvent(expense, eventCurrency);
    add(expense.payerPersonId, paidMinor);
    for (const share of shares) add(share.personId, -share.minor);
  }
  for (const s of settlements) {
    if (s.voided) continue;
    add(s.fromPersonId, s.amountMinor);
    add(s.toPersonId, -s.amountMinor);
  }
  return out;
}

export interface SuggestedPayment {
  fromPersonId: string;
  toPersonId: string;
  amountMinor: number;
}

interface Side {
  personId: string;
  minor: number;
}

/** Larger amounts first, then person id: the one order every phone sorts by, so every phone suggests the same list. */
const byAmountThenId = (a: Side, b: Side) => b.minor - a.minor || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0);

/**
 * The fewest payments that settle every balance, greedily: the largest debtor pays the largest creditor as much as
 * either side allows, again and again. A function of the balances alone — never of the order they were read in
 * (Review Focus 4).
 */
export function fewestPayments(owed: Readonly<Record<string, number>>): SuggestedPayment[] {
  const entries = Object.entries(owed);
  if (entries.reduce((sum, [, minor]) => sum + minor, 0) !== 0) throw new SharedEventError('UNBALANCED', 'Balances that do not add up to zero cannot be settled');
  const debtors: Side[] = entries.filter(([, m]) => m < 0).map(([personId, m]) => ({ personId, minor: -m }));
  const creditors: Side[] = entries.filter(([, m]) => m > 0).map(([personId, m]) => ({ personId, minor: m }));
  const out: SuggestedPayment[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byAmountThenId);
    creditors.sort(byAmountThenId);
    const debtor = debtors[0]!;
    const creditor = creditors[0]!;
    const amountMinor = Math.min(debtor.minor, creditor.minor);
    out.push({ fromPersonId: debtor.personId, toPersonId: creditor.personId, amountMinor });
    debtor.minor -= amountMinor;
    creditor.minor -= amountMinor;
    if (debtor.minor === 0) debtors.shift();
    if (creditor.minor === 0) creditors.shift();
  }
  return out;
}
