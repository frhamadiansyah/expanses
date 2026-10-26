import { expenseLines, refundLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  editSharedExpense,
  inBook,
  listAccounts,
  listTransactions,
  moveIntoSharedEvent,
  openEventBookTx,
  ownerScope,
  personalBook,
  postTransaction,
  recordSharedExpense,
  saveEvent,
  sharedEventView,
  upsertRate,
  voidSharedExpense,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * A refund back to a card for a purchase of a shared event moves into the event as an expense below zero (invented
 * figures, one event currency): the event total and the shares fall, the card is credited, the partner's figures follow.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function holiday() {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  const book = await personalBook(t.database, t.ws);
  const inPersonal = inBook(t.ws, book.id);
  await upsertRate(t.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-10-01', rate: 560, source: 'manual', sourceDate: '2026-10-01' });
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-budi', 'Budi', NULL, NULL);
  `);
  await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  const card = await createAccount(t.database, t.ws, { name: 'Travel card', kind: 'liability', subtype: 'credit_card', currency: 'TRY' });
  const dining = (await listAccounts(t.database, inPersonal)).find((a) => a.name === 'Restaurants')!;
  const buy = (amountMinor: number, split: Parameters<typeof recordSharedExpense>[3]['split'], note = 'Harbour grill') =>
    recordSharedExpense(t.database, ws, eventId, {
      occurredOn: '2026-10-06', amountMinor, currency: 'TRY', rateToEvent: '1', payerPersonId: 'p-rina', paidFrom: { accountId: card.id, chargedMinor: null },
      split, categoryId: null, note,
    });
  const refund = (amountMinor: number, description = 'Refund · Harbour grill') =>
    postTransaction(t.database, inPersonal, { occurredOn: '2026-10-09', description, lines: refundLines({ categoryAccountId: dining.id, paymentAccountId: card.id, amountMinor, currency: 'TRY' }), ratesToBase: { TRY: 560 } });
  return { ...t, ws, inPersonal, eventId, card, dining, buy, refund };
}

const equal3 = { mode: 'equal' as const, people: ['p-rina', 'p-andi', 'p-budi'] };

describe('refunds in a shared event', () => {
  it('moves a refund in as a record below zero shared as the purchase was, and credits the card', async () => {
    const t = await holiday();
    await t.buy(90_000, equal3);
    const before = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(before.spentMinor).toBe(90_000);
    const refund = await t.refund(30_000);
    const { moved, kept } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [refund]);
    expect(kept).toEqual([]);
    expect(moved).toHaveLength(1);
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    // The total, the count of rows and this person's share all follow; the refund is its own row below zero.
    expect(view.expenses).toHaveLength(2);
    expect(view.spentMinor).toBe(60_000);
    expect(view.myShareMinor).toBe(20_000);
    const row = view.expenses.find((e) => e.expenseId === moved[0]!.expenseId)!;
    expect(row).toMatchObject({ amountMinor: -30_000, eventAmountMinor: -30_000, myShareMinor: -10_000, unreadable: null, note: 'Refund · Harbour grill' });
    expect(row.split).toEqual({ mode: 'amounts', shares: [{ personId: 'p-rina', minor: -10_000 }, { personId: 'p-andi', minor: -10_000 }, { personId: 'p-budi', minor: -10_000 }] });
    // Balances: Rina is owed what the others owe of the net 60,000, and the suggestions settle them.
    expect(view.people.map((p) => [p.personId, p.balanceMinor])).toEqual([['p-andi', -20_000], ['p-budi', -20_000], ['p-rina', 40_000]]);
    expect(view.people.reduce((s, p) => s + p.balanceMinor, 0)).toBe(0);
    expect(view.payments.reduce((s, p) => s + p.amountMinor, 0)).toBe(40_000);
    // The card on this phone is owed 60,000 net: the purchase's charge less the refund, in one derived row each.
    const onCard = await listTransactions(t.database, t.ws, { accountId: t.card.id });
    expect(onCard).toHaveLength(2);
    const card = await t.database.db.values<[number]>(sql`SELECT sum(e.amount_minor) FROM entries e JOIN transactions x ON x.id = e.transaction_id WHERE e.account_id = ${t.card.id} AND x.status = 'posted'`);
    expect(Number(card[0]![0])).toBe(-60_000);
    expect((await listTransactions(t.database, t.inPersonal)).map((v) => v.description)).not.toContain('Refund · Harbour grill');
  });

  it('is idempotent: moving the same refund again moves nothing and leaves one record', async () => {
    const t = await holiday();
    await t.buy(90_000, equal3);
    const refund = await t.refund(30_000);
    await moveIntoSharedEvent(t.database, t.ws, t.eventId, [refund]);
    const again = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [refund]);
    expect(again.moved).toEqual([]);
    expect(again.kept).toHaveLength(1);
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.expenses).toHaveLength(2);
    expect(view.spentMinor).toBe(60_000);
  });

  it('a refund of nothing recognisable is shared by its recorder alone', async () => {
    const t = await holiday();
    await t.buy(90_000, equal3, 'Harbour grill');
    await t.buy(90_000, equal3, 'Museum');
    const refund = await t.refund(5_000, 'Something else');
    const { moved } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [refund]);
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    const row = view.expenses.find((e) => e.expenseId === moved[0]!.expenseId)!;
    expect(row.myShareMinor).toBe(-5_000);
    expect(view.spentMinor).toBe(175_000);
  });

  it('a refund names its purchase outright, and an uneven split is shared back in proportion', async () => {
    const t = await holiday();
    const first = await t.buy(100_000, { mode: 'amounts', shares: [{ personId: 'p-rina', minor: 50_000 }, { personId: 'p-andi', minor: 30_000 }, { personId: 'p-budi', minor: 20_000 }] }, 'Dinner');
    await t.buy(100_000, equal3, 'Dinner');
    const refund = await t.refund(33_333, 'Dinner refund');
    const { moved } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [refund], { [refund]: first });
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    const row = view.expenses.find((e) => e.expenseId === moved[0]!.expenseId)!;
    expect(row.split.mode === 'amounts' && row.split.shares.reduce((s, x) => s + x.minor, 0)).toBe(-33_333);
    expect(row.split.mode === 'amounts' && row.split.shares.map((x) => x.minor)).toEqual([-16_666, -10_000, -6_667]);
    expect(view.people.reduce((s, p) => s + p.balanceMinor, 0)).toBe(0);
  });

  it('a full refund voided, or the refund taken back, puts the totals back; an edit cannot turn a refund into an expense', async () => {
    const t = await holiday();
    await t.buy(90_000, equal3);
    const refund = await t.refund(90_000);
    const { moved } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [refund]);
    let view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.spentMinor).toBe(0);
    expect(view.people.every((p) => p.balanceMinor === 0)).toBe(true);
    await expect(editSharedExpense(t.database, t.ws, t.eventId, moved[0]!.expenseId, { amountMinor: 1_000 })).rejects.toThrow('A refund stays a refund');
    await editSharedExpense(t.database, t.ws, t.eventId, moved[0]!.expenseId, { amountMinor: -45_000, split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] } });
    view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.spentMinor).toBe(45_000);
    await voidSharedExpense(t.database, t.ws, t.eventId, moved[0]!.expenseId);
    view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.spentMinor).toBe(90_000);
    expect(view.people.reduce((s, p) => s + p.balanceMinor, 0)).toBe(0);
  });

  it('an ordinary purchase still moves in, and a refund after a settlement still balances', async () => {
    const t = await holiday();
    await t.buy(60_000, { mode: 'equal', people: ['p-rina', 'p-andi'] });
    const lunch = await postTransaction(t.database, t.inPersonal, { occurredOn: '2026-10-07', description: 'Lunch', lines: expenseLines({ categoryAccountId: t.dining.id, paymentAccountId: t.card.id, amountMinor: 10_000, currency: 'TRY' }), ratesToBase: { TRY: 560 } });
    expect((await moveIntoSharedEvent(t.database, t.ws, t.eventId, [lunch])).kept).toEqual([]);
    const refund = await t.refund(20_000, 'Refund · Harbour grill');
    const out = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [refund]);
    expect(out.kept).toEqual([]);
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.spentMinor).toBe(50_000);
    expect(view.people.reduce((s, p) => s + p.balanceMinor, 0)).toBe(0);
  });
});
