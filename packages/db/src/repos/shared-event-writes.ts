import { balances, convertMinor, expenseInEvent, isRateString, isSupportedCurrency, MoneyError, SharedEventError, sharesOf, splitJsonOf, type SplitInput, uuidv7 } from '@expanses/core';
import { type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { withCapture } from '../sync/capture';
import { secondDeviceInTx } from '../sync/authority';
import { followEventOpTx, postEventRecordTx, rateToBaseTx, recordsReadingTx, setPaidFromTx } from './shared-event-postings';
import { takeExpenseOffItemsTx } from './shared-item-state';
import { type EventBookRow, eventBookOfEventTx, eventRecordsTx, expenseRecordTx, settlementRecordTx, type StoredExpense } from './shared-event-records';

/*
 * Writing a shared event (shared events §5–§7). Each write is one db transaction: the records under `withCapture` —
 * judged there by the same rules a peer's op meets (sync/events/authority.ts) — then this phone's own transaction for
 * them (`postEventRecordTx`). The account a person paid from, a card, an MCC, a channel and photos stay on this phone:
 * they go to `event_postings` and the local transaction, never into a record.
 *
 * Every message names people and never says "you" (the owner's rule).
 */

export type SharedEventDbErrorCode = 'NOT_SHARED' | 'FINISHED' | 'PAYER_ONLY' | 'INVALID' | 'NOT_SETTLED' | 'IN_USE' | 'HAS_APP' | 'NO_RATE';

export class SharedEventDbError extends Error {
  readonly code: SharedEventDbErrorCode;

  constructor(code: SharedEventDbErrorCode, message: string) {
    super(message);
    this.name = 'SharedEventDbError';
    this.code = code;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const invalid = (message: string) => new SharedEventDbError('INVALID', message);

/** The shared event behind a local event in this workspace, or null for an event that is not shared. */
export async function sharedEventOf(database: Database, ws: WorkspaceContext, eventId: string): Promise<EventBookRow | null> {
  const book = await eventBookOfEventTx(database.db, eventId).catch(() => null);
  return book && book.workspaceId === ws.workspaceId ? book : null;
}

/** The event, open for writing: shared and active here, and not Done unless `allowDone` (R9). */
export async function openSharedEventTx(tx: Db, ws: WorkspaceContext, eventId: string, allowDone = false): Promise<EventBookRow> {
  const book = await eventBookOfEventTx(tx, eventId);
  if (!book || book.workspaceId !== ws.workspaceId) throw new SharedEventDbError('NOT_SHARED', 'That event is not shared here');
  if (book.state !== 'active') throw new SharedEventDbError('NOT_SHARED', `${book.name} is no longer shared here, and is kept read-only`);
  if (book.finishedAt && !allowDone) throw new SharedEventDbError('FINISHED', `${book.name} is done. Reopen it to change anything.`);
  return book;
}

interface PersonRow {
  name: string;
  memberId: string | null;
  removed: boolean;
}

async function peopleTx(tx: Db, bookId: string): Promise<Map<string, PersonRow>> {
  const rows = await tx.values<[string, string, string | null, string | null]>(sql`SELECT id, name, member_id, removed_at FROM event_people WHERE book_id = ${bookId}`);
  return new Map(rows.map(([id, name, memberId, removedAt]) => [id, { name, memberId, removed: removedAt !== null }]));
}

const nameIn = (people: Map<string, PersonRow>, personId: string) => people.get(personId)?.name ?? 'Someone';

/*
 * A money account of this workspace that a person paid from or received into. Never a trip balance (`event_balance`):
 * that is the event's own side of every line, and paying "from" it would post nothing anyone could follow. A new pick
 * is an open account; an account already held for a record (`held`) still counts once archived, as the derivation
 * reads it (Task 5): archiving it later must not stop the payer editing what they paid.
 */
async function accountCurrencyTx(tx: Db, ws: WorkspaceContext, accountId: string, held = false): Promise<string> {
  const [row] = await tx.values<[string | null]>(sql`
    SELECT currency FROM accounts
    WHERE id = ${accountId} AND workspace_id = ${ws.workspaceId} AND kind IN ('asset', 'liability') AND subtype <> 'event_balance'
      AND (${held ? 1 : 0} = 1 OR archived_at IS NULL)`);
  if (!row || !row[0]) throw invalid('Choose an account');
  return row[0];
}

/** The account's own-currency figure to keep (R5): null when the account is in `currency`, else a figure above zero. */
async function chargedFor(tx: Db, ws: WorkspaceContext, accountId: string, currency: string, charged: number | null | undefined, held = false): Promise<number | null> {
  const own = await accountCurrencyTx(tx, ws, accountId, held);
  if (own === currency) return null;
  const [named] = await tx.values<[string]>(sql`SELECT name FROM accounts WHERE id = ${accountId}`);
  if (charged === null || charged === undefined || !Number.isSafeInteger(charged) || charged <= 0) throw invalid(`Enter what ${named?.[0] ?? 'the account'} was charged in ${own}`);
  return charged;
}

/** The figures of an expense, checked as the screen should already have: date, amount, currency, rate, split, category. */
async function checkExpenseTx(tx: Db, book: EventBookRow, people: Map<string, PersonRow>, e: { occurredOn: string; amountMinor: number; currency: string; rateToEvent: string; payerPersonId: string; split: SplitInput; categoryId: string | null }, kept: string | null = null): Promise<void> {
  if (!DATE.test(e.occurredOn)) throw invalid('Pick a date');
  if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0) throw invalid('Enter an amount above zero');
  if (!isSupportedCurrency(e.currency)) throw invalid(`Unsupported currency ${e.currency}`);
  if (!isRateString(e.rateToEvent)) throw invalid(`Enter the rate to ${book.currency}`);
  if (e.currency === book.currency && Number(e.rateToEvent) !== 1) throw invalid(`An amount in ${book.currency} has rate 1`);
  try {
    sharesOf(e);
  } catch (error) {
    if (error instanceof SharedEventError) {
      if (error.code === 'SPLIT_MISMATCH') throw invalid('The amounts must add up to the total');
      if (error.code === 'DUPLICATE_PERSON') throw invalid('A person is in the split once');
      if (error.code === 'BAD_AMOUNT') throw invalid('Each share is a whole amount, zero or more');
      throw invalid('Tick at least one person to share it');
    }
    throw error;
  }
  const named = e.split.mode === 'equal' ? e.split.people : e.split.shares.map((s) => s.personId);
  for (const personId of [e.payerPersonId, ...named]) {
    const person = people.get(personId);
    if (!person || person.removed) throw invalid('That person is no longer in this event');
  }
  // A category archived after the expense was recorded stays on it: only a newly picked one must be open.
  if (e.categoryId !== null && e.categoryId !== kept) {
    const [category] = await tx.values(sql`SELECT 1 FROM event_categories WHERE book_id = ${book.bookId} AND id = ${e.categoryId} AND archived_at IS NULL`);
    if (!category) throw invalid('Pick one of the event’s categories');
  }
}

export interface SharedExpenseInput {
  occurredOn: string;
  amountMinor: number;
  currency: string;
  rateToEvent: string;
  payerPersonId: string;
  /** This person's own account, when this person paid (R13): what it was charged in its own currency when that differs. */
  paidFrom: { accountId: string; chargedMinor: number | null; cardId?: string | null } | null;
  split: SplitInput;
  categoryId: string | null;
  note: string | null;
  mcc?: string | null;
  channel?: 'online' | 'offline' | null;
  photoIds?: string[];
}

const targets = (bookId: string, id: string) => [
  { entity: 'event_expense', id, bookId },
  { entity: 'event_expense_detail', id, bookId },
];

export async function recordSharedExpense(database: Database, ws: WorkspaceContext, eventId: string, input: SharedExpenseInput): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    await checkExpenseTx(tx, book, people, input);
    const mine = input.payerPersonId === book.me;
    // R13: a person with the app records their own payments.
    if (!mine && people.get(input.payerPersonId)?.memberId) throw invalid(`${nameIn(people, input.payerPersonId)} records what ${nameIn(people, input.payerPersonId)} paid`);
    if (mine && !input.paidFrom) throw invalid(`Choose the account ${nameIn(people, book.me)} paid from`);
    const charged = mine ? await chargedFor(tx, ws, input.paidFrom!.accountId, input.currency, input.paidFrom!.chargedMinor) : null;
    await withCapture(tx, targets(book.bookId, id), async () => {
      await tx.run(sql`
        INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES (${book.bookId}, ${id}, ${input.occurredOn}, ${input.amountMinor}, ${input.currency}, ${input.rateToEvent}, ${input.payerPersonId}, ${mine ? book.me : null}, NULL)`);
      await tx.run(sql`
        INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES (${book.bookId}, ${id}, ${input.note?.trim() || null}, ${input.categoryId}, ${input.split.mode}, ${splitJsonOf(input.split)}, ${book.me}, NULL)`);
    });
    if (mine) await setPaidFromTx(tx, book.bookId, id, 'expense', { accountId: input.paidFrom!.accountId, amountMinor: charged });
    // The card, MCC and channel describe a purchase this person made: on someone else's payment this phone posts only
    // its share against the trip balance, which no card paid.
    await postEventRecordTx(tx, book.bookId, 'expense', id, null, { ...(mine ? { cardId: input.paidFrom?.cardId ?? null, mcc: input.mcc ?? null, channel: input.channel ?? null } : {}), ...(input.photoIds ? { photoIds: input.photoIds } : {}) });
  });
  return id;
}

export interface SharedExpensePatch {
  occurredOn?: string;
  amountMinor?: number;
  currency?: string;
  rateToEvent?: string;
  /** What this person's own account was charged, when it is in another currency. */
  chargedMinor?: number | null;
  split?: SplitInput;
  categoryId?: string | null;
  note?: string | null;
}

async function liveExpenseTx(tx: Db, book: EventBookRow, expenseId: string): Promise<StoredExpense> {
  // A split that cannot be read is opened with none, so it can be fixed by giving it one (I2).
  const record = await expenseRecordTx(tx, book.bookId, expenseId).catch(async (error: unknown) => {
    if (!(error instanceof SharedEventError)) throw error;
    return (await eventRecordsTx(tx, book.bookId)).unparsed.find((u) => u.expense.id === expenseId)?.expense ?? null;
  });
  if (!record || record.voided) throw invalid('That expense was deleted');
  return record;
}

/** D8: the money of an expense paid from a member's account is that member's alone. */
function refuseUnlessPayer(record: StoredExpense, book: EventBookRow, people: Map<string, PersonRow>): void {
  if (record.payerMemberId !== null && record.payerMemberId !== book.me) {
    const who = nameIn(people, record.payerPersonId);
    throw new SharedEventDbError('PAYER_ONLY', `Only ${who} changes the amount, currency, rate or date of what ${who} paid, or deletes it`);
  }
}

export async function editSharedExpense(database: Database, ws: WorkspaceContext, eventId: string, expenseId: string, patch: SharedExpensePatch): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    const record = await liveExpenseTx(tx, book, expenseId);
    const next = {
      occurredOn: patch.occurredOn ?? record.occurredOn,
      amountMinor: patch.amountMinor ?? record.amountMinor,
      currency: patch.currency ?? record.currency,
      rateToEvent: patch.rateToEvent ?? record.rateToEvent,
      payerPersonId: record.payerPersonId,
      split: patch.split ?? record.split,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : record.categoryId,
      note: patch.note !== undefined ? patch.note?.trim() || null : record.note,
    };
    const money = next.occurredOn !== record.occurredOn || next.amountMinor !== record.amountMinor || next.currency !== record.currency || next.rateToEvent !== record.rateToEvent;
    if (money) refuseUnlessPayer(record, book, people);
    await checkExpenseTx(tx, book, people, next, record.categoryId);
    const detail = splitJsonOf(next.split) !== splitJsonOf(record.split) || next.categoryId !== record.categoryId || next.note !== record.note;
    // Each half is captured only when it is written: capture judges every row it is pointed at by the writer rules
    // (sync/events/authority.ts), changed or not, so pointing it at a member's expense whose money is untouched would
    // refuse a friend's split or note edit that D8 allows.
    if (money) {
      await withCapture(tx, { entity: 'event_expense', id: expenseId, bookId: book.bookId }, () =>
        tx.run(sql`
          UPDATE event_expenses SET occurred_on = ${next.occurredOn}, amount_minor = ${next.amountMinor}, currency = ${next.currency}, rate_to_event = ${next.rateToEvent}
          WHERE book_id = ${book.bookId} AND id = ${expenseId}`),
      );
    }
    if (detail) {
      await withCapture(tx, { entity: 'event_expense_detail', id: expenseId, bookId: book.bookId }, () =>
        tx.run(sql`
          UPDATE event_expense_details SET note = ${next.note}, category_id = ${next.categoryId}, split_mode = ${next.split.mode}, split_json = ${splitJsonOf(next.split)}, updated_by = ${book.me}
          WHERE book_id = ${book.bookId} AND id = ${expenseId}`),
      );
    }
    if (record.payerMemberId === book.me && (patch.chargedMinor !== undefined || next.currency !== record.currency)) {
      const [held] = await tx.values<[string | null]>(sql`SELECT account_id FROM event_postings WHERE book_id = ${book.bookId} AND record_id = ${expenseId}`);
      if (held?.[0]) await setPaidFromTx(tx, book.bookId, expenseId, 'expense', { accountId: held[0], amountMinor: await chargedFor(tx, ws, held[0], next.currency, patch.chargedMinor, true) });
    }
    await postEventRecordTx(tx, book.bookId, 'expense', expenseId, null);
  });
}

export async function voidSharedExpense(database: Database, ws: WorkspaceContext, eventId: string, expenseId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const record = await liveExpenseTx(tx, book, expenseId);
    refuseUnlessPayer(record, book, await peopleTx(tx, book.bookId));
    await withCapture(tx, { entity: 'event_expense', id: expenseId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_expenses SET voided_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${expenseId}`),
    );
    // Any plan item it paid towards loses that payment. One whose only payment it was goes back on the list; one paid
    // in parts keeps its other payments and its mark.
    await takeExpenseOffItemsTx(tx, book.bookId, expenseId);
    await postEventRecordTx(tx, book.bookId, 'expense', expenseId, null);
  });
}

export interface SettlementInput {
  occurredOn: string;
  fromPersonId: string;
  toPersonId: string;
  /** In the event currency. */
  amountMinor: number;
  /** This person's own account, when this person paid or received it; its own-currency figure when that differs. */
  account: { accountId: string; amountMinor: number | null } | null;
}

export async function recordSettlement(database: Database, ws: WorkspaceContext, eventId: string, input: SettlementInput): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    if (!DATE.test(input.occurredOn)) throw invalid('Pick a date');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw invalid('Enter an amount above zero');
    if (input.fromPersonId === input.toPersonId) throw invalid('A settle-up is between two people');
    for (const personId of [input.fromPersonId, input.toPersonId]) if (!people.get(personId) || people.get(personId)!.removed) throw invalid('That person is no longer in this event');
    const fromMember = people.get(input.fromPersonId)!.memberId;
    const toMember = people.get(input.toPersonId)!.memberId;
    // §3: either side's member writes it; anyone when neither side has the app.
    if ((fromMember || toMember) && book.me !== fromMember && book.me !== toMember) {
      throw invalid(`Only ${[fromMember ? nameIn(people, input.fromPersonId) : null, toMember ? nameIn(people, input.toPersonId) : null].filter(Boolean).join(' or ')} records this`);
    }
    const party = book.me === input.fromPersonId || book.me === input.toPersonId;
    if (party && !input.account) throw invalid(`Choose the account ${nameIn(people, book.me)} ${book.me === input.fromPersonId ? 'paid from' : 'received it into'}`);
    const figure = party ? await chargedFor(tx, ws, input.account!.accountId, book.currency, input.account!.amountMinor) : null;
    await withCapture(tx, { entity: 'event_settlement', id, bookId: book.bookId }, () =>
      tx.run(sql`
        INSERT INTO event_settlements (book_id, id, occurred_on, from_person_id, to_person_id, from_member_id, to_member_id, amount_minor, voided_at)
        VALUES (${book.bookId}, ${id}, ${input.occurredOn}, ${input.fromPersonId}, ${input.toPersonId}, ${fromMember}, ${toMember}, ${input.amountMinor}, NULL)`),
    );
    if (party) await setPaidFromTx(tx, book.bookId, id, 'settlement', { accountId: input.account!.accountId, amountMinor: figure });
    await postEventRecordTx(tx, book.bookId, 'settlement', id, null);
  });
  return id;
}

export async function voidSettlement(database: Database, ws: WorkspaceContext, eventId: string, settlementId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const record = await settlementRecordTx(tx, book.bookId, settlementId);
    if (!record || record.voided) throw invalid('That settle-up was deleted');
    const members = [record.fromMemberId, record.toMemberId].filter((m): m is string => m !== null);
    if (members.length > 0 && !members.includes(book.me)) {
      const people = await peopleTx(tx, book.bookId);
      throw new SharedEventDbError('PAYER_ONLY', `Only ${nameIn(people, record.fromPersonId)} or ${nameIn(people, record.toPersonId)} deletes this settle-up`);
    }
    await withCapture(tx, { entity: 'event_settlement', id: settlementId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_settlements SET voided_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${settlementId}`),
    );
    await postEventRecordTx(tx, book.bookId, 'settlement', settlementId, null);
  });
}

/** A figure in `from` converted to `to` at the day's rates on this phone (both through the base currency), or null. */
async function convertedTx(tx: Db, book: EventBookRow, minor: number, from: string, to: string, on: string): Promise<number | null> {
  if (from === to) return minor;
  const fromRate = await rateToBaseTx(tx, from, book.baseCurrency, on);
  const toRate = await rateToBaseTx(tx, to, book.baseCurrency, on);
  return fromRate === null || toRate === null ? null : convertMinor(minor, from, to, fromRate / toRate);
}

/**
 * R6: this person's records that are not in this phone's books yet — paid by them before they claimed their name, on a
 * stale view, or before a lost phone — are taken over: the record names this member (a takeover op, set once) and this
 * phone keeps the account they came from, with the day's converted figure when the currencies differ.
 */
export async function takeOverRecords(database: Database, ws: WorkspaceContext, eventId: string, input: { accountId: string; recordIds: readonly string[] }): Promise<void> {
  await database.transaction(async (tx) => {
    // M3: also on a Done event. A takeover changes no shared figure (who paid, how much, who shares it all stay); it
    // only puts this person's own payment into this person's own books, which a name claimed after Done still needs.
    const book = await openSharedEventTx(tx, ws, eventId, true);
    const own = await accountCurrencyTx(tx, ws, input.accountId);
    for (const recordId of input.recordIds) {
      const expense = await expenseRecordTx(tx, book.bookId, recordId);
      if (expense) {
        if (expense.voided || expense.payerPersonId !== book.me || (expense.payerMemberId !== null && expense.payerMemberId !== book.me)) throw invalid('Only what this person paid can be taken over');
        const figure = own === expense.currency ? null : await convertedTx(tx, book, expense.amountMinor, expense.currency, own, expense.occurredOn);
        if (own !== expense.currency && figure === null) throw new SharedEventDbError('NO_RATE', `No ${expense.currency} or ${own} rate for ${expense.occurredOn} yet`);
        if (expense.payerMemberId === null) {
          await withCapture(tx, { entity: 'event_expense', id: recordId, bookId: book.bookId }, () =>
            tx.run(sql`UPDATE event_expenses SET payer_member_id = ${book.me} WHERE book_id = ${book.bookId} AND id = ${recordId}`),
          );
        }
        await setPaidFromTx(tx, book.bookId, recordId, 'expense', { accountId: input.accountId, amountMinor: figure });
        await postEventRecordTx(tx, book.bookId, 'expense', recordId, null);
        continue;
      }
      const settlement = await settlementRecordTx(tx, book.bookId, recordId);
      if (!settlement || settlement.voided) throw invalid('That record was deleted');
      const side = settlement.fromPersonId === book.me ? 'from' : settlement.toPersonId === book.me ? 'to' : null;
      if (side === null) throw invalid('Only a settle-up this person paid or received can be taken over');
      const figure = own === book.currency ? null : await convertedTx(tx, book, settlement.amountMinor, book.currency, own, settlement.occurredOn);
      if (own !== book.currency && figure === null) throw new SharedEventDbError('NO_RATE', `No ${book.currency} or ${own} rate for ${settlement.occurredOn} yet`);
      const memberColumn = side === 'from' ? 'from_member_id' : 'to_member_id';
      if ((side === 'from' ? settlement.fromMemberId : settlement.toMemberId) === null) {
        await withCapture(tx, { entity: 'event_settlement', id: recordId, bookId: book.bookId }, () =>
          tx.run(sql`UPDATE event_settlements SET ${sql.raw(memberColumn)} = ${book.me} WHERE book_id = ${book.bookId} AND id = ${recordId}`),
        );
      }
      await setPaidFromTx(tx, book.bookId, recordId, 'settlement', { accountId: input.accountId, amountMinor: figure });
      await postEventRecordTx(tx, book.bookId, 'settlement', recordId, null);
    }
  });
}

export async function addEventPerson(database: Database, ws: WorkspaceContext, eventId: string, name: string): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const trimmed = name.trim();
    if (!trimmed) throw invalid('Enter a name');
    const taken = [...(await peopleTx(tx, book.bookId)).values()].some((p) => !p.removed && p.name.toLowerCase() === trimmed.toLowerCase());
    if (taken) throw invalid(`${trimmed} is already in this event`);
    await withCapture(tx, { entity: 'event_person', id, bookId: book.bookId }, () =>
      tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${book.bookId}, ${id}, ${trimmed}, NULL, NULL)`),
    );
  });
  return id;
}

export async function renameEventPerson(database: Database, ws: WorkspaceContext, eventId: string, personId: string, name: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const trimmed = name.trim();
    if (!trimmed) throw invalid('Enter a name');
    const people = await peopleTx(tx, book.bookId);
    if (!people.get(personId) || people.get(personId)!.removed) throw invalid('That person is no longer in this event');
    const taken = [...people].some(([id, p]) => id !== personId && !p.removed && p.name.toLowerCase() === trimmed.toLowerCase());
    if (taken) throw invalid(`${trimmed} is already in this event`);
    await withCapture(tx, { entity: 'event_person', id: personId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_people SET name = ${trimmed} WHERE book_id = ${book.bookId} AND id = ${personId}`),
    );
    // The settle-ups that name this person read the new name here too ("Andika paid Rina"), as on every other phone.
    for (const { kind, recordId } of await recordsReadingTx(tx, book.bookId, 'event_person', personId)) await postEventRecordTx(tx, book.bookId, kind, recordId, null);
  });
}

/**
 * D9: why this person cannot be removed now, or null — a balance that is not zero, or a live record naming them (as
 * payer, in a split, or on either side of a settle-up). A voided record no longer names anyone. The split is read as
 * written rather than through `sharesOf`, so a peer's split that does not add up still keeps its people in.
 *
 * A peer's expense core cannot count (a rate it cannot read, a split that does not add up) is left out of the balance
 * rather than failing the check (controller ruling f); one that names this person leaves their balance unknown, so it
 * holds them as an unsettled one does — said plainly, so leaving is refused too.
 */
export async function personRefusalTx(db: Db, book: EventBookRow, personId: string): Promise<SharedEventDbError | null> {
  const { expenses, unparsed, settlements, people } = await eventRecordsTx(db, book.bookId);
  const name = people.find((p) => p.personId === personId)?.name ?? 'This person';
  // A split that cannot be read at all could name anyone: nobody's balance is known until it is fixed (I2).
  if (unparsed.some((u) => !u.expense.voided)) {
    return new SharedEventDbError('NOT_SETTLED', `${name}'s balance cannot be worked out yet: an expense in ${book.name} cannot be read here`);
  }
  const inSplit = (split: SplitInput) => (split.mode === 'equal' ? split.people.includes(personId) : split.shares.some((s) => s.personId === personId));
  const countable = (e: StoredExpense) => {
    try {
      expenseInEvent(e, book.currency);
      return true;
    } catch (error) {
      if (error instanceof SharedEventError || error instanceof MoneyError) return false;
      throw error;
    }
  };
  const uncounted = expenses.filter((e) => !e.voided && !countable(e));
  if (uncounted.some((e) => e.payerPersonId === personId || inSplit(e.split))) {
    return new SharedEventDbError('NOT_SETTLED', `${name}'s balance cannot be worked out yet: an expense naming ${name} cannot be read here`);
  }
  const owed = balances(expenses.filter((e) => !uncounted.includes(e)), settlements, book.currency, [personId])[personId] ?? 0;
  if (owed !== 0) return new SharedEventDbError('NOT_SETTLED', `${name}'s balance is not zero yet: settle up first`);
  const named =
    expenses.some((e) => !e.voided && (e.payerPersonId === personId || inSplit(e.split))) ||
    settlements.some((s) => !s.voided && (s.fromPersonId === personId || s.toPersonId === personId));
  if (named) return new SharedEventDbError('IN_USE', `${name} is in an expense or a settle-up, so ${name} stays`);
  return null;
}

export async function removeEventPerson(database: Database, ws: WorkspaceContext, eventId: string, personId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const people = await peopleTx(tx, book.bookId);
    const person = people.get(personId);
    if (!person || person.removed) return;
    if (person.memberId) throw new SharedEventDbError('HAS_APP', `${person.name} has the app: ${person.name} is removed from People, which also signs ${person.name}'s phones out of the event`);
    const refused = await personRefusalTx(tx, book, personId);
    if (refused) throw refused;
    await withCapture(tx, { entity: 'event_person', id: personId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_people SET removed_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${personId}`),
    );
  });
}

async function writeEventTx(tx: Tx, book: EventBookRow, set: SQL): Promise<void> {
  await withCapture(tx, { entity: 'shared_event', id: book.bookId, bookId: book.bookId }, () => tx.run(sql`UPDATE shared_events SET ${set} WHERE book_id = ${book.bookId}`));
  await followEventOpTx(tx, book.bookId, 'shared_event', book.bookId, null);
}

/**
 * The currency of a shared event is chosen once, when it is shared (the Share sheet). Once this phone holds the event's
 * relay book it is fixed: a change would race a second phone's expense recorded on the old currency (I1) and the first
 * expense only widens that. The log still strips a late change on every phone (`noteEventLogTx`); this says so first.
 */
export async function setSharedEventCurrency(database: Database, ws: WorkspaceContext, eventId: string, currency: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    if (!isSupportedCurrency(currency)) throw invalid(`Unsupported currency ${currency}`);
    const [shared] = await tx.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${book.bookId} LIMIT 1`);
    if (shared) throw invalid(`${book.name}'s currency is set when it is shared`);
    await writeEventTx(tx, book, sql`currency = ${currency}`);
  });
}

export async function finishSharedEvent(database: Database, ws: WorkspaceContext, eventId: string, finished: boolean): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId, true);
    await writeEventTx(tx, book, sql`finished_at = ${finished ? new Date().toISOString() : null}`);
  });
}

export async function saveEventCategory(database: Database, ws: WorkspaceContext, eventId: string, input: { id?: string; name: string; icon?: string | null }): Promise<string> {
  const id = input.id ?? uuidv7();
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    const name = input.name.trim();
    if (!name) throw invalid('Enter a name');
    await withCapture(tx, { entity: 'event_category', id, bookId: book.bookId }, () =>
      tx.run(sql`
        INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at)
        VALUES (${book.bookId}, ${id}, ${name}, ${input.icon ?? null}, (SELECT coalesce(max(sort_order), 0) + 1 FROM event_categories WHERE book_id = ${book.bookId}), NULL)
        ON CONFLICT (book_id, id) DO UPDATE SET name = excluded.name, icon = excluded.icon`),
    );
    await followEventOpTx(tx, book.bookId, 'event_category', id, null);
    // An expense without a note is described by its category: a renamed category renames it.
    for (const { kind, recordId } of await recordsReadingTx(tx, book.bookId, 'event_category', id)) await postEventRecordTx(tx, book.bookId, kind, recordId, null);
  });
  return id;
}

export async function archiveEventCategory(database: Database, ws: WorkspaceContext, eventId: string, categoryId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const book = await openSharedEventTx(tx, ws, eventId);
    await withCapture(tx, { entity: 'event_category', id: categoryId, bookId: book.bookId }, () =>
      tx.run(sql`UPDATE event_categories SET archived_at = ${new Date().toISOString()} WHERE book_id = ${book.bookId} AND id = ${categoryId}`),
    );
  });
}
