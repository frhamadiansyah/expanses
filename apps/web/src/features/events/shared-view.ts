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

/** "Shared with 2 people"; right after sharing with no names yet there is nobody to count, and it says so. */
export function sharedWithText(count: number): string {
  if (count === 0) return 'Shared, nobody else in it yet';
  return `Shared with ${count} ${count === 1 ? 'person' : 'people'}`;
}

/**
 * What can still be done on the page. `readOnly`: this phone's person is no longer in the event (left, or removed) —
 * the event is kept here to read, and every write is refused by the repositories, so none is offered. `locked`: that,
 * or the event is Done — the writes refused with FINISHED are not offered either; only Reopen is.
 */
export function pageLocks(view: Pick<SharedEventView, 'state' | 'finishedAt'>): { readOnly: boolean; locked: boolean } {
  const readOnly = view.state !== 'active';
  return { readOnly, locked: readOnly || view.finishedAt !== null };
}

/** The notice a page no longer shared here carries, in place of every action it had. */
export function readOnlyLine(view: Pick<SharedEventView, 'name' | 'myName'>): string {
  return `${view.myName} is no longer in ${view.name}. What was recorded is kept here, read-only.`;
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
    // An unreadable record counts in no figure, so its amount is not shown either (no ₺0 that reads as a real figure):
    // the row says what is wrong, and a tap opens the card for whoever may fix it (I2).
    amount: e.unreadable ? '' : formatMinor(e.amountMinor, e.currency),
    share: e.myShareMinor > 0 ? `${possessive(view.myName)} share ${formatMinor(e.myShareMinor, e.currency)}` : null,
    flags: [e.unreadable ? `Needs fixing: ${e.unreadable}` : null, e.voided ? 'Deleted' : null, e.unsent ? 'Not sent yet' : null, ...postingFlags(e.posting, view)].filter((flag): flag is string => flag !== null),
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

/**
 * Whether this phone may delete a settle-up (ruling R11: a wrong one is deleted and recorded again). §3's writer rule
 * for settlements, which `voidSettlement` enforces again: the person who paid or the person who received it, or anyone
 * when neither of them has the app.
 */
export function settlementDeletable(s: SharedSettlementView, view: Pick<SharedEventView, 'people'>): boolean {
  if (s.voided) return false;
  if (s.mine) return true;
  return !view.people.some((p) => p.hasApp && (p.personId === s.fromPersonId || p.personId === s.toPersonId));
}

/** One record waiting for an account (R6), as the Take over sheet lists it: what it was, and which way the money went. */
export interface TakeOverRow {
  recordId: string;
  title: string;
  amount: string;
  /** "From" for what this person paid; "Into" for a settle-up this person received. */
  direction: 'From' | 'Into';
}

export function takeOverRows(view: SharedEventView): TakeOverRow[] {
  const rows: TakeOverRow[] = [];
  for (const w of view.waiting) {
    if (w.reason !== 'choose-account') continue;
    const expense = view.expenses.find((e) => e.expenseId === w.recordId);
    if (expense) {
      rows.push({ recordId: w.recordId, title: expense.note ?? expense.categoryName ?? 'Shared spending', amount: formatMinor(expense.amountMinor, expense.currency), direction: 'From' });
      continue;
    }
    const settlement = view.settlements.find((s) => s.settlementId === w.recordId);
    if (settlement) {
      rows.push({
        recordId: w.recordId,
        title: `${settlement.fromName} paid ${settlement.toName}`,
        amount: formatMinor(settlement.amountMinor, view.currency),
        direction: settlement.toPersonId === view.me ? 'Into' : 'From',
      });
    }
  }
  return rows;
}

/**
 * The account each waiting record is taken over with: its own pick, else the last account picked on the sheet (so one
 * pick covers the common case of everything from one purse). Null while a record has neither.
 */
export function takeOverChoice(recordId: string, picks: Readonly<Record<string, string>>, lastPicked: string): string | null {
  return picks[recordId] || lastPicked || null;
}

/** The records grouped by the account they are taken over with: one `takeOverRecords` call per account. */
export function takeOverBatches(rows: readonly TakeOverRow[], picks: Readonly<Record<string, string>>, lastPicked: string): { accountId: string; recordIds: string[] }[] {
  const batches = new Map<string, string[]>();
  for (const row of rows) {
    const accountId = takeOverChoice(row.recordId, picks, lastPicked);
    if (!accountId) throw new Error(`Choose an account for ${row.title}`);
    batches.set(accountId, [...(batches.get(accountId) ?? []), row.recordId]);
  }
  return [...batches].map(([accountId, recordIds]) => ({ accountId, recordIds }));
}

/** The accounts money can be paid from or into on this event: everyday money and cards, still open. */
export function moneyAccounts(accounts: readonly AccountRow[]): AccountRow[] {
  const spendable = SPENDABLE_SUBTYPES as readonly string[];
  return accounts.filter((a) => a.archivedAt === null && ((a.kind === 'asset' && spendable.includes(a.subtype)) || (a.kind === 'liability' && a.subtype === 'credit_card')));
}
