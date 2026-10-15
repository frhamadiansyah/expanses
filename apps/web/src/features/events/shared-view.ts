import { formatMinor } from '@expanses/core';
import { type AccountRow, type NamedPayment, type SharedEventView, type SharedExpenseView, type SharedPersonView, type SharedSettlementView, SPENDABLE_SUBTYPES } from '@expanses/db';

/*
 * The words of a shared event's page (shared events §6, §7), kept out of the components so a test can hold them to
 * the owner's rule: every line names a person, none says "you". Figures are `formatMinor`'s, in the currency each
 * figure is in — a row in its own currency, the header and balances in the event's.
 */

export const possessive = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

export function headerLine(view: SharedEventView): string {
  return `Spent ${formatMinor(view.spentMinor, view.currency)} · ${possessive(view.myName)} share ${formatMinor(view.myShareMinor, view.currency)}`;
}

export function sharedWithText(count: number): string {
  return `Shared with ${count} ${count === 1 ? 'person' : 'people'}`;
}

function postingFlags(posting: SharedExpenseView['posting'], view: SharedEventView): string[] {
  return [
    posting?.changedByName ? `Changed by ${posting.changedByName}` : null,
    posting?.unposted === 'choose-account' ? `Not in ${possessive(view.myName)} books yet` : null,
    posting?.unposted === 'no-rate' ? 'Waiting for a rate' : null,
  ].filter((flag): flag is string => flag !== null);
}

export function expenseRow(e: SharedExpenseView, view: SharedEventView): { title: string; detail: string; amount: string; share: string | null; flags: string[] } {
  return {
    title: e.note ?? e.categoryName ?? 'Shared spending',
    detail: [`${e.payerName} paid`, e.categoryName, e.splitText].filter(Boolean).join(' · '),
    amount: formatMinor(e.amountMinor, e.currency),
    share: e.myShareMinor > 0 ? `${possessive(view.myName)} share ${formatMinor(e.myShareMinor, e.currency)}` : null,
    flags: [e.voided ? 'Deleted' : null, e.unsent ? 'Not sent yet' : null, ...postingFlags(e.posting, view)].filter((flag): flag is string => flag !== null),
  };
}

export function settlementRow(s: SharedSettlementView, view: SharedEventView): { title: string; amount: string; flags: string[] } {
  return {
    title: `${s.fromName} paid ${s.toName}`,
    amount: formatMinor(s.amountMinor, view.currency),
    flags: [s.voided ? 'Deleted' : null, s.unsent ? 'Not sent yet' : null, ...postingFlags(s.posting, view)].filter((flag): flag is string => flag !== null),
  };
}

export function balanceLine(p: SharedPersonView, currency: string): string {
  if (p.balanceMinor > 0) return `${p.name} is owed ${formatMinor(p.balanceMinor, currency)}`;
  if (p.balanceMinor < 0) return `${p.name} owes ${formatMinor(-p.balanceMinor, currency)}`;
  return `${p.name} is settled`;
}

export function paymentLine(p: NamedPayment, currency: string): string {
  return `${p.fromName} pays ${p.toName} ${formatMinor(p.amountMinor, currency)}`;
}

/** The suggested payments this phone's person pays or receives: where Settle up is offered. */
export function mineToSettle(view: SharedEventView): NamedPayment[] {
  return view.payments.filter((p) => p.fromPersonId === view.me || p.toPersonId === view.me);
}

/** "2 records are not in Rina's books yet" — what waits for an account here (ruling R6), or null. */
export function waitingLine(view: SharedEventView): string | null {
  const count = view.waiting.filter((w) => w.reason === 'choose-account').length;
  if (count === 0) return null;
  return `${count} ${count === 1 ? 'record is' : 'records are'} not in ${possessive(view.myName)} books yet`;
}

/** The accounts money can be paid from or into on this event: everyday money and cards, still open. */
export function moneyAccounts(accounts: readonly AccountRow[]): AccountRow[] {
  const spendable = SPENDABLE_SUBTYPES as readonly string[];
  return accounts.filter((a) => a.archivedAt === null && ((a.kind === 'asset' && spendable.includes(a.subtype)) || (a.kind === 'liability' && a.subtype === 'credit_card')));
}
