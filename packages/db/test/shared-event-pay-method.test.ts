import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addCard,
  cardSpendLines,
  cardStatementLines,
  createAccount,
  createCardAccount,
  editSharedExpense,
  nativeBalances,
  openEventBookTx,
  ownerScope,
  recordSharedExpense,
  saveCardTerms,
  saveEvent,
  sharedEventView,
  upsertRate,
  type SharedExpenseInput,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { installCaptureTriggers, uncapturedWrites } from './sync/capture-harness';
import { outboxOps, shareBookForTest } from './sync/sync-helpers';

/*
 * Owner, 22 Nov 2026: an expense this phone's person paid in a shared event takes another Payment method on edit, as
 * any other field. The account (and card) is this phone's own (R5): the payment moves off the old account onto the new
 * one once, and nothing in the shared records — what every other phone reads — changes.
 *
 * A rupiah weekend; Rina's phone. Invented figures: 1 EUR = 17,500 IDR; 1 TRY = 545 IDR.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function weekend() {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  for (const [from, rate] of [['EUR', 17_500], ['TRY', 545]] as const) {
    await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-08-01', rate, source: 'manual', sourceDate: '2026-08-01' });
  }
  const bank = await createAccount(t.database, ws, { name: 'Daily bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const euros = await createAccount(t.database, ws, { name: 'Euro cash', kind: 'asset', subtype: 'cash', currency: 'EUR' });
  const cardA = await createCardAccount(t.database, ws, { name: 'Blue card', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  const cardB = await createCardAccount(t.database, ws, { name: 'Green card', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  for (const card of [cardA, cardB]) await saveCardTerms(t.database, ws, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
  const eventId = await saveEvent(t.database, ws, { name: 'Hill weekend', startsOn: '2026-08-14', endsOn: '2026-08-16' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Hill weekend', '2026-08-14', '2026-08-16', 'IDR', NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-stay', 'Stay', NULL, 0, NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-book', 'p-budi', 'Budi', NULL, NULL);
  `);
  const trip = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Hill weekend', currency: 'IDR' }));
  await installCaptureTriggers(t.database, 'ev-book');
  const stay = (over: Partial<SharedExpenseInput> = {}): SharedExpenseInput => ({
    occurredOn: '2026-08-15',
    amountMinor: 1_350_000,
    currency: 'IDR',
    rateToEvent: '1',
    payerPersonId: 'p-rina',
    paidFrom: { accountId: cardA.id, chargedMinor: null },
    split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] },
    categoryId: 'cat-stay',
    note: 'Villa',
    ...over,
  });
  const balanceOf = async (id: string) => (await nativeBalances(t.database, ws))[id] ?? 0;
  const view = async () => (await sharedEventView(t.database, ws, eventId))!;
  const livePosted = async () =>
    t.database.db.values<[string, string, string | null]>(sql`
      SELECT x.id, e.account_id, x.card_id FROM transactions x JOIN entries e ON e.transaction_id = x.id
      WHERE x.status = 'posted' AND x.event_id = ${eventId} AND e.account_id IN (${bank.id}, ${euros.id}, ${cardA.id}, ${cardB.id})`);
  // What a card's points are worked out from (the whole charge, R12).
  const earning = async (cardId: string) => (await cardSpendLines(t.database, ws, cardId, '2026-08-01', '2026-08-31')).map((line) => line.amountMinor);
  const onStatement = async (cardId: string) => (await cardStatementLines(t.database, ws, cardId)).map((line) => [line.description, line.owedMinor, line.cardId]);
  return { ...t, ws, bank, euros, cardA, cardB, eventId, trip, stay, balanceOf, view, livePosted, earning, onStatement };
}

describe('editSharedExpense: another Payment method for what this person paid', () => {
  it('moves the payment off card A onto card B once: A back to nothing, B charged, the statement line moved, nothing sent', async () => {
    const t = await weekend();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.stay());
    const before = await t.view();
    const sent = (await outboxOps(t.database)).length;
    expect(await t.balanceOf(t.cardA.id)).toBe(-1_350_000);
    expect(await t.onStatement(t.cardA.id)).toEqual([['Villa', 1_350_000, null]]);
    expect(await t.earning(t.cardA.id)).toEqual([1_350_000]);

    await editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.cardB.id, cardId: null } });

    expect(await t.balanceOf(t.cardA.id)).toBe(0);
    expect(await t.balanceOf(t.cardB.id)).toBe(-1_350_000);
    expect(await t.onStatement(t.cardA.id)).toEqual([]);
    expect(await t.onStatement(t.cardB.id)).toEqual([['Villa', 1_350_000, null]]);
    expect(await t.earning(t.cardA.id)).toEqual([]);
    expect(await t.earning(t.cardB.id)).toEqual([1_350_000]);
    // One live transaction, on B alone: no double count, no orphan.
    expect((await t.livePosted()).map(([, account]) => account)).toEqual([t.cardB.id]);
    // The event as every phone reads it: the same expense, the same totals and the same who-owes-whom.
    const after = await t.view();
    expect(after.expenses.map((e) => [e.expenseId, e.amountMinor, e.eventAmountMinor, e.split])).toEqual(before.expenses.map((e) => [e.expenseId, e.amountMinor, e.eventAmountMinor, e.split]));
    expect(Object.fromEntries(after.people.map((p) => [p.personId, p.balanceMinor]))).toEqual({ 'p-rina': 900_000, 'p-andi': -450_000, 'p-budi': -450_000 });
    expect(after.people).toEqual(before.people);
    expect(after.payments).toEqual(before.payments);
    expect([after.spentMinor, after.myShareMinor]).toEqual([before.spentMinor, before.myShareMinor]);
    expect(after.expenses[0]!.posting?.accountId).toBe(t.cardB.id);
    expect(await t.balanceOf(t.trip)).toBe(900_000);
    // Local only (R5): no op for the shared records, and none written behind capture's back.
    expect((await outboxOps(t.database)).length).toBe(sent);
    expect(await uncapturedWrites(t.database, 'ev-book')).toEqual([]);
  });

  it('moves a card purchase to a bank account and back, and onto another plastic of one card account', async () => {
    const t = await weekend();
    const second = await addCard(t.database, t.ws, { accountId: t.cardB.id, last4: '4821' });
    const third = await addCard(t.database, t.ws, { accountId: t.cardB.id, last4: '7310' });
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.stay());
    await editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.bank.id, cardId: null } });
    expect(await t.balanceOf(t.cardA.id)).toBe(0);
    expect(await t.balanceOf(t.bank.id)).toBe(-1_350_000);
    expect(await t.livePosted()).toEqual([[expect.any(String), t.bank.id, null]]);

    await editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.cardB.id, cardId: second } });
    expect(await t.balanceOf(t.bank.id)).toBe(0);
    expect(await t.livePosted()).toEqual([[expect.any(String), t.cardB.id, second]]);
    expect((await t.view()).expenses[0]!.posting?.cardId).toBe(second);

    // Same account, the other plastic: the lines are alike, the card is not.
    await editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.cardB.id, cardId: third } });
    expect(await t.livePosted()).toEqual([[expect.any(String), t.cardB.id, third]]);
    expect(await t.onStatement(t.cardB.id)).toEqual([['Villa', 1_350_000, third]]);
    expect(await t.balanceOf(t.cardB.id)).toBe(-1_350_000);
  });

  it('asks what an account in another currency was charged, as Add does, and posts that figure', async () => {
    const t = await weekend();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.stay());
    await expect(editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.euros.id, cardId: null } })).rejects.toThrow(/Euro cash was charged in EUR/);
    // Refused whole: still on card A.
    expect(await t.balanceOf(t.cardA.id)).toBe(-1_350_000);
    await editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.euros.id, cardId: null }, chargedMinor: 7_700 });
    expect(await t.balanceOf(t.cardA.id)).toBe(0);
    expect(await t.balanceOf(t.euros.id)).toBe(-7_700);
    expect((await t.view()).expenses[0]!.posting).toMatchObject({ accountId: t.euros.id, accountCurrency: 'EUR', accountAmountMinor: 7_700 });
    // Back to a rupiah account: its own figure is the expense's, and the euro figure is dropped.
    await editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.bank.id, cardId: null } });
    expect(await t.balanceOf(t.euros.id)).toBe(0);
    expect(await t.balanceOf(t.bank.id)).toBe(-1_350_000);
    expect((await t.view()).expenses[0]!.posting).toMatchObject({ accountId: t.bank.id, accountAmountMinor: null });
  });

  it('moves the payment in the same save as a new amount and note', async () => {
    const t = await weekend();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.stay());
    await editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.cardB.id, cardId: null }, amountMinor: 1_200_000, note: 'Villa, two nights' });
    expect(await t.balanceOf(t.cardA.id)).toBe(0);
    expect(await t.balanceOf(t.cardB.id)).toBe(-1_200_000);
    expect(await t.onStatement(t.cardB.id)).toEqual([['Villa, two nights', 1_200_000, null]]);
    expect(await t.balanceOf(t.trip)).toBe(800_000);
  });

  it('refuses an archived account and a payment someone else made; nothing moves', async () => {
    const t = await weekend();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.stay());
    await t.database.db.run(sql`UPDATE accounts SET archived_at = '2026-08-01T00:00:00Z' WHERE id = ${t.bank.id}`);
    await expect(editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.bank.id, cardId: null } })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(editSharedExpense(t.database, t.ws, t.eventId, id, { paidFrom: { accountId: t.trip, cardId: null } })).rejects.toMatchObject({ code: 'INVALID' });
    const budis = await recordSharedExpense(t.database, t.ws, t.eventId, t.stay({ payerPersonId: 'p-budi', paidFrom: null }));
    await expect(editSharedExpense(t.database, t.ws, t.eventId, budis, { paidFrom: { accountId: t.cardB.id, cardId: null } })).rejects.toThrow(/Only what Rina paid/);
    expect(await t.balanceOf(t.cardA.id)).toBe(-1_350_000);
    expect(await t.balanceOf(t.cardB.id)).toBe(0);
  });
});
