import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  deleteEventCopy,
  inBook,
  listAccounts,
  listEvents,
  listTransactions,
  moveIntoSharedEvent,
  nativeBalances,
  ownerScope,
  personalBook,
  postTransaction,
  recordSharedExpense,
  sharedEventSummaries,
} from '../../src/index';
import { categoryOf, type Device } from './household';
import { Trip } from './trip';

/*
 * Delete this copy (owner report 2026-11-12): the read-only copy of a shared event this phone's person is no longer in
 * comes off this phone, and nothing else changes — no balance, no workspace list, no other copy here, no other phone,
 * nothing sent. Rina shares "Coast week" with Andi; they spend so Andi's balance nets to zero (he can leave); Andi
 * also moves a purchase of his own workspace into it. Andi leaves, and later joins a second share of the same trip.
 */

const BOOK_TABLES = [
  'shared_events', 'event_people', 'event_categories', 'event_expenses', 'event_expense_details', 'event_settlements', 'event_items_shared',
  'event_log_currency', 'event_books', 'event_postings', 'event_category_accounts', 'shared_books', 'sync_outbox', 'sync_cursor',
  'book_epoch_keys', 'sync_field_clocks', 'sync_kept_clocks', 'sync_tombstones', 'sync_skipped', 'sync_authority', 'sync_authority_devices',
  'sync_invites_used', 'book_devices', 'book_members',
];

/** Every row this phone holds under one book id, table by table, and the settings keyed by it. */
async function bookRows(d: Device, bookId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of BOOK_TABLES) {
    out[table] = await d.database.db.values(sql`SELECT * FROM ${sql.raw(table)} WHERE book_id = ${bookId} ORDER BY 1, 2`);
  }
  out.settings = await d.database.db.values(sql`SELECT key, value FROM settings WHERE instr(key, ${bookId}) > 0 ORDER BY key`);
  return out;
}

/** This phone's own money: every account's balance, every transaction (posted or void) with its lines, and the workspace list. */
async function ownMoney(d: Device) {
  const book = await personalBook(d.database, d.ws);
  const ws = inBook(d.ws, book.id);
  return {
    balances: await nativeBalances(d.database, ownerScope(d.ws)),
    transactions: await d.database.db.values(sql`SELECT id, status, occurred_on, description, event_id FROM transactions ORDER BY id`),
    entries: await d.database.db.values(sql`SELECT transaction_id, account_id, amount_minor, currency, amount_base_minor FROM entries ORDER BY transaction_id, account_id, amount_minor`),
    filed: await d.database.db.values(sql`SELECT * FROM book_transactions ORDER BY 1, 2`),
    accounts: await d.database.db.values(sql`SELECT id, name, subtype, archived_at FROM accounts ORDER BY id`),
    list: (await listTransactions(d.database, ws, { limit: 500 })).map((t) => t.id).sort(),
  };
}

async function personOf(d: Device, bookId: string): Promise<string> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
  return row![0];
}

async function outboxCount(d: Device): Promise<number> {
  const [[n]] = (await d.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox`)) as [[number]];
  return Number(n);
}

/** Rina and Andi in "Coast week"; Andi's balance nets to zero, a purchase of his own moved in; then Andi leaves. */
async function leftTrip() {
  const trip = new Trip();
  const rina = await trip.device('Rina');
  const andi = await trip.device('Andi');
  const first = await trip.share(rina);
  await trip.join(andi, rina);
  await trip.settle([rina, andi]);
  const rinaP = await personOf(rina, first);
  const andiP = await personOf(andi, first);
  // Rina's lunch for both, Andi's coffee for both, alike: each owes the other 10.000 lira, so Andi is at zero.
  await recordSharedExpense(rina.database, rina.ws, trip.eventOf(rina), {
    occurredOn: '2026-10-06', amountMinor: 20_000, currency: 'TRY', rateToEvent: '1', payerPersonId: rinaP,
    paidFrom: { accountId: rina.bank, chargedMinor: 112_000 }, split: { mode: 'equal', people: [rinaP, andiP] }, categoryId: null, note: 'Lunch',
  });
  await recordSharedExpense(andi.database, andi.ws, trip.eventOf(andi), {
    occurredOn: '2026-10-07', amountMinor: 20_000, currency: 'TRY', rateToEvent: '1', payerPersonId: andiP,
    paidFrom: { accountId: andi.bank, chargedMinor: 112_000 }, split: { mode: 'equal', people: [rinaP, andiP] }, categoryId: null, note: 'Coffee',
  });
  // A purchase of Andi's own workspace moved into the trip: all his, so his balance stays at zero.
  const book = await personalBook(andi.database, andi.ws);
  const groceries = (await listAccounts(andi.database, inBook(andi.ws, book.id))).find((a) => a.kind === 'expense' && a.subtype === 'category')!;
  const towel = await postTransaction(andi.database, inBook(andi.ws, book.id), {
    occurredOn: '2026-10-08', description: 'Beach towel', lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: andi.bank, amountMinor: 150_000, currency: 'IDR' }),
  });
  const { moved } = await moveIntoSharedEvent(andi.database, andi.ws, trip.eventOf(andi), [towel]);
  expect(moved).toHaveLength(1);
  await trip.settle([rina, andi]);
  await andi.engine.leaveEvent(first);
  await trip.settle([rina]);
  return { trip, rina, andi, first, firstEvent: trip.eventOf(andi) };
}

describe('Delete this copy of a shared event this phone’s person is no longer in', () => {
  it('erases the event’s log and sync state here; every balance, transaction and workspace list stays as it was', async () => {
    const { rina, andi, first, firstEvent } = await leftTrip();
    expect(await andi.database.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${first}`)).toEqual([['unshared']]);
    const before = await ownMoney(andi);
    const posted = await andi.database.db.values<[string]>(sql`SELECT p.transaction_id FROM event_postings p JOIN transactions t ON t.id = p.transaction_id WHERE p.book_id = ${first} AND t.status = 'posted'`);
    expect(posted.length).toBe(3);
    const rinaBefore = await bookRows(rina, first);
    const outbox = await outboxCount(andi);

    const done = await deleteEventCopy(andi.database, andi.ws, first);
    expect(done).toEqual({ eventId: firstEvent, kept: 3 });

    // Andi's own money, to the row.
    expect(await ownMoney(andi)).toEqual(before);
    // The event's log and the book's sync state are gone; the postings, share categories and hold stay.
    const after = await bookRows(andi, first);
    for (const table of BOOK_TABLES.filter((t) => !['event_books', 'event_postings', 'event_category_accounts'].includes(t))) expect([table, after[table]]).toEqual([table, []]);
    expect(after.event_postings!.length).toBeGreaterThanOrEqual(3);
    expect(after.event_category_accounts!.length).toBeGreaterThan(0);
    expect(after.event_books).toHaveLength(1);
    expect(after.settings!.map((row) => (row as string[])[0])).toEqual([`shared-events.copy-member.${first}`]);
    // Off the Events list and the shared summaries; nothing waits to be sent; Rina's phone holds exactly what it did.
    expect((await listEvents(andi.database, andi.ws)).map((e) => e.id)).not.toContain(firstEvent);
    expect(await sharedEventSummaries(andi.database, andi.ws)).toEqual({});
    expect(await outboxCount(andi)).toBe(outbox);
    expect(await andi.database.db.values(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${first}`)).toEqual([[0]]);
    await rina.engine.syncOnce(first);
    expect(await bookRows(rina, first)).toEqual(rinaBefore);
  });

  it('a second, active share of the trip on the same phone is untouched, and is refused: it is left, not deleted', async () => {
    const { trip, rina, andi, first } = await leftTrip();
    const second = await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const rinaP = await personOf(rina, second);
    const andiP = await personOf(andi, second);
    await recordSharedExpense(rina.database, rina.ws, trip.eventOf(rina), {
      occurredOn: '2026-10-09', amountMinor: 30_000, currency: 'TRY', rateToEvent: '1', payerPersonId: rinaP,
      paidFrom: { accountId: rina.bank, chargedMinor: 168_000 }, split: { mode: 'equal', people: [rinaP, andiP] }, categoryId: null, note: 'Ferry',
    });
    await trip.settle([rina, andi]);
    const live = await bookRows(andi, second);
    expect(live.event_expenses).toHaveLength(1);
    const money = await ownMoney(andi);

    await expect(deleteEventCopy(andi.database, andi.ws, second)).rejects.toMatchObject({ code: 'STILL_SHARED' });
    expect(await bookRows(andi, second)).toEqual(live);

    await deleteEventCopy(andi.database, andi.ws, first);
    expect(await bookRows(andi, second)).toEqual(live);
    expect(await ownMoney(andi)).toEqual(money);
    expect((await listEvents(andi.database, andi.ws)).map((e) => e.id)).toEqual([trip.eventOf(andi)]);
    // The live copy still syncs after the delete.
    await recordSharedExpense(rina.database, rina.ws, trip.eventOf(rina), {
      occurredOn: '2026-10-10', amountMinor: 4_000, currency: 'TRY', rateToEvent: '1', payerPersonId: rinaP,
      paidFrom: { accountId: rina.bank, chargedMinor: 22_400 }, split: { mode: 'equal', people: [rinaP, andiP] }, categoryId: null, note: 'Tea',
    });
    await trip.settle([rina, andi]);
    expect(await andi.database.db.values(sql`SELECT count(*) FROM event_expenses WHERE book_id = ${second}`)).toEqual([[2]]);
  });

  it('refuses a book this phone holds no event for, changing nothing', async () => {
    const { andi } = await leftTrip();
    const money = await ownMoney(andi);
    await expect(deleteEventCopy(andi.database, andi.ws, 'no-such-book')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await ownMoney(andi)).toEqual(money);
  });

  it('invited back to the same event as the same person, the kept transactions are followed — never posted twice', async () => {
    const { trip, rina, andi, first, firstEvent } = await leftTrip();
    const andiP = await personOf(rina, first).then(async () => (await andi.database.db.values<[string]>(sql`SELECT id FROM event_people WHERE book_id = ${first} AND member_id IS NOT NULL AND name = 'Andi'`))[0]![0]);
    await deleteEventCopy(andi.database, andi.ws, first);
    const money = await ownMoney(andi);
    trip.bookId = first;
    const { code } = await rina.engine.createEventInvite(first, { inviterName: 'Rina', forPersonId: andiP });
    await trip.join(andi, rina, null, code);
    await trip.settle([rina, andi]);
    expect(trip.eventOf(andi)).toBe(firstEvent);
    expect((await listEvents(andi.database, andi.ws)).map((e) => e.id)).toContain(firstEvent);
    const after = await ownMoney(andi);
    expect(after.balances).toEqual(money.balances);
    expect(after.list).toEqual(money.list);
    expect(after.transactions.filter((t) => (t as string[])[1] === 'posted')).toEqual(money.transactions.filter((t) => (t as string[])[1] === 'posted'));
  });

  it('an invite back as someone else is refused: the kept transactions are never re-read as another person’s', async () => {
    const { trip, rina, andi, first } = await leftTrip();
    await deleteEventCopy(andi.database, andi.ws, first);
    const money = await ownMoney(andi);
    trip.bookId = first;
    const { code } = await rina.engine.createEventInvite(first, { inviterName: 'Rina' });
    await expect(trip.join(andi, rina, null, code)).rejects.toMatchObject({ code: 'INVITE_MISMATCH' });
    expect(await ownMoney(andi)).toEqual(money);
  });
});

/*
 * Coordinator's question (2026-11-12, Family mismatch): what leaving and deleting do to a purchase of a shared
 * workspace (Family) that was moved into the event. Rina shares Family with Andi; Andi spends in Family and moves one
 * purchase into the trip. Moving it is what takes it out of Family, on both phones alike (a Family void, through
 * Family's own log); leaving the trip and deleting its copy hand nothing back to Family and send nothing to it.
 */
describe('a Family purchase moved into the trip, then the trip left and its copy deleted', () => {
  it('Family lists the same on both phones at every step, and neither leave nor delete writes to Family’s outbox', async () => {
    const trip = new Trip();
    const rina = await trip.device('Rina');
    const andi = await trip.device('Andi');
    const family = await trip.home.share(rina);
    await trip.home.join(andi, rina);
    await trip.home.settle([rina, andi]);
    const familyWs = (d: Device) => inBook(d.ws, family);
    const category = { id: await categoryOf(andi.database, family, 'Groceries') };
    const purchase = (description: string, amountMinor: number) =>
      postTransaction(andi.database, familyWs(andi), { occurredOn: '2026-10-08', description, lines: expenseLines({ categoryAccountId: category.id, paymentAccountId: andi.bank, amountMinor, currency: 'IDR' }) });
    const sunscreen = await purchase('Sunscreen', 90_000);
    await purchase('Groceries', 210_000);
    await trip.home.settle([rina, andi]);
    const familyList = async (d: Device) => (await listTransactions(d.database, familyWs(d), { limit: 500 })).map((t) => `${t.occurredOn} ${t.description}`).sort();
    expect(await familyList(rina)).toEqual(await familyList(andi));
    expect(await familyList(andi)).toEqual(['2026-10-08 Groceries', '2026-10-08 Sunscreen']);

    const first = await trip.share(rina);
    await trip.join(andi, rina);
    await trip.settle([rina, andi]);
    const { moved } = await moveIntoSharedEvent(andi.database, andi.ws, trip.eventOf(andi), [sunscreen]);
    expect(moved).toHaveLength(1);
    await trip.settle([rina, andi]);
    trip.bookId = first;
    trip.home.bookId = family;
    await trip.home.settle([rina, andi]);
    // The move took it out of Family on both phones, through Family's own log.
    expect(await familyList(andi)).toEqual(['2026-10-08 Groceries']);
    expect(await familyList(rina)).toEqual(['2026-10-08 Groceries']);

    const familyOutbox = async () => Number((await andi.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${family}`))[0]![0]);
    const money = await ownMoney(andi);
    await andi.engine.leaveEvent(first);
    expect(await familyOutbox()).toBe(0);
    expect(await ownMoney(andi)).toEqual(money);
    await deleteEventCopy(andi.database, andi.ws, first);
    expect(await familyOutbox()).toBe(0);
    expect(await ownMoney(andi)).toEqual(money);
    await trip.home.settle([rina, andi]);
    expect(await familyList(andi)).toEqual(['2026-10-08 Groceries']);
    expect(await familyList(rina)).toEqual(['2026-10-08 Groceries']);
  });
});
