import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  eventBalanceRows,
  initialsOf,
  linkSharedItem,
  openEventBookTx,
  ownerScope,
  recordSettlement,
  recordSharedExpense,
  saveEvent,
  saveSharedItem,
  sharedEventPlan,
  sharedEventSummaries,
  sharedEventView,
  splitText,
  upsertRate,
  voidSharedExpense,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { clearOutbox, shareBookForTest } from './sync/sync-helpers';

/*
 * Reading a shared event (shared events §6, §7): what the event page, the events list and the Debts page show. Rina's
 * phone; Rina and Andi have the app, Budi and Dewi do not. Invented rates: 1 EUR = 17,000 IDR, 1 TRY = 560 IDR.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function coastWeek() {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
    await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
  }
  const wallet = await createAccount(t.database, ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
  const lira = await createAccount(t.database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' });
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES
      ('ev-book', 'p-rina', 'Rina Sari', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL),
      ('ev-book', 'p-budi', 'Budi', NULL, NULL), ('ev-book', 'p-dewi', 'Dewi', NULL, NULL);
  `);
  await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  // Rina paid €90 for three; Budi paid 1,800 lira for Rina and Budi; Andi's boat (recorded on Andi's phone, here raw).
  await recordSharedExpense(t.database, ws, eventId, {
    occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', payerPersonId: 'p-rina', paidFrom: { accountId: wallet.id, chargedMinor: null },
    split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] }, categoryId: 'cat-dinners', note: 'Fish dinner',
  });
  await recordSharedExpense(t.database, ws, eventId, {
    occurredOn: '2026-10-07', amountMinor: 180_000, currency: 'TRY', rateToEvent: '1', payerPersonId: 'p-budi', paidFrom: null,
    split: { mode: 'equal', people: ['p-rina', 'p-budi'] }, categoryId: null, note: 'Market',
  });
  await t.database.execScript(`
    INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at) VALUES ('ev-book', 'exp-boat', '2026-10-08', 60000, 'TRY', '1', 'p-andi', 'p-andi', NULL);
    INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by) VALUES ('ev-book', 'exp-boat', 'Boat', NULL, 'equal', '["p-andi","p-dewi"]', 'p-andi', NULL);
  `);
  return { ...t, ws, wallet, lira, eventId };
}

describe('sharedEventView', () => {
  it('reads the header, each row and each person’s balance in the event currency', async () => {
    const t = await coastWeek();
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.currency).toBe('TRY');
    expect(view.myName).toBe('Rina Sari');
    // Spent: 283,500 (€90) + 180,000 + 60,000; Rina's share: 94,500 + 90,000.
    expect(view.spentMinor).toBe(523_500);
    expect(view.myShareMinor).toBe(184_500);
    const dinner = view.expenses.find((e) => e.note === 'Fish dinner')!;
    expect(dinner).toMatchObject({ payerName: 'Rina Sari', payerHasAccount: true, splitText: 'Equal · 3 people', myShareMinor: 3_000, myShareEventMinor: 94_500, eventAmountMinor: 283_500, categoryName: 'Dinners', unsent: true, payerOnly: false });
    expect(view.expenses.find((e) => e.expenseId === 'exp-boat')).toMatchObject({ payerOnly: true, myShareMinor: 0, unsent: false });
    expect(Object.fromEntries(view.people.map((p) => [p.name, p.balanceMinor]))).toEqual({ 'Rina Sari': 99_000, Andi: -64_500, Budi: -4_500, Dewi: -30_000 });
    expect(view.people.find((p) => p.isMe)?.initials).toBe('RS');
  });

  it('suggests the fewest payments, by name, and the same list however it is asked', async () => {
    const t = await coastWeek();
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.payments).toEqual([
      { fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina Sari', amountMinor: 64_500 },
      { fromPersonId: 'p-dewi', fromName: 'Dewi', toPersonId: 'p-rina', toName: 'Rina Sari', amountMinor: 30_000 },
      { fromPersonId: 'p-budi', fromName: 'Budi', toPersonId: 'p-rina', toName: 'Rina Sari', amountMinor: 4_500 },
    ]);
  });

  it('says a record is not sent while it waits in the outbox, and what waits for an account', async () => {
    const t = await coastWeek();
    await clearOutbox(t.database);
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.expenses.every((e) => !e.unsent)).toBe(true);
    expect(view.waiting).toEqual([]);
    expect(view.currencyLocked).toBe(true);
  });

  it('is null for an event that is not shared', async () => {
    const t = await coastWeek();
    const other = await saveEvent(t.database, t.ws, { name: 'Hill weekend', startsOn: '2026-11-01', endsOn: '2026-11-02' });
    expect(await sharedEventView(t.database, t.ws, other)).toBeNull();
  });
});

describe('the events list and the Debts page', () => {
  it('names the people an event is shared with', async () => {
    const t = await coastWeek();
    expect((await sharedEventSummaries(t.database, t.ws))[t.eventId]).toEqual({
      eventId: t.eventId,
      sharedWith: 3,
      people: [
        { name: 'Andi', initials: 'A' },
        { name: 'Budi', initials: 'B' },
        { name: 'Dewi', initials: 'D' },
      ],
    });
  });

  it('shows the trip balance and the payments that involve this person; a settle-up moves both', async () => {
    const t = await coastWeek();
    const [row] = await eventBalanceRows(t.database, t.ws);
    expect(row).toMatchObject({ eventId: t.eventId, name: 'Coast week', currency: 'TRY' });
    expect(row!.balanceMinor).toBe(94_500 + 94_500 - 90_000); // the others' share of the dinner, less Rina's half of the market
    expect(row!.payments.map((p) => `${p.fromName}→${p.toName} ${p.amountMinor}`)).toEqual(['Andi→Rina Sari 64500', 'Dewi→Rina Sari 30000', 'Budi→Rina Sari 4500']);
    await recordSettlement(t.database, t.ws, t.eventId, { occurredOn: '2026-10-12', fromPersonId: 'p-budi', toPersonId: 'p-rina', amountMinor: 4_500, account: { accountId: t.lira.id, amountMinor: null } });
    const [after] = await eventBalanceRows(t.database, t.ws);
    expect(after!.payments.map((p) => p.fromName)).toEqual(['Andi', 'Dewi']);
  });
});

describe('the shared plan (D7)', () => {
  it('an item answered by an expense is bought at its share; a void puts it back on the list', async () => {
    const t = await coastWeek();
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    const dinner = view.expenses.find((e) => e.note === 'Fish dinner')!;
    const item = await saveSharedItem(t.database, t.ws, t.eventId, { name: 'Fish dinner', quantity: 1, unitPriceMinor: 250_000, categoryId: 'cat-dinners', link: null, note: null });
    await linkSharedItem(t.database, t.ws, t.eventId, item, { expenseId: dinner.expenseId, shareMinor: 283_500 });
    const plan = (await sharedEventPlan(t.database, t.ws, t.eventId))!;
    expect(plan.lines.flatMap((l) => l.items)).toEqual([expect.objectContaining({ name: 'Fish dinner', bought: true, actualMinor: 283_500, differenceMinor: 33_500 })]);
    await voidSharedExpense(t.database, t.ws, t.eventId, dinner.expenseId);
    const after = (await sharedEventPlan(t.database, t.ws, t.eventId))!;
    expect(after.lines.flatMap((l) => l.items)).toEqual([expect.objectContaining({ name: 'Fish dinner', bought: false })]);
  });
});

describe('words', () => {
  it('makes initials and split text', () => {
    expect(initialsOf('Rina Sari')).toBe('RS');
    expect(initialsOf('  andi ')).toBe('A');
    expect(splitText({ mode: 'equal', people: ['a', 'b', 'c'] })).toBe('Equal · 3 people');
    expect(splitText({ mode: 'amounts', shares: [{ personId: 'a', minor: 1 }] })).toBe('By amount · 1 person');
  });
});
