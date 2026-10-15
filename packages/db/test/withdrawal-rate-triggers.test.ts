import { readdirSync, readFileSync } from 'node:fs';
import { exchangeLines, expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  coretaxInputsFor,
  createAccount,
  listAccounts,
  moveTransactionInDay,
  netWorthAt,
  openEventBookTx,
  ownerScope,
  postEventRecordTx,
  postTransaction,
  postTransactionTx,
  purchaseCover,
  replaceTransaction,
  saveEvent,
  saveEventItem,
  setPurchaseCover,
  setPaidFromTx,
  systemAccountId,
  tagTransaction,
  upsertRate,
  voidTransaction,
} from '../src/index';
import { dismissWithdrawalRateNotice, recalcPendingForeign, withdrawalRateNoticeDue } from '../src/repos/fx-pending';
import { queueForeignRecalcTx, WITHDRAWAL_RATE_NOTICE_KEY } from '../src/repos/fx-tables';
import { withCapturePaused } from '../src/sync/capture';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Review Focus 1: a withdrawal recorded late, dated before the spending, moves that spending through every door — post,
 * the edit route's replace, void, a drag within the day, a shared event's derivation, and sync apply (queued, then
 * drained). Review Focus 5: the queue drains in batches. Invented figures: lira at 525 and 540, the day's 512.
 */
const RATES = { TRY: 512 };
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

async function trip() {
  const t = await setupDb();
  const all = await listAccounts(t.database, t.ws);
  const restaurants = all.find((a) => a.name === 'Restaurants')!.id;
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' })).id;
  const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const exchange = await systemAccountId(t.database.db, t.ws, 'currency_exchange');
  const withdrawal = (occurredOn: string, idr: number, kurus: number) => ({
    occurredOn,
    description: 'ATM',
    lines: exchangeLines({ fromAccountId: bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }),
    ratesToBase: RATES,
  });
  const dinner = (occurredOn: string, kurus: number) => ({
    occurredOn,
    description: 'Dinner',
    lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: lira, amountMinor: kurus, currency: 'TRY' }),
    ratesToBase: RATES,
  });
  const withdraw = (occurredOn: string, idr: number, kurus: number) => postTransaction(t.database, t.ws, withdrawal(occurredOn, idr, kurus));
  const spend = async (occurredOn: string, kurus: number) => {
    await pause();
    return postTransaction(t.database, t.ws, dinner(occurredOn, kurus));
  };
  /** What the lira line of a transaction's latest version is worth in base. */
  const liraBase = async (transactionId: string) =>
    Number((await t.database.db.values<[number]>(sql`SELECT amount_base_minor FROM entries WHERE transaction_id = ${transactionId} AND account_id = ${lira}`))[0]![0]);
  return { ...t, restaurants, bank, lira, exchange, withdrawal, dinner, withdraw, spend, liraBase };
}

describe('every door recalculates the lira it touched (Review Focus 1)', () => {
  it('post: a withdrawal recorded after the spending, dated before it, moves the spending', async () => {
    const t = await trip();
    const meal = await t.spend('2026-11-03', 45_000);
    expect(await t.liraBase(meal)).toBe(-230_400);
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    expect(await t.liraBase(meal)).toBe(-236_250);
  });

  it('replace: editing the withdrawal moves the spending, and moving it after the spending leaves the spending uncovered', async () => {
    const t = await trip();
    const atm = await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const meal = await t.spend('2026-11-03', 45_000);
    const edited = await replaceTransaction(t.database, t.ws, atm, t.withdrawal('2026-11-02', 5_400_000, 1_000_000));
    expect(await t.liraBase(meal)).toBe(-243_000);
    await replaceTransaction(t.database, t.ws, edited, t.withdrawal('2026-11-04', 5_400_000, 1_000_000));
    expect(await t.liraBase(meal)).toBe(-230_400);
  });

  it('void: deleting the withdrawal puts the spending back at its posted figure, as a shortfall', async () => {
    const t = await trip();
    const atm = await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const meal = await t.spend('2026-11-03', 45_000);
    await voidTransaction(t.database, t.ws, atm);
    expect(await t.liraBase(meal)).toBe(-230_400);
    expect(await t.database.db.values(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE account_id = ${t.lira}`)).toEqual([[45_000]]);
  });

  it('a drag within the day changes which spending took the older withdrawal (R13)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-01', 50_000, 10_000);
    await t.withdraw('2026-11-02', 60_000, 10_000);
    const a = await t.spend('2026-11-03', 10_000);
    const b = await t.spend('2026-11-03', 10_000);
    // b is newer, so on top of its day: a came first and took the 1 Nov lira.
    expect([await t.liraBase(a), await t.liraBase(b)]).toEqual([-50_000, -60_000]);
    await moveTransactionInDay(t.database, t.ws, b, [a, b]);
    expect([await t.liraBase(a), await t.liraBase(b)]).toEqual([-60_000, -50_000]);
  });

  it('a shared event’s expense paid from lira costs what the lira cost, and stays in no workspace', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    // The derivation reads the day's rate from the stored rates (as shared events do), not from a form.
    await upsertRate(t.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-11-01', rate: 512, source: 'manual', sourceDate: '2026-11-01' });
    const ws = ownerScope(t.ws);
    const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-11-05', endsOn: '2026-11-12' });
    await shareBookForTest(t.database, 'ev-book', 'p-rina');
    await t.database.execScript(`
      INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-11-05', '2026-11-12', 'TRY', NULL);
      INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-book', 'p-budi', 'Budi', NULL, NULL);
      INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES ('ev-book', 'exp-1', '2026-11-06', 90000, 'TRY', '1', 'p-rina', 'p-rina', NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES ('ev-book', 'exp-1', NULL, 'cat-dinners', 'equal', '["p-rina","p-andi","p-budi"]', 'p-rina', NULL);
    `);
    const tripBalance = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
    await t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', 'exp-1', 'expense', { accountId: t.lira, amountMinor: null }));
    await t.database.transaction((tx) => postEventRecordTx(tx, 'ev-book', 'expense', 'exp-1', null));
    const transactionId = (await t.database.db.values<[string]>(sql`SELECT transaction_id FROM event_postings WHERE book_id = 'ev-book' AND record_id = 'exp-1'`))[0]![0];
    // ₺900 at 525: Rp 472.500, a third on the share and two thirds on the trip balance.
    expect(await t.liraBase(transactionId)).toBe(-472_500);
    expect(Number((await t.database.db.values<[number]>(sql`SELECT amount_base_minor FROM entries WHERE transaction_id = ${transactionId} AND account_id = ${tripBalance}`))[0]![0])).toBe(315_000);
    expect(await t.database.db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId}`)).toEqual([]);
  });

  it('a rupiah event paid from lira keeps its transaction and its author when the record is derived again (final review I1)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await upsertRate(t.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-11-01', rate: 512, source: 'manual', sourceDate: '2026-11-01' });
    const ws = ownerScope(t.ws);
    const eventId = await saveEvent(t.database, ws, { name: 'Hill weekend', startsOn: '2026-11-05', endsOn: '2026-11-08' });
    await shareBookForTest(t.database, 'ev-idr', 'p-rina');
    await t.database.execScript(`
      INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-idr', 'Hill weekend', '2026-11-05', '2026-11-08', 'IDR', NULL);
      INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-idr', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-idr', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-idr', 'p-budi', 'Budi', NULL, NULL);
      INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-idr', 'cat-food', 'Food', NULL, 0, NULL);
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES ('ev-idr', 'exp-9', '2026-11-06', 460800, 'IDR', '1', 'p-rina', 'p-rina', NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES ('ev-idr', 'exp-9', NULL, 'cat-food', 'equal', '["p-rina","p-andi","p-budi"]', 'p-rina', NULL);
    `);
    await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-idr', eventId, name: 'Hill weekend', currency: 'IDR' }));
    await t.database.transaction((tx) => setPaidFromTx(tx, 'ev-idr', 'exp-9', 'expense', { accountId: t.lira, amountMinor: 90_000 }));
    await t.database.transaction((tx) => postEventRecordTx(tx, 'ev-idr', 'expense', 'exp-9', null));
    const posting = () => t.database.db.values<[string, string | null]>(sql`SELECT transaction_id, changed_by FROM event_postings WHERE book_id = 'ev-idr' AND record_id = 'exp-9'`);
    const [[first]] = (await posting()) as [[string, string | null]];
    // ₺900 at 525 is Rp 472.500 against the Rp 460.800 the record charges: an Exchange loss of 11.700 on the transaction.
    expect(
      await t.database.db.values(sql`SELECT a.system_key, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${first} AND a.system_key = 'expense.exchange_loss'`),
    ).toEqual([['expense.exchange_loss', 11_700]]);
    // Derived again for an op that changed nothing of it (a category rename, an echo, a retry), by another member.
    await t.database.transaction((tx) => postEventRecordTx(tx, 'ev-idr', 'expense', 'exp-9', 'p-andi'));
    expect(await posting()).toEqual([[first, null]]);
    expect(await t.database.db.values(sql`SELECT status FROM transactions WHERE id = ${first}`)).toEqual([['posted']]);
  });

  it('sync apply: what a paused write touched waits in the queue, and the drain recalculates it (R9)', async () => {
    const t = await trip();
    const meal = await t.spend('2026-11-03', 45_000);
    await t.database.transaction((tx) => withCapturePaused(tx, () => postTransactionTx(tx, t.ws, t.withdrawal('2026-11-02', 5_250_000, 1_000_000))));
    expect(await t.liraBase(meal)).toBe(-230_400);
    expect(await t.database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[t.lira, '2026-11-02']]);
    expect(await recalcPendingForeign(t.database)).toEqual({ done: 1, left: 0 });
    expect(await t.liraBase(meal)).toBe(-236_250);
  });
});

describe('what the recalculation brings along (final review M1)', () => {
  it('an event plan’s covers of a dinner a cheaper withdrawal made cheaper are cut to what it now cost, so the next cover edit is not refused', async () => {
    const t = await trip();
    const meal = await t.spend('2026-11-03', 45_000);
    const eventId = await saveEvent(t.database, t.ws, { name: 'Harbour days', startsOn: '2026-11-01', endsOn: '2026-11-09' });
    await tagTransaction(t.database, t.ws, meal, eventId);
    const soup = await saveEventItem(t.database, t.ws, eventId, { name: 'Soup', unitPriceMinor: 130_400, categoryAccountId: t.restaurants });
    const fish = await saveEventItem(t.database, t.ws, eventId, { name: 'Fish', unitPriceMinor: 100_000, categoryAccountId: t.restaurants });
    // ₺450 at the day's 512: Rp 230.400, all of it planned for.
    await setPurchaseCover(t.database, t.ws, meal, [{ itemId: soup, shareMinor: 130_400 }, { itemId: fish, shareMinor: 100_000 }]);
    // Lira withdrawn at 500, recorded late: the dinner now cost Rp 225.000.
    await t.withdraw('2026-11-02', 5_000_000, 1_000_000);
    expect(await t.liraBase(meal)).toBe(-225_000);
    const cover = await purchaseCover(t.database, t.ws, meal);
    expect(cover.givenMinor).toBe(225_000);
    expect(cover.leftMinor).toBe(0);
    // The cover screen saves what it shows, and is not refused as over the payment.
    await expect(setPurchaseCover(t.database, t.ws, meal, cover.covers)).resolves.toBeUndefined();
  });
});

describe('no door goes round the ledger (Review Focus 1)', () => {
  it('only the ledger, apply and the recalculation itself write a line or change what a transaction is, when or where in its day', () => {
    // Read from the source rather than from a run: a statement check, a conversion, an account's deletion, a trade, a
    // debt or a goal transfer that wrote its own entries (or voided, re-dated or reordered a row by hand) would skip
    // `markForeignDirtyTx`, and the spending after a back-dated withdrawal would quietly keep its old figure. Every one
    // of them posts and voids through `postTransactionTx` and `markVoidTx` today; this keeps it so.
    const root = new URL('../src/', import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.ts'));
    const writesLines = /insert\(entries\)|update\(entries\)|delete\(entries\)|INSERT\s+INTO\s+entries\b|UPDATE\s+entries\b|DELETE\s+FROM\s+entries\b/;
    const movesRows = /update\(transactions\)\s*\.set\(\{\s*(status|occurredOn)\b|UPDATE\s+transactions\s+SET\s+(status|occurred_on|day_order)\b/;
    const lineWriters = files.filter((file) => writesLines.test(readFileSync(new URL(file, root), 'utf8'))).sort();
    const rowMovers = files.filter((file) => movesRows.test(readFileSync(new URL(file, root), 'utf8'))).sort();
    // The regexes finding nothing would make this pass while proving nothing: the ledger itself must be found.
    expect(lineWriters).toEqual(['repos/fx-costs.ts', 'repos/fx-gain-loss.ts', 'repos/ledger.ts']);
    expect(rowMovers).toEqual(['repos/ledger.ts', 'sync/apply.ts']);
  });
});

describe('the queue (Review Focus 5, R18)', () => {
  it('drains in batches, and an account it cannot find is simply let go', async () => {
    const t = await trip();
    const euros = (await createAccount(t.database, t.ws, { name: 'Euro cash', kind: 'asset', subtype: 'cash', currency: 'EUR' })).id;
    await t.database.transaction(async (tx) => {
      await queueForeignRecalcTx(tx, t.lira, null);
      await queueForeignRecalcTx(tx, euros, null);
      await queueForeignRecalcTx(tx, 'no-such-account', null);
    });
    expect(await recalcPendingForeign(t.database, { limit: 1 })).toEqual({ done: 1, left: 2 });
    expect(await recalcPendingForeign(t.database)).toEqual({ done: 2, left: 0 });
  });

  it('an account whose recalculation fails stays queued, is tried once in the run, and the rest still drain', async () => {
    const t = await trip();
    const euros = (await createAccount(t.database, t.ws, { name: 'Euro cash', kind: 'asset', subtype: 'cash', currency: 'EUR' })).id;
    const paused = (input: ReturnType<typeof t.withdrawal>) => t.database.transaction((tx) => withCapturePaused(tx, () => postTransactionTx(tx, t.ws, input)));
    await paused(t.withdrawal('2026-11-02', 5_250_000, 1_000_000));
    await paused(t.dinner('2026-11-03', 45_000));
    const meal = (await t.database.db.values<[string]>(sql`SELECT id FROM transactions WHERE description = 'Dinner'`))[0]![0];
    await t.database.transaction((tx) => queueForeignRecalcTx(tx, euros, null));
    // The lira's recalculation fails on its first write of a lot use, as a full disk or a bug in one account would;
    // the lira is first in the queue, so a drain that went back to it would never reach the euros (or never end).
    await t.database.db.run(sql`CREATE TEMP TRIGGER fail_lira BEFORE INSERT ON fx_lot_uses WHEN NEW.account_id = ${sql.raw(`'${t.lira}'`)} BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await recalcPendingForeign(t.database)).toEqual({ done: 1, left: 1 });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
    // Its own write rolled back with it: still queued, from where it was, and the dinner keeps its posted figure.
    expect(await t.database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[t.lira, '2026-11-02']]);
    expect(await t.liraBase(meal)).toBe(-230_400);
    await t.database.db.run(sql`DROP TRIGGER fail_lira`);
    expect(await recalcPendingForeign(t.database)).toEqual({ done: 1, left: 0 });
    expect(await t.liraBase(meal)).toBe(-236_250);
  });

  it('net worth and the tax report read the same before and after the recalculation (§8, D6)', async () => {
    const t = await trip();
    const paused = (input: ReturnType<typeof t.withdrawal>) => t.database.transaction((tx) => withCapturePaused(tx, () => postTransactionTx(tx, t.ws, input)));
    await paused(t.withdrawal('2026-11-02', 5_250_000, 1_000_000));
    await paused(t.dinner('2026-11-03', 45_000));
    const before = { worth: await netWorthAt(t.database, t.ws, '2026-12-31', RATES), tax: await coretaxInputsFor(t.database, t.ws, 2026) };
    await recalcPendingForeign(t.database);
    expect(await t.liraBase((await t.database.db.values<[string]>(sql`SELECT id FROM transactions WHERE description = 'Dinner'`))[0]![0])).toBe(-236_250);
    expect({ worth: await netWorthAt(t.database, t.ws, '2026-12-31', RATES), tax: await coretaxInputsFor(t.database, t.ws, 2026) }).toEqual(before);
  });

  it('an account that keeps failing holds the notice back for three runs, then is logged and no longer does (final review M6)', async () => {
    const t = await trip();
    await t.database.db.run(sql`INSERT INTO settings (key, value) VALUES (${WITHDRAWAL_RATE_NOTICE_KEY}, 'due')`);
    await t.database.transaction((tx) => withCapturePaused(tx, () => postTransactionTx(tx, t.ws, t.withdrawal('2026-11-02', 5_250_000, 1_000_000))));
    await t.database.transaction((tx) => withCapturePaused(tx, () => postTransactionTx(tx, t.ws, t.dinner('2026-11-03', 45_000))));
    await t.database.db.run(sql`CREATE TEMP TRIGGER fail_lira BEFORE INSERT ON fx_lot_uses WHEN NEW.account_id = ${sql.raw(`'${t.lira}'`)} BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (let run = 1; run <= 2; run++) {
        expect(await recalcPendingForeign(t.database)).toEqual({ done: 0, left: 1 });
        expect(await withdrawalRateNoticeDue(t.database)).toBe(false);
      }
      expect(await recalcPendingForeign(t.database)).toEqual({ done: 0, left: 1 });
      expect(warn.mock.calls.some(([message]) => String(message).includes('no longer holds back'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
    expect(await withdrawalRateNoticeDue(t.database)).toBe(true);
    // Still tried at every run: once it goes through, it is off the queue and its count is forgotten.
    await t.database.db.run(sql`DROP TRIGGER fail_lira`);
    expect(await recalcPendingForeign(t.database)).toEqual({ done: 1, left: 0 });
    expect(await t.database.db.values(sql`SELECT value FROM settings WHERE key = 'fx.recalc_failures'`)).toEqual([]);
  });

  it('says the notice is due once the queue is empty, and never again once dismissed', async () => {
    const t = await trip();
    expect(await withdrawalRateNoticeDue(t.database)).toBe(false);
    await t.database.db.run(sql`INSERT INTO settings (key, value) VALUES (${WITHDRAWAL_RATE_NOTICE_KEY}, 'due')`);
    await t.database.transaction((tx) => queueForeignRecalcTx(tx, t.lira, null));
    expect(await withdrawalRateNoticeDue(t.database)).toBe(false);
    await recalcPendingForeign(t.database);
    expect(await withdrawalRateNoticeDue(t.database)).toBe(true);
    await dismissWithdrawalRateNotice(t.database);
    expect(await withdrawalRateNoticeDue(t.database)).toBe(false);
  });
});
