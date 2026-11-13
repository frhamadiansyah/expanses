import { formatMinor } from '@expanses/core';
import { type AccountRow, spendingSwitchOn, type NamedPayment, type SharedEventTransferView, type SharedEventView, type SharedExpenseView, type SharedPersonView, type SharedSettlementView } from '@expanses/db';
import { keptForSpending } from '../../lib/account-types';

/*
 * The words of a shared event's page (shared events §6, §7), kept out of the components so a test can hold them to
 * the owner's rule: every line names a person, none says "you". Figures are `formatMinor`'s, in the currency each
 * figure is in — a row in its own currency, the header and balances in the event's.
 */

export const possessive = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

/** Whether a record is added up in the figures: not deleted, and readable (I2). */
const counted = (e: SharedExpenseView): boolean => !e.voided && !e.unreadable;

export interface SpendingSlice {
  /** The event category's id, or `none` for spending filed under no category. */
  key: string;
  label: string;
  totalMinor: number;
}

/** The ring's slices: the event's spending by event category in the event currency, largest first; no category is "Other". */
export function spendingSlices(view: Pick<SharedEventView, 'expenses' | 'categories'>): SpendingSlice[] {
  const names = new Map(view.categories.map((c) => [c.categoryId, c.name]));
  const totals = new Map<string, SpendingSlice>();
  for (const e of view.expenses) {
    if (!counted(e)) continue;
    const key = e.categoryId ?? 'none';
    const slice = totals.get(key) ?? { key, label: e.categoryId ? (names.get(e.categoryId) ?? e.categoryName ?? 'Other') : 'Other', totalMinor: 0 };
    slice.totalMinor += e.eventAmountMinor;
    totals.set(key, slice);
  }
  // A refund takes from the slice of its category; a category refunded to nothing (or below) is no slice of the ring.
  return [...totals.values()].filter((slice) => slice.totalMinor > 0).sort((a, b) => b.totalMinor - a.totalMinor);
}

export type DayItem =
  | { kind: 'expense'; expense: SharedExpenseView }
  | { kind: 'settlement'; settlement: SharedSettlementView }
  /** A household transfer listed on the event (an ATM withdrawal): shown, never counted. */
  | { kind: 'transfer'; transfer: SharedEventTransferView };

export interface DayGroup {
  date: string;
  /** What was spent that day in the event currency (settle-ups are not spending). */
  spentMinor: number;
  items: DayItem[];
}

/**
 * The page's records grouped by day, newest day first; in a day, the spending first, then the settle-ups, then the
 * transfers listed on the event — which add nothing to the day's figure.
 */
export function dayGroups(view: Pick<SharedEventView, 'expenses' | 'settlements'> & { transfers?: readonly SharedEventTransferView[] }): DayGroup[] {
  const days = new Map<string, DayGroup>();
  const day = (date: string): DayGroup => {
    const group = days.get(date) ?? { date, spentMinor: 0, items: [] };
    days.set(date, group);
    return group;
  };
  for (const expense of view.expenses) {
    const group = day(expense.occurredOn);
    group.items.push({ kind: 'expense', expense });
    if (counted(expense)) group.spentMinor += expense.eventAmountMinor;
  }
  for (const settlement of view.settlements) day(settlement.occurredOn).items.push({ kind: 'settlement', settlement });
  for (const transfer of view.transfers ?? []) day(transfer.occurredOn).items.push({ kind: 'transfer', transfer });
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * The day groups narrowed to one category of the ring (`none` is spending with no category): its expenses only, deleted
 * ones included as they are in the full list, no settle-up (it has no category), the day's total recounted from what is
 * left, and days left empty dropped. `null` picks nothing and returns the groups as they are.
 */
export function pickedDays(days: readonly DayGroup[], picked: string | null): DayGroup[] {
  if (picked === null) return [...days];
  const out: DayGroup[] = [];
  for (const day of days) {
    const items = day.items.filter((item) => item.kind === 'expense' && (item.expense.categoryId ?? 'none') === picked);
    if (items.length === 0) continue;
    const spentMinor = items.reduce((sum, item) => (item.kind === 'expense' && counted(item.expense) ? sum + item.expense.eventAmountMinor : sum), 0);
    out.push({ date: day.date, spentMinor, items });
  }
  return out;
}

export interface BalanceBar {
  personId: string;
  name: string;
  hasApp: boolean;
  balanceMinor: number;
  /** The bar's length as a share of the track, 0 to 100, scaled to the largest balance. */
  percent: number;
  tone: 'ahead' | 'owing' | 'settled';
}

/** Each person's net balance as a bar scaled to the largest: ahead (owed) or owing, people who left left out. */
export function balanceBars(view: Pick<SharedEventView, 'people'>): BalanceBar[] {
  const people = view.people.filter((p) => !p.removed);
  const largest = Math.max(0, ...people.map((p) => Math.abs(p.balanceMinor)));
  return people.map((p) => ({
    personId: p.personId,
    name: p.name,
    hasApp: p.hasApp,
    balanceMinor: p.balanceMinor,
    percent: largest > 0 ? Math.round((Math.abs(p.balanceMinor) / largest) * 100) : 0,
    tone: p.balanceMinor > 0 ? 'ahead' : p.balanceMinor < 0 ? 'owing' : 'settled',
  }));
}

/** A balance with its sign: "+฿2.100", "−฿900", or "Settled". */
export function signedBalance(balanceMinor: number, currency: string): string {
  if (balanceMinor === 0) return 'Settled';
  return `${balanceMinor > 0 ? '+' : '−'}${formatMinor(Math.abs(balanceMinor), currency)}`;
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

/** A refund (money back, below zero) reads "Refund · <what it undoes>" unless its note already says so. */
function refundTitle(e: SharedExpenseView): string {
  const name = e.note ?? e.categoryName ?? 'Shared spending';
  return e.amountMinor < 0 && !/^refund\b/i.test(name) ? `Refund · ${name}` : name;
}

export function expenseRow(e: SharedExpenseView, view: SharedEventView): { title: string; detail: string; amount: string; share: string | null; flags: string[] } {
  return {
    title: refundTitle(e),
    // The category is the row's glyph and the ring's slice, so the words are who paid and how it was split.
    detail: [`${e.payerName} paid`, e.splitText].filter(Boolean).join(' · '),
    // An unreadable record counts in no figure, so its amount is not shown either (no ₺0 that reads as a real figure):
    // the row says what is wrong, and a tap opens the card for whoever may fix it (I2).
    amount: e.unreadable ? '' : formatMinor(e.amountMinor, e.currency),
    share: e.myShareMinor !== 0 ? `share ${formatMinor(e.myShareMinor, e.currency)}` : null,
    flags: [e.unreadable ? `Needs fixing: ${e.unreadable}` : null, e.voided ? 'Deleted' : null, e.unsent ? 'Not sent yet' : null, ...postingFlags(e.posting, view)].filter((flag): flag is string => flag !== null),
  };
}

/**
 * A transfer listed on the event (trip withdrawal, mockup panel 2): grey, in its own currency, with no share. Its
 * accounts as this phone may name them — the recorder's own, or only a shared one on the partner's phone — else who
 * recorded it; and always "not counted", for it is in no total, balance or settle-up.
 */
export function transferRow(t: SharedEventTransferView): { title: string; subtitle: string; amount: string } {
  const where =
    t.fromName && t.toName ? `${t.fromName} → ${t.toName}` : t.fromName ? `From ${t.fromName}` : t.toName ? `To ${t.toName}` : `Recorded by ${t.recordedByName}`;
  return { title: t.description.trim() || 'Transfer', subtitle: `${where} · not counted`, amount: formatMinor(t.amountMinor, t.currency) };
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

/** The accounts money can be paid from or into on this event: everyday money kept for spending, and cards, still open. */
export function moneyAccounts(accounts: readonly AccountRow[]): AccountRow[] {
  return accounts.filter((a) => a.archivedAt === null && (keptForSpending(a) || (a.kind === 'liability' && a.subtype === 'credit_card' && spendingSwitchOn(a))));
}
