import { expenseLines, statementCycleFor, transferLines, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardStatement,
  createAccount,
  createCardAccount,
  listAccounts,
  nativeBalances,
  paidOffMarkOf,
  payCardPurchases,
  postTransaction,
  postTransactions,
  replaceTransaction,
  saveCardTerms,
  setSettledBeforeApp,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';
import { exchange, linkedPair, sameRows, type Device } from './self/devices';

/*
 * A card payment pays first what was on the card when the payment was recorded (owner, 25 Nov 2026, "option 3"); only
 * what is over of it reaches the charges recorded after it. "Recorded" is the time in the transaction's first id, so
 * the tests give each row its id at an invented time. Invented names and figures throughout.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 24, 2, 0, 0);
/** An id recorded `minutes` after T0. */
const at = (minutes: number) => uuidv7(T0 + minutes * MIN);

const DECEMBER = statementCycleFor('2026-12-20', 20); // 21 Nov – 20 Dec
const TODAY = '2026-11-25';

async function cardOn(d: { database: TestDb['database']; ws: TestDb['ws'] }) {
  const { database, ws } = d;
  const card = await createCardAccount(database, ws, { name: 'Kartu Contoh', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Bank Contoh', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const buyInput = (occurredOn: string, description: string, amountMinor: number, id?: string) => ({
    ...(id ? { id } : {}),
    occurredOn,
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor, currency: 'IDR' }),
  });
  const payInput = (occurredOn: string, amountMinor: number, id?: string) => ({
    ...(id ? { id } : {}),
    occurredOn,
    description: 'Card payment',
    lines: transferLines({ fromAccountId: bank.id, toAccountId: card.id, amountMinor, currency: 'IDR' }),
  });
  const buy = (occurredOn: string, description: string, amountMinor: number, id: string) => postTransaction(database, ws, buyInput(occurredOn, description, amountMinor, id));
  const pay = (occurredOn: string, amountMinor: number, id: string) => postTransaction(database, ws, payInput(occurredOn, amountMinor, id));
  const statement = () => cardStatement(database, ws, card.id, DECEMBER, TODAY);
  const owed = async () => 0 - ((await nativeBalances(database, ws))[card.id] ?? 0) || 0;
  return { card, bank, groceries, buy, pay, buyInput, payInput, statement, owed };
}

async function household() {
  current = await setupDb();
  return { ...current, ...(await cardOn(current)) };
}

/** The owner's three purchases of 23 Nov and the Rp 1.000.000 paid for them on 24 Nov, recorded in that order. */
async function threeAndPaid(h: Awaited<ReturnType<typeof household>>) {
  const three = [await h.buy('2026-11-23', 'Toko Satu', 400_000, at(0)), await h.buy('2026-11-23', 'Toko Dua', 350_000, at(1)), await h.buy('2026-11-23', 'Toko Tiga', 250_000, at(2))];
  const payment = await h.pay('2026-11-24', 1_000_000, at(10));
  return { three, payment };
}

describe('a card payment stays with what was on the card when it was recorded', () => {
  it('the owner’s case: two older purchases recorded a day later show unpaid, and can be marked paid off', async () => {
    const h = await household();
    const { three, payment } = await threeAndPaid(h);
    const older = [await h.buy('2026-11-22', 'Toko Lama', 120_000, at(24 * 60)), await h.buy('2026-11-22', 'Toko Lama 2', 80_000, at(24 * 60 + 2))];

    const s = await h.statement();
    for (const id of three) expect(s.cover[id]).toMatchObject({ whole: true, leftMinor: 0, creditKey: payment, credits: 1 });
    expect(s.cover[older[0]!]).toMatchObject({ whole: false, coveredMinor: 0, leftMinor: 120_000, creditKey: null });
    expect(s.cover[older[1]!]).toMatchObject({ whole: false, coveredMinor: 0, leftMinor: 80_000, creditKey: null });
    // The sums are what they always were: the card owes the two purchases.
    expect(await h.owed()).toBe(200_000);
    expect(s.closingMinor).toBe(200_000);

    // Paid elsewhere: each can carry the paid-off mark, and once marked the card owes nothing, as the bank says.
    for (const id of older) expect(await paidOffMarkOf(h.database, h.ws, id)).toEqual({ refund: false, settled: false });
    for (const id of older) await setSettledBeforeApp(h.database, h.ws, id, true);
    const after = await h.statement();
    expect(after.lines.filter((l) => older.includes(l.transactionId)).map((l) => l.paidOff)).toEqual([true, true]);
    for (const id of three) expect(after.cover[id]).toMatchObject({ whole: true, creditKey: payment });
    expect(await h.owed()).toBe(0);
  });

  it('statement Pay offers the later-recorded older purchases, not the ones the payment covers', async () => {
    const h = await household();
    const { three } = await threeAndPaid(h);
    const old = await h.buy('2026-11-22', 'Toko Lama', 120_000, at(24 * 60));
    await expect(payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: TODAY, purchaseTransactionIds: [three[0]!], today: TODAY })).rejects.toMatchObject({ code: 'STALE_AMOUNT' });
    await payCardPurchases(h.database, h.ws, { cardAccountId: h.card.id, fromAccountId: h.bank.id, occurredOn: TODAY, purchaseTransactionIds: [old], today: TODAY });
    expect(await h.owed()).toBe(0);
    const s = await h.statement();
    expect(s.lines.find((l) => l.transactionId === old)!.paidBy).not.toBeNull();
    for (const id of three) expect(s.cover[id]!.whole).toBe(true);
  });

  it('an edit made later keeps the time the row was first recorded, for the purchase and for the payment', async () => {
    const h = await household();
    const { three, payment } = await threeAndPaid(h);
    const old = await h.buy('2026-11-22', 'Toko Lama', 120_000, at(24 * 60));
    // Both edited now, long after: a new row each, replacing the old.
    const edited = await replaceTransaction(h.database, h.ws, three[1]!, h.buyInput('2026-11-23', 'Toko Dua (renamed)', 350_000));
    const repaid = await replaceTransaction(h.database, h.ws, payment, h.payInput('2026-11-24', 1_000_000));
    const s = await h.statement();
    for (const id of [three[0]!, edited, three[2]!]) expect(s.cover[id]).toMatchObject({ whole: true, creditKey: repaid });
    expect(s.cover[old]).toMatchObject({ coveredMinor: 0 });
  });

  it('what is over of a payment covers the purchases recorded after it, oldest first', async () => {
    const h = await household();
    const a = await h.buy('2026-11-23', 'Toko Satu', 600_000, at(0));
    const payment = await h.pay('2026-11-24', 800_000, at(5));
    const newer = await h.buy('2026-11-22', 'Toko Baru', 150_000, at(60));
    const older = await h.buy('2026-11-21', 'Toko Lama', 100_000, at(90));
    const s = await h.statement();
    expect(s.cover[a]).toMatchObject({ whole: true, creditKey: payment });
    expect(s.cover[older]).toMatchObject({ whole: true, coveredMinor: 100_000, creditKey: payment });
    expect(s.cover[newer]).toMatchObject({ whole: false, coveredMinor: 100_000, leftMinor: 50_000 });
    expect(await h.owed()).toBe(50_000);
  });

  it('a paste that holds the payment and its purchases: the payment covers them, recorded together', async () => {
    const h = await household();
    // On the card already, and newer than the pasted purchases.
    const before = await h.buy('2026-11-25', 'Toko Kemarin', 200_000, at(0));
    // Pasted in one go, payment first (real time: the rows are written a moment apart).
    const [payment, p1, p2] = await postTransactions(h.database, h.ws, [h.payInput('2026-11-24', 500_000), h.buyInput('2026-11-23', 'Tempel Satu', 200_000), h.buyInput('2026-11-21', 'Tempel Dua', 300_000)]);
    const s = await h.statement();
    expect(s.cover[p1!]).toMatchObject({ whole: true, creditKey: payment });
    expect(s.cover[p2!]).toMatchObject({ whole: true, creditKey: payment });
    expect(s.cover[before]).toMatchObject({ coveredMinor: 0, leftMinor: 200_000 });
  });

  it('a purchase synced from a household under a local id reads the time of its lineage, the id it has on every phone', async () => {
    const h = await household();
    const { three, payment } = await threeAndPaid(h);
    // A copy written here under a remapped local id (a v5 id: no time in it) for a lineage first recorded a day later.
    const local = '5f0c9d2e-1b3a-5c4d-8e7f-0a1b2c3d4e5f';
    await h.buy('2026-11-22', 'Toko Lama', 120_000, local);
    await h.database.db.run(sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${at(24 * 60)}, 'book-x', ${local}, 'm', 'Me')`);
    const s = await h.statement();
    for (const id of three) expect(s.cover[id]).toMatchObject({ whole: true, creditKey: payment });
    expect(s.cover[local]).toMatchObject({ coveredMinor: 0 });
    // The lineage gone, the id alone says nothing of when: counted as on the card all along, as dates alone would.
    await h.database.db.run(sql`DELETE FROM sync_lineage`);
    const plain = await h.statement();
    expect(plain.cover[local]).toMatchObject({ whole: true });
  });
});

describe('the owner’s linked devices work out the same cover', () => {
  const coverOf = async (d: Device, cardId: string) => (await cardStatement(d.database, d.ws, cardId, DECEMBER, TODAY)).cover;

  it('a phone records the purchases and the payment, the Mac the older purchases a day later: both say the same', async () => {
    let cardId = '';
    const { phone, mac } = await linkedPair(async (t) => {
      cardId = (await cardOn(t)).card.id;
    });
    // The card was made before the Mac's copy: both devices hold it, and its bank, under the same ids.
    const accounts = await listAccounts(phone.database, phone.ws);
    const bankId = accounts.find((a) => a.name === 'Bank Contoh')!.id;
    const groceries = accounts.find((a) => a.systemKey === 'household.groceries')!.id;
    const buy = (d: Device, occurredOn: string, amountMinor: number, id: string) =>
      postTransaction(d.database, d.ws, { id, occurredOn, description: 'Toko', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: cardId, amountMinor, currency: 'IDR' }) });
    const three = [await buy(phone, '2026-11-23', 400_000, at(0)), await buy(phone, '2026-11-23', 600_000, at(1))];
    const payment = await postTransaction(phone.database, phone.ws, { id: at(10), occurredOn: '2026-11-24', description: 'Card payment', lines: transferLines({ fromAccountId: bankId, toAccountId: cardId, amountMinor: 1_000_000, currency: 'IDR' }) });
    await exchange(phone, mac);
    const old = await buy(mac, '2026-11-22', 120_000, at(24 * 60));
    await exchange(mac, phone);
    expect(await sameRows(phone, mac)).toEqual([]);
    const [p, m] = [await coverOf(phone, cardId), await coverOf(mac, cardId)];
    expect(m).toEqual(p);
    for (const id of three) expect(p[id]).toMatchObject({ whole: true, creditKey: payment });
    expect(p[old]).toMatchObject({ coveredMinor: 0 });
  });
});
