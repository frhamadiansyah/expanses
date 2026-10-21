import { expenseLines, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addPhoto,
  addSetCategory,
  cardSpendLines,
  convertEventToShared,
  createAccount,
  createCardAccount,
  createCategorySet,
  inBook,
  linkEventItem,
  setEventItemDone,
  listAccounts,
  listTransactions,
  moveIntoSharedEvent,
  openEventBookTx,
  ownerScope,
  personalBook,
  postTransaction,
  saveEvent,
  saveEventItem,
  setPostedOn,
  sharedEventPlan,
  sharedEventView,
  upsertRate,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Moving spending into a shared event (shared events §6, D2): the purchase leaves its workspace and becomes an expense
 * paid by this person, all theirs, without losing anything a card purchase has (Review Focus 3). Invented rates:
 * 1 TRY = 560 IDR.
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
  const book = await personalBook(t.database, t.ws);
  const inPersonal = inBook(t.ws, book.id);
  await upsertRate(t.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-10-01', rate: 560, source: 'manual', sourceDate: '2026-10-01' });
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  const share = async () => {
    await shareBookForTest(t.database, 'ev-book', 'p-rina');
    await t.database.execScript(`
      INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
      INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL);
    `);
    await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  };
  return { ...t, ws, inPersonal, eventId, share };
}

describe('moveIntoSharedEvent', () => {
  it('keeps a card purchase’s card, MCC, channel, photo, posting date, original currency and points (Review Focus 3)', async () => {
    const t = await coastWeek();
    await t.share();
    const card = await createCardAccount(t.database, t.ws, { name: 'Travel card', subtype: 'credit_card', currency: 'IDR', last4: '4321' });
    const [cardRow] = await t.database.db.values<[string]>(sql`SELECT id FROM cards WHERE account_id = ${card.id}`);
    const restaurants = (await listAccounts(t.database, t.inPersonal)).find((a) => a.name === 'Restaurants')!;
    const purchase = await postTransaction(t.database, t.inPersonal, {
      occurredOn: '2026-10-06', description: 'Harbour grill', lines: expenseLines({ categoryAccountId: restaurants.id, paymentAccountId: card.id, amountMinor: 168_000, currency: 'IDR' }),
      cardId: cardRow![0], mcc: '5812', channel: 'offline', originalCurrency: 'TRY', originalAmountMinor: 30_000,
    });
    await addPhoto(t.database, t.ws, { transactionId: purchase, fileName: 'grill.jpg', mime: 'image/jpeg', byteSize: 1_000 });
    await setPostedOn(t.database, t.ws, purchase, '2026-10-08');
    const earning = (lines: Awaited<ReturnType<typeof cardSpendLines>>) => lines.map((l) => ({ amountMinor: l.amountMinor, categoryId: l.categoryId, mcc: l.mcc, currency: l.currency }));
    const before = earning(await cardSpendLines(t.database, t.ws, card.id, '2026-10-01', '2026-10-31'));

    const { moved, kept } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [purchase]);
    expect(kept).toEqual([]);
    const [now] = await listTransactions(t.database, t.ws, { accountId: card.id });
    expect(now!.id).not.toBe(purchase);
    expect(now).toMatchObject({ cardId: cardRow![0], mcc: '5812', channel: 'offline', photoCount: 1, originalCurrency: 'TRY', originalAmountMinor: 30_000, eventId: t.eventId });
    expect(await t.database.db.values(sql`SELECT posted_on FROM card_postings WHERE transaction_id = ${now!.id}`)).toEqual([['2026-10-08']]);
    expect(earning(await cardSpendLines(t.database, t.ws, card.id, '2026-10-01', '2026-10-31'))).toEqual(before);
    // It left the workspace (D2) and is the event's: one expense, all Rina's, paid by Rina from an account in the app.
    expect((await listTransactions(t.database, t.inPersonal)).map((v) => v.description)).not.toContain('Harbour grill');
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.expenses).toEqual([expect.objectContaining({ expenseId: moved[0]!.expenseId, amountMinor: 30_000, currency: 'TRY', payerHasAccount: true, splitText: 'Equal · 1 person', categoryName: 'Restaurants', note: 'Harbour grill' })]);
  });

  it('keeps out what cannot move, and says why', async () => {
    const t = await coastWeek();
    await t.share();
    const bank = await createAccount(t.database, t.ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const cash = await createAccount(t.database, t.ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const transfer = await postTransaction(t.database, t.ws, { occurredOn: '2026-10-06', description: 'Top up', lines: transferLines({ fromAccountId: bank.id, toAccountId: cash.id, amountMinor: 500_000, currency: 'IDR' }) });
    const { moved, kept } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [transfer]);
    expect(moved).toEqual([]);
    expect(kept).toEqual([{ transactionId: transfer, why: 'Only a purchase from one account under one category moves into a shared event' }]);
  });

  it('leaves a purchase with no rate to the event currency where it was, and writes nothing to the event', async () => {
    const t = await coastWeek();
    await t.share();
    const wallet = await createAccount(t.database, t.ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
    const restaurants = (await listAccounts(t.database, t.inPersonal)).find((a) => a.name === 'Restaurants')!;
    const purchase = await postTransaction(t.database, t.inPersonal, {
      occurredOn: '2026-10-06', description: 'Pier cafe', lines: expenseLines({ categoryAccountId: restaurants.id, paymentAccountId: wallet.id, amountMinor: 1_250, currency: 'EUR' }), ratesToBase: { EUR: 17_300 },
    });
    const { moved, kept } = await moveIntoSharedEvent(t.database, t.ws, t.eventId, [purchase]);
    expect(moved).toEqual([]);
    expect(kept).toEqual([{ transactionId: purchase, why: 'No EUR or TRY rate for 2026-10-06 yet' }]);
    expect((await listTransactions(t.database, t.inPersonal)).map((v) => v.id)).toContain(purchase);
    expect(await t.database.db.values(sql`SELECT count(*) FROM event_expenses`)).toEqual([[0]]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM event_categories`)).toEqual([[0]]);
  });
});

describe('convertEventToShared', () => {
  it('turns the set into the event’s categories, the plan into shared items in lira, and moves the tagged spending', async () => {
    const t = await coastWeek();
    const setId = await createCategorySet(t.database, t.ws, 'Trips');
    const meals = await addSetCategory(t.database, t.ws, setId, 'Meals');
    await t.database.execScript(`UPDATE events SET set_id = '${setId}' WHERE id = '${t.eventId}'`);
    const wallet = await createAccount(t.database, t.ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    const lunch = await postTransaction(t.database, t.ws, {
      occurredOn: '2026-10-07', description: 'Lunch', lines: expenseLines({ categoryAccountId: meals, paymentAccountId: wallet.id, amountMinor: 840_000, currency: 'IDR' }), eventId: t.eventId,
    });
    const item = await saveEventItem(t.database, t.ws, t.eventId, { name: 'Lunch by the sea', unitPriceMinor: 1_120_000, categoryAccountId: meals });
    await linkEventItem(t.database, t.ws, item, lunch, 840_000);
    await setEventItemDone(t.database, t.ws, item, true);
    await t.share();

    const out = await convertEventToShared(t.database, t.ws, t.eventId);
    expect(out).toEqual({ moved: 1, kept: [] });
    const view = (await sharedEventView(t.database, t.ws, t.eventId))!;
    expect(view.categories.map((c) => c.name)).toEqual(['Meals']);
    // Rp 840,000 at 560 rupiah a lira is ₺1,500 (150,000 kuruş); the item's Rp 1,120,000 is ₺2,000.
    expect(view.expenses).toEqual([expect.objectContaining({ amountMinor: 840_000, currency: 'IDR', rateToEvent: rateOf(1, 560), categoryName: 'Meals' })]);
    const plan = (await sharedEventPlan(t.database, t.ws, t.eventId))!;
    expect(plan.lines.flatMap((l) => l.items)).toEqual([expect.objectContaining({ name: 'Lunch by the sea', unitPriceMinor: 200_000, bought: true, actualMinor: 150_000 })]);
    expect(await t.database.db.values(sql`SELECT 1 FROM book_transactions bt JOIN event_postings p ON p.transaction_id = bt.transaction_id`)).toEqual([]);
  });
});

/** The rate a move writes: IDR → TRY through the base, as `rateString(1 / 560)` writes it. */
function rateOf(from: number, to: number): string {
  return (from / to).toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}
