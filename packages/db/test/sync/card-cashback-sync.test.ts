import { CARD_CASHBACK, expenseLines, refundLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cardCashbackCategory, categoryTotalsIn, createCardAccount, inBook, listTransactions, periodFlows, postTransaction } from '../../src/index';
import { categoryOf, Household, skipsOf, type Device } from './household';

/** Invented figures: Rp 320.000 of groceries on the card and a Rp 75.000 promo cashback onto it, in November. */
async function setup() {
  const home = new Household();
  const a = await home.device('Fandri');
  const b = await home.device('Dewi');
  const bookId = await home.share(a);
  await home.join(b, a);
  await home.settle();
  const card = await createCardAccount(a.database, a.ws, { name: 'BCA Visa', subtype: 'credit_card', currency: 'IDR', last4: '4321' });
  const groceries = await categoryOf(a.database, bookId, 'Groceries');
  return { home, a, b, bookId, card, groceries };
}

const cashbackRows = (d: Device, bookId: string) =>
  d.database.db.values<[string, string, string, string]>(sql`
    SELECT a.id, a.name, a.kind, a.system_key FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id
     WHERE bc.book_id = ${bookId} AND a.system_key = ${CARD_CASHBACK.key}`);

async function spending(d: Device, bookId: string) {
  const rows = (await categoryTotalsIn(d.database, inBook(d.ws, bookId), 'expense', '2026-11-01', '2026-11-30')).rows;
  const names = new Map((await d.database.db.values<[string, string]>(sql`SELECT id, name FROM accounts`)).map(([id, name]) => [id, name]));
  return rows.map((row) => `${names.get(row.accountId)}:${row.amountBaseMinor}`).sort();
}

describe('Cashback & Rewards into a credit card in a shared workspace', () => {
  it('reaches the partner’s phone with its category, and both phones agree on every figure', async () => {
    const { home, a, b, bookId, card, groceries } = await setup();
    await postTransaction(a.database, a.ws, { occurredOn: '2026-11-10', description: 'Supermarket', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor: 320_000, currency: 'IDR' }) });
    const cashback = await cardCashbackCategory(a.database, a.ws);
    await postTransaction(a.database, a.ws, { occurredOn: '2026-11-17', description: 'Promo cashback', lines: refundLines({ categoryAccountId: cashback, paymentAccountId: card.id, amountMinor: 75_000, currency: 'IDR' }) });
    await home.settle();

    expect(await skipsOf(b.database)).toEqual([]);
    expect(await cashbackRows(b, bookId)).toEqual([[cashback, 'Cashback & Rewards', 'expense', CARD_CASHBACK.key]]);
    expect(await spending(b, bookId)).toEqual(['Cashback & Rewards:-75000', 'Groceries:320000']);
    expect(await spending(b, bookId)).toEqual(await spending(a, bookId));
    const flows = async (d: Device) => (await periodFlows(d.database, inBook(d.ws, bookId), { from: '2026-11-01', to: '2026-11-30' })).spendingMinor;
    expect(await flows(b)).toBe(245_000);
    expect(await flows(a)).toBe(245_000);
    const rows = await listTransactions(b.database, inBook(b.ws, bookId), { from: '2026-11-01', to: '2026-11-30' });
    expect(rows.find((row) => row.description === 'Promo cashback')!.entries.find((e) => e.accountKind === 'expense')).toMatchObject({ accountId: cashback, amountMinor: -75_000 });
  });

  it('is one category when both phones save their first cashback before they meet', async () => {
    const { home, a, b, bookId } = await setup();
    const onA = await cardCashbackCategory(a.database, a.ws);
    const onB = await cardCashbackCategory(b.database, inBook(b.ws, bookId));
    expect(onB).toBe(onA);
    await home.settle();
    expect(await skipsOf(a.database)).toEqual([]);
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await cashbackRows(a, bookId)).toHaveLength(1);
    expect(await cashbackRows(b, bookId)).toHaveLength(1);
  });
});
