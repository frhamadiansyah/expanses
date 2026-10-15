import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  createAccount,
  editSharedExpense,
  eventBalanceRows,
  eventBookTx,
  finishSharedEvent,
  guessCategoryFromHistory,
  openEventBookTx,
  ownerScope,
  personRefusalTx,
  postEventRecordTx,
  recordSharedExpense,
  saveEvent,
  sharedEventPlan,
  sharedEventView,
  takeOverRecords,
  upsertRate,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Final review fixes on reading a shared event (I2, C17, the Debts row, M3, M7, E2E-1). Rina's phone in a lira week;
 * Rina and Andi have the app, Budi does not. Invented rates: 1 EUR = 17,000 IDR, 1 TRY = 560 IDR.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function liraWeek(rates = true) {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  if (rates) {
    for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
      await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
    }
  }
  const bank = await createAccount(t.database, ws, { name: 'Rina Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const lira = await createAccount(t.database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' });
  const eventId = await saveEvent(t.database, ws, { name: 'Lira week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Lira week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES
      ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-book', 'p-budi', 'Budi', NULL, NULL);
  `);
  await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Lira week', currency: 'TRY' }));
  /** A peer's expense as it arrived, raw, then followed on this phone. */
  const arrived = async (id: string, row: { amount: number; rate?: string; currency?: string; payer?: string; member?: string | null; mode?: string; split: string }) => {
    await t.database.execScript(`
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES ('ev-book', '${id}', '2026-10-07', ${row.amount}, '${row.currency ?? 'TRY'}', '${row.rate ?? '1'}', '${row.payer ?? 'p-andi'}', ${row.member === null ? 'NULL' : `'${row.member ?? row.payer ?? 'p-andi'}'`}, NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES ('ev-book', '${id}', 'Dinner ${id}', 'cat-dinners', '${row.mode ?? 'equal'}', '${row.split}', 'p-andi', NULL);
    `);
    await t.database.transaction((tx) => postEventRecordTx(tx, 'ev-book', 'expense', id, 'p-andi'));
  };
  const view = async () => (await sharedEventView(t.database, ws, eventId))!;
  const book = async () => (await eventBookTx(t.database.db, 'ev-book'))!;
  return { ...t, ws, bank, lira, eventId, arrived, view, book };
}

describe('a record that cannot be added up (I2, C17)', () => {
  it('a by-amount split that no longer adds up to the amount is shown to be fixed, counted nowhere, and breaks nothing else', async () => {
    const t = await liraWeek();
    await t.arrived('good', { amount: 60_000, split: '["p-rina","p-andi"]' });
    // Andi's split (adds to 100,000) raced Andi's own new amount (120,000): both legal, together unreadable.
    await t.arrived('raced', { amount: 120_000, mode: 'amounts', split: JSON.stringify([{ personId: 'p-rina', minor: 50_000 }, { personId: 'p-andi', minor: 50_000 }]) });
    const view = await t.view();
    const raced = view.expenses.find((e) => e.expenseId === 'raced')!;
    expect(raced.unreadable).toBe('The shares add up to 100000, the expense is 120000');
    expect(raced).toMatchObject({ eventAmountMinor: 0, myShareEventMinor: 0, payerOnly: true });
    expect(view.expenses.find((e) => e.expenseId === 'good')!.unreadable).toBeNull();
    expect(view.unreadable).toEqual([{ recordId: 'raced', reason: 'The shares add up to 100000, the expense is 120000' }]);
    expect(view.spentMinor).toBe(60_000);
    expect(view.people.find((p) => p.isMe)!.balanceMinor).toBe(-30_000);
    expect(view.payments).toEqual([{ fromPersonId: 'p-rina', fromName: 'Rina', toPersonId: 'p-andi', toName: 'Andi', amountMinor: 30_000 }]);
    // The Debts page, the plan, Leave and Remove read on.
    expect(await eventBalanceRows(t.database, t.ws)).toMatchObject([{ name: 'Lira week', balanceMinor: -30_000 }]);
    expect(await sharedEventPlan(t.database, t.ws, t.eventId)).not.toBeNull();
    expect(await personRefusalTx(t.database.db, await t.book(), 'p-rina')).toMatchObject({ code: 'NOT_SETTLED', message: expect.stringContaining('Rina') });
    expect(await personRefusalTx(t.database.db, await t.book(), 'p-budi')).toBeNull();
  });

  it('a split that cannot be read at all, or a rate that is not one, is listed with why; the split is fixed by giving it one', async () => {
    const t = await liraWeek();
    await t.arrived('garbled', { amount: 30_000, payer: 'p-budi', member: null, split: 'not a split' });
    await t.arrived('bad-rate', { amount: 9_000, currency: 'EUR', rate: 'many', split: '["p-rina","p-andi"]' });
    const view = await t.view();
    expect(view.expenses.map((e) => [e.expenseId, e.unreadable, e.splitText])).toEqual([
      ['bad-rate', '"many" is not a rate', 'Equal · 2 people'],
      ['garbled', 'The split is not readable', 'Split not readable'],
    ]);
    expect(view.spentMinor).toBe(0);
    // Nobody's balance is known while a split cannot be read: no one leaves or is removed over it.
    expect(await personRefusalTx(t.database.db, await t.book(), 'p-budi')).toMatchObject({ code: 'NOT_SETTLED' });
    // Budi's record was paid outside the app: anyone fixes it, here by giving it a split.
    await editSharedExpense(t.database, t.ws, t.eventId, 'garbled', { split: { mode: 'equal', people: ['p-rina', 'p-budi'] } });
    const fixed = (await t.view()).expenses.find((e) => e.expenseId === 'garbled')!;
    expect(fixed.unreadable).toBeNull();
    expect(fixed.myShareEventMinor).toBe(15_000);
  });
});

describe('the Debts page’s trip row', () => {
  it('reads the balance and the payments from the records alike, and says what is not in the books yet', async () => {
    const t = await liraWeek();
    // Rina's taxi, recorded for her on Andi's stale view: hers, but not in her books until she takes it over (R6).
    await t.arrived('taxi', { amount: 40_000, payer: 'p-rina', member: null, split: '["p-rina","p-andi"]' });
    expect((await t.view()).waiting).toEqual([{ recordId: 'taxi', kind: 'expense', reason: 'choose-account' }]);
    // Before: the trip-balance account (nothing posted, 0) beside "Andi pays Rina ₺200".
    expect(await eventBalanceRows(t.database, t.ws)).toEqual([
      { eventId: t.eventId, name: 'Lira week', currency: 'TRY', balanceMinor: 20_000, waitingCount: 1, payments: [{ fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 20_000 }] },
    ]);
  });
});

describe('taking over on a Done event (M3)', () => {
  it('a payment named for Rina goes into her books after the event is Done, without reopening it', async () => {
    const t = await liraWeek();
    await t.arrived('taxi', { amount: 40_000, payer: 'p-rina', member: null, split: '["p-rina","p-andi"]' });
    await finishSharedEvent(t.database, t.ws, t.eventId, true);
    await takeOverRecords(t.database, t.ws, t.eventId, { accountId: t.lira.id, recordIds: ['taxi'] });
    const view = await t.view();
    expect(view.finishedAt).not.toBeNull();
    expect(view.waiting).toEqual([]);
    expect(view.expenses[0]!.payerHasAccount).toBe(true);
  });
});

describe('share categories when no workspace is open (M7)', () => {
  it('are never guessed for a note, nor listed on the budget sheet', async () => {
    const t = await liraWeek();
    await recordSharedExpense(t.database, t.ws, t.eventId, {
      occurredOn: '2026-10-06', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: 'p-rina', paidFrom: { accountId: t.lira.id, chargedMinor: null },
      split: { mode: 'equal', people: ['p-rina', 'p-andi'] }, categoryId: 'cat-dinners', note: 'Harbour fish dinner',
    });
    const [[share]] = (await t.database.db.values<[string]>(sql`SELECT account_id FROM event_category_accounts`)) as [[string]];
    expect(t.ws.bookId).toBeUndefined();
    expect(await guessCategoryFromHistory(t.database, t.ws, 'Harbour fish dinner')).not.toBe(share);
    expect((await budgetSheetFor(t.database, t.ws, '2026-10')).lines.map((l) => l.id)).not.toContain(share);
  });
});

describe('a record saved offline on the recording phone (E2E-1)', () => {
  it('is on the page at once: "Not sent yet", waiting for a rate, and counted in the header', async () => {
    const t = await liraWeek(false);
    const boat = await recordSharedExpense(t.database, t.ws, t.eventId, {
      occurredOn: '2026-10-08', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: 'p-rina', paidFrom: { accountId: t.bank.id, chargedMinor: 336_000 },
      split: { mode: 'equal', people: ['p-rina', 'p-andi'] }, categoryId: null, note: 'Boat',
    });
    const view = await t.view();
    expect(view.expenses.map((e) => [e.expenseId, e.unsent, e.posting?.unposted, e.unreadable])).toEqual([[boat, true, 'no-rate', null]]);
    expect(view).toMatchObject({ spentMinor: 60_000, myShareMinor: 30_000 });
  });
});
