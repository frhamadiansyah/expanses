import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardSpendLines,
  createAccount,
  eventRatesWanted,
  listAccounts,
  nativeBalances,
  openEventBookTx,
  ownerScope,
  postEventRecordTx,
  retryUnpostedEventRecords,
  saveEvent,
  setPaidFromTx,
  upsertRate,
  voidTransaction,
  ensureShareAccountTx,
  eventBookTx,
  followSharedEventTx,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Each phone's own lines from a shared event's records (shared events §5). A week by the coast in lira; Rina's phone.
 * Invented rates: 1 EUR = 17,000 IDR and 1 TRY = 560 IDR on 1 October 2026; 1 EUR = 31.5 TRY on the record.
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
  const card = await createAccount(t.database, ws, { name: 'Travel card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const restaurants = (await listAccounts(t.database, ws)).find((a) => a.name === 'Restaurants')!;
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-book', 'p-budi', 'Budi', NULL, NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
  `);
  const trip = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  const record = (id: string, over: { payer?: string; member?: string | null; amount?: number; currency?: string; rate?: string; people?: string[]; on?: string } = {}) =>
    t.database.execScript(`
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
        VALUES ('ev-book', '${id}', '${over.on ?? '2026-10-06'}', ${over.amount ?? 9000}, '${over.currency ?? 'EUR'}', '${over.rate ?? '31.5'}', '${over.payer ?? 'p-rina'}', ${over.member === null ? 'NULL' : `'${over.member ?? over.payer ?? 'p-rina'}'`}, NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
        VALUES ('ev-book', '${id}', NULL, 'cat-dinners', 'equal', '${JSON.stringify(over.people ?? ['p-rina', 'p-andi', 'p-budi'])}', 'p-rina', NULL);
    `);
  const derive = (id: string, author: string | null = null, kind: 'expense' | 'settlement' = 'expense') => t.database.transaction((tx) => postEventRecordTx(tx, 'ev-book', kind, id, author));
  const paidFrom = (id: string, accountId: string, amountMinor: number | null = null) => t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', id, 'expense', { accountId, amountMinor }));
  const posting = async (id: string) => {
    const [row] = await t.database.db.values<[string | null, string | null, string | null]>(sql`SELECT transaction_id, unposted, changed_by FROM event_postings WHERE book_id = 'ev-book' AND record_id = ${id}`);
    return row ? { transactionId: row[0], unposted: row[1], changedBy: row[2] } : null;
  };
  const linesOf = (transactionId: string) =>
    t.database.db.values<[string, number, string]>(sql`SELECT account_id, amount_minor, currency FROM entries WHERE transaction_id = ${transactionId} ORDER BY currency, account_id, amount_minor`);
  return { ...t, ws, wallet, card, restaurants, eventId, trip, record, derive, paidFrom, posting, linesOf };
}

describe('postEventRecordTx (spec §5)', () => {
  it('Rina paid €90 from her euro wallet for three: wallet −90, her share +30, the others’ lira on the trip balance', async () => {
    const t = await coastWeek();
    await t.record('exp-1');
    await t.paidFrom('exp-1', t.wallet.id);
    await t.derive('exp-1');
    const { transactionId, unposted } = (await t.posting('exp-1'))!;
    expect(unposted).toBeNull();
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.wallet.id]).toBe(-9_000);
    expect(balances[t.trip]).toBe(189_000);
    // In no workspace book, and on the event (§5.1, §6).
    expect(await t.database.db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId}`)).toEqual([]);
    expect(await t.database.db.values(sql`SELECT event_id FROM transactions WHERE id = ${transactionId}`)).toEqual([[t.eventId]]);
  });

  it('Andi paid and Rina is in the split: her share, and the trip balance down by its lira figure; no money account moves', async () => {
    const t = await coastWeek();
    await t.record('exp-2', { payer: 'p-andi' });
    await t.derive('exp-2', 'p-andi');
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.trip]).toBe(-94_500);
    expect(balances[t.wallet.id] ?? 0).toBe(0);
  });

  it('posts nothing when Rina is neither the payer nor in the split', async () => {
    const t = await coastWeek();
    await t.record('exp-3', { payer: 'p-andi', people: ['p-andi', 'p-budi'] });
    await t.derive('exp-3', 'p-andi');
    expect((await t.posting('exp-3'))!.transactionId).toBeNull();
  });

  it('a friend’s split edit replaces the transaction and says who, without moving the wallet (Review Focus 5); a void voids it', async () => {
    const t = await coastWeek();
    await t.record('exp-1');
    await t.paidFrom('exp-1', t.wallet.id);
    await t.derive('exp-1');
    const first = (await t.posting('exp-1'))!.transactionId!;
    await t.database.execScript(`UPDATE event_expense_details SET split_json = '["p-rina","p-andi"]', updated_by = 'p-andi' WHERE id = 'exp-1'`);
    await t.derive('exp-1', 'p-andi');
    const after = (await t.posting('exp-1'))!;
    expect(after.transactionId).not.toBe(first);
    expect(after.changedBy).toBe('p-andi');
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.wallet.id]).toBe(-9_000);
    expect(balances[t.trip]).toBe(141_750); // Andi's half, €45 × 31.5
    await t.database.execScript(`UPDATE event_expenses SET voided_at = '2026-10-09T00:00:00Z' WHERE id = 'exp-1'`);
    await t.derive('exp-1');
    expect(await t.database.db.values(sql`SELECT status FROM transactions WHERE id = ${after.transactionId}`)).toEqual([['void']]);
    expect((await nativeBalances(t.database, t.ws))[t.wallet.id] ?? 0).toBe(0);
  });

  it('waits for an account when Rina paid but this phone has none for it (R6)', async () => {
    const t = await coastWeek();
    await t.record('exp-4');
    await t.derive('exp-4');
    expect((await t.posting('exp-4'))!.unposted).toBe('choose-account');
    await t.paidFrom('exp-4', t.wallet.id);
    await t.derive('exp-4');
    expect((await t.posting('exp-4'))!.unposted).toBeNull();
  });

  it('waits for a rate it does not have, names it, and posts once the rate is saved', async () => {
    const t = await coastWeek();
    await t.record('exp-5', { payer: 'p-andi', currency: 'USD', rate: '33.2', amount: 3_000, on: '2026-09-20' });
    await t.derive('exp-5', 'p-andi');
    expect((await t.posting('exp-5'))!.unposted).toBe('no-rate');
    expect(await eventRatesWanted(t.database)).toEqual([{ currency: 'USD', onDate: '2026-09-20' }]);
    await upsertRate(t.database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-09-20', rate: 15_900, source: 'manual', sourceDate: '2026-09-20' });
    expect((await t.posting('exp-5'))!.unposted).toBeNull(); // upsertRate retried it
    expect(await retryUnpostedEventRecords(t.database)).toBe(0);
  });

  it('a card keeps earning on the full charge, by the workspace category the share came from (R12)', async () => {
    const t = await coastWeek();
    await t.record('exp-6', { currency: 'TRY', rate: '1', amount: 30_000, people: ['p-rina', 'p-andi'] });
    await t.database.transaction(async (tx) => {
      const book = (await eventBookTx(tx, 'ev-book'))!;
      await ensureShareAccountTx(tx, book, 'cat-dinners', t.restaurants.id);
      await setPaidFromTx(tx, 'ev-book', 'exp-6', 'expense', { accountId: t.card.id, amountMinor: 168_000 });
    });
    await t.derive('exp-6');
    const lines = await cardSpendLines(t.database, t.ws, t.card.id, '2026-10-01', '2026-10-31');
    expect(lines).toEqual([expect.objectContaining({ amountMinor: 168_000, categoryId: t.restaurants.id, currency: 'IDR' })]);
    const transactionId = (await t.posting('exp-6'))!.transactionId!;
    expect(await t.database.db.values(sql`SELECT original_currency, original_amount_minor FROM transactions WHERE id = ${transactionId}`)).toEqual([['TRY', 30_000]]);
  });

  it('refuses a void or an edit of a derived transaction from anywhere but the event', async () => {
    const t = await coastWeek();
    await t.record('exp-1');
    await t.paidFrom('exp-1', t.wallet.id);
    await t.derive('exp-1');
    const transactionId = (await t.posting('exp-1'))!.transactionId!;
    await expect(voidTransaction(t.database, t.ws, transactionId)).rejects.toMatchObject({ code: 'EVENT_POSTING' });
  });

  it('follows the event’s name and dates into the local event and the trip balance', async () => {
    const t = await coastWeek();
    await t.database.execScript(`UPDATE shared_events SET name = 'Coast fortnight', ends_on = '2026-10-19' WHERE book_id = 'ev-book'`);
    await t.database.transaction((tx) => followSharedEventTx(tx, 'ev-book'));
    expect(await t.database.db.values(sql`SELECT name, ends_on FROM events WHERE id = ${t.eventId}`)).toEqual([['Coast fortnight', '2026-10-19']]);
    expect(await t.database.db.values(sql`SELECT name FROM accounts WHERE id = ${t.trip}`)).toEqual([['Coast fortnight']]);
  });
});

describe('settlements (spec §5)', () => {
  it('Andi pays Rina 2,900 lira; Rina received it into her euro wallet as €92', async () => {
    const t = await coastWeek();
    await t.database.execScript(`INSERT INTO event_settlements (book_id, id, occurred_on, from_person_id, to_person_id, from_member_id, to_member_id, amount_minor, voided_at)
      VALUES ('ev-book', 's-1', '2026-10-12', 'p-andi', 'p-rina', 'p-andi', 'p-rina', 290000, NULL)`);
    await t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', 's-1', 'settlement', { accountId: t.wallet.id, amountMinor: 9_200 }));
    await t.derive('s-1', 'p-andi', 'settlement');
    const balances = await nativeBalances(t.database, t.ws);
    expect(balances[t.wallet.id]).toBe(9_200);
    expect(balances[t.trip]).toBe(-290_000);
    const description = await t.database.db.values(sql`SELECT t.description FROM transactions t JOIN event_postings p ON p.transaction_id = t.id WHERE p.record_id = 's-1'`);
    expect(description).toEqual([['Andi paid Rina']]);
  });
});

describe('what the derivation keeps steady (spec §5, ruling R5)', () => {
  it('a record moved to another currency with the same figures is replaced, so the share line is in the new one', async () => {
    const t = await coastWeek();
    await upsertRate(t.database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-10-01', rate: 15_400, source: 'manual', sourceDate: '2026-10-01' });
    await t.record('exp-7', { payer: 'p-andi' });
    await t.derive('exp-7', 'p-andi');
    const first = (await t.posting('exp-7'))!.transactionId!;
    await t.database.execScript(`UPDATE event_expenses SET currency = 'USD' WHERE id = 'exp-7'`);
    await t.derive('exp-7', 'p-andi');
    const after = (await t.posting('exp-7'))!.transactionId!;
    expect(after).not.toBe(first);
    const currencies = (await t.linesOf(after)).map(([, , currency]) => currency);
    expect(currencies).not.toContain('EUR');
  });

  it('a friend’s edit after Rina archived the wallet keeps the payment on it (Review Focus 5)', async () => {
    const t = await coastWeek();
    await t.record('exp-1');
    await t.paidFrom('exp-1', t.wallet.id);
    await t.derive('exp-1');
    await t.database.execScript(`UPDATE accounts SET archived_at = '2026-10-08T00:00:00Z' WHERE id = '${t.wallet.id}'`);
    await t.database.execScript(`UPDATE event_expense_details SET split_json = '["p-rina","p-andi"]', updated_by = 'p-andi' WHERE id = 'exp-1'`);
    await t.derive('exp-1', 'p-andi');
    expect((await t.posting('exp-1'))!.unposted).toBeNull();
    expect((await nativeBalances(t.database, t.ws))[t.wallet.id]).toBe(-9_000);
  });

  it('makes no share category for a record Rina has no part in', async () => {
    const t = await coastWeek();
    await t.record('exp-3', { payer: 'p-andi', people: ['p-andi', 'p-budi'] });
    await t.derive('exp-3', 'p-andi');
    expect(await t.database.db.values(sql`SELECT account_id FROM event_category_accounts`)).toEqual([]);
  });

  it('a first posting of a friend’s record is not "changed by" anyone; only a replacement is', async () => {
    const t = await coastWeek();
    await t.record('exp-2', { payer: 'p-andi' });
    await t.derive('exp-2', 'p-andi');
    expect((await t.posting('exp-2'))!.changedBy).toBeNull();
  });
});
