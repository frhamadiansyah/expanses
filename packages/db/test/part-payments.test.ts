import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardStatement,
  createAccount,
  createCardAccount,
  listAccounts,
  nativeBalances,
  payCardPurchases,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  saveInstallment,
  setSettledBeforeApp,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * Pay one purchase, own amount (owner, 25 Nov 2026): one purchase ticked on a statement, the Pay amount typed. Less pays
 * part of that purchase (0130), which keeps the rest to pay; more pays it whole and the rest is an ordinary card payment.
 * Invented card, shops and figures.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const NOVEMBER = statementCycleFor('2026-11-20', 20); // 21 Oct – 20 Nov
const DECEMBER = statementCycleFor('2026-12-20', 20); // 21 Nov – 20 Dec
const TODAY = '2026-11-25';

async function card() {
  current = await setupDb();
  const { database, ws } = current;
  const visa = await createCardAccount(database, ws, { name: 'Kartu Contoh', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: visa.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Bank Contoh', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const shopping = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const buy = (occurredOn: string, description: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: shopping, paymentAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  const lump = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description: 'Card payment', lines: transferLines({ fromAccountId: bank.id, toAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  const payOne = (purchase: string, payMinor: number | undefined, more: { amountsMinor?: Record<string, number>; occurredOn?: string } = {}) =>
    payCardPurchases(database, ws, {
      cardAccountId: visa.id,
      fromAccountId: bank.id,
      occurredOn: more.occurredOn ?? TODAY,
      purchaseTransactionIds: [purchase],
      ...(more.amountsMinor ? { amountsMinor: more.amountsMinor } : {}),
      ...(payMinor === undefined ? {} : { payMinor }),
      today: TODAY,
    });
  const statement = (cycle = NOVEMBER, today = TODAY) => cardStatement(database, ws, visa.id, cycle, today);
  const cover = async (id: string, cycle = NOVEMBER) => (await statement(cycle)).cover[id];
  const line = async (id: string, cycle = NOVEMBER) => (await statement(cycle)).lines.find((l) => l.transactionId === id && !l.instalment)!;
  const balance = async () => (await nativeBalances(database, ws))[visa.id] ?? 0;
  const rows = (table: string) => database.db.values<[string, string]>(sql.raw(`SELECT * FROM ${table} ORDER BY 1`));
  return { database, ws, visa, bank, buy, lump, payOne, statement, cover, line, balance, rows };
}

describe('one purchase paid with less than is left of it', () => {
  it('pays part of that purchase, which keeps the rest to pay; no settlement, a part-payment row', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const payment = await c.payOne(shoes, 300_000);

    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 300_000, leftMinor: 150_000, whole: false, creditKey: payment, credits: 1 });
    expect((await c.line(shoes)).paidBy).toBeNull();
    expect((await c.line(payment, DECEMBER)).paysPartOf).toBe(shoes);
    expect(await c.balance()).toBe(-150_000);
    expect(await c.rows('card_settlements')).toEqual([]);
    expect((await c.rows('card_part_payments')).map((r) => [r[0], r[1]])).toEqual([[payment, shoes]]);
  });

  it('on the open statement too, where the payment is one of its own lines', async () => {
    const c = await card();
    const older = await c.buy('2026-11-21', 'Warung Contoh', 100_000);
    const shoes = await c.buy('2026-11-23', 'Toko Sepatu Contoh', 450_000);
    const payment = await c.payOne(shoes, 300_000);
    const s = await c.statement(DECEMBER);
    expect(s.closed).toBe(false);
    expect(s.cover[shoes]).toMatchObject({ coveredMinor: 300_000, leftMinor: 150_000, creditKey: payment });
    expect(s.cover[older]).toMatchObject({ coveredMinor: 0, leftMinor: 100_000 });
    expect(s).toMatchObject({ chargesMinor: 550_000, creditsMinor: 300_000, closingMinor: 250_000 });
  });

  it('pays that purchase, not the older one a lump payment would pay first', async () => {
    const c = await card();
    const older = await c.buy('2026-10-25', 'Warung Contoh', 100_000);
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    await c.payOne(shoes, 300_000);

    expect(await c.cover(older)).toMatchObject({ coveredMinor: 0, leftMinor: 100_000, whole: false });
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 300_000, leftMinor: 150_000 });
    // The statement's totals are the ledger's, untouched by how the payment is spread.
    const s = await c.statement();
    expect(s).toMatchObject({ chargesMinor: 550_000, closingMinor: 550_000 });
    expect(await c.balance()).toBe(-250_000);
  });

  it('ticked again later, it pays the rest and is settled by that payment', async () => {
    const c = await card();
    const older = await c.buy('2026-10-25', 'Warung Contoh', 100_000);
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    await c.payOne(shoes, 300_000);
    const left = (await c.cover(shoes))!.leftMinor;
    // What the statement's Pay sends for a purchase with something already paid: what is left of it.
    const rest = await c.payOne(shoes, undefined, { amountsMinor: { [shoes]: left } });

    expect((await c.line(shoes)).paidBy?.transactionId).toBe(rest);
    expect((await c.statement()).cover[shoes]).toBeUndefined();
    expect(await c.cover(older)).toMatchObject({ coveredMinor: 0, leftMinor: 100_000 });
    expect(await c.balance()).toBe(-100_000);
  });

  it('paid in two parts, then the rest typed exactly: settled, nothing over', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const first = await c.payOne(shoes, 100_000);
    const second = await c.payOne(shoes, 200_000, { amountsMinor: { [shoes]: 350_000 } });
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 300_000, leftMinor: 150_000, credits: 2, creditKey: second });
    const rest = await c.payOne(shoes, 150_000, { amountsMinor: { [shoes]: 150_000 } });
    expect((await c.line(shoes)).paidBy?.transactionId).toBe(rest);
    expect(await c.balance()).toBe(0);
    expect((await c.rows('card_part_payments')).map((r) => r[0]).sort()).toEqual([first, second].sort());
  });

  it('a lump payment afterwards covers the rest, oldest first, as it covers any purchase', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const part = await c.payOne(shoes, 300_000);
    const lump = await c.lump('2026-11-24', 150_000);
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 450_000, leftMinor: 0, whole: true, creditKey: lump, credits: 2 });
    expect(part).not.toBe(lump);
    expect(await c.balance()).toBe(0);
  });

  it('a purchase a lump already partly covered: the part comes off what the lump left', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    await c.lump('2026-11-10', 50_000);
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 50_000, leftMinor: 400_000 });
    await c.payOne(shoes, 100_000, { amountsMinor: { [shoes]: 400_000 } });
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 150_000, leftMinor: 300_000, whole: false, credits: 2 });
    expect(await c.balance()).toBe(-300_000);
  });

  it('deleting the part payment makes the purchase owed whole again; deleting the purchase makes it an ordinary payment', async () => {
    const c = await card();
    const older = await c.buy('2026-10-25', 'Warung Contoh', 100_000);
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const part = await c.payOne(shoes, 300_000);
    await voidTransaction(c.database, c.ws, part);
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 0, leftMinor: 450_000 });

    const again = await c.payOne(shoes, 300_000);
    await voidTransaction(c.database, c.ws, shoes);
    // Rp 300.000 now pays the card oldest first: the older purchase whole.
    expect(await c.cover(older)).toMatchObject({ whole: true, creditKey: again });
    expect(await c.balance()).toBe(200_000);
  });

  it('an edit follows both: the payment made bigger pays the purchase whole, and what is over covers the others', async () => {
    const c = await card();
    const older = await c.buy('2026-10-25', 'Warung Contoh', 100_000);
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const part = await c.payOne(shoes, 300_000);
    const edited = await replaceTransaction(c.database, c.ws, part, {
      occurredOn: TODAY,
      description: 'Credit card payment',
      lines: transferLines({ fromAccountId: c.bank.id, toAccountId: c.visa.id, amountMinor: 500_000, currency: 'IDR' }),
    });
    expect((await c.rows('card_part_payments')).map((r) => r[0])).toEqual([edited]);
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 450_000, leftMinor: 0, whole: true, creditKey: edited });
    expect(await c.cover(older)).toMatchObject({ coveredMinor: 50_000, leftMinor: 50_000 });

    const repriced = await replaceTransaction(c.database, c.ws, shoes, {
      occurredOn: '2026-11-03',
      description: 'Toko Sepatu Contoh',
      lines: expenseLines({ categoryAccountId: (await listAccounts(c.database, c.ws)).find((a) => a.systemKey === 'household.groceries')!.id, paymentAccountId: c.visa.id, amountMinor: 600_000, currency: 'IDR' }),
    });
    expect((await c.rows('card_part_payments')).map((r) => [r[0], r[1]])).toEqual([[edited, repriced]]);
    expect(await c.cover(repriced)).toMatchObject({ coveredMinor: 500_000, leftMinor: 100_000, whole: false });
    expect(await c.cover(older)).toMatchObject({ coveredMinor: 0, leftMinor: 100_000 });
  });

  it('a purchase paid off before the app, or turned into a plan, takes nothing from it: it is an ordinary payment', async () => {
    const c = await card();
    const older = await c.buy('2026-10-25', 'Warung Contoh', 100_000);
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const part = await c.payOne(shoes, 80_000);
    await setSettledBeforeApp(c.database, c.ws, shoes, true);
    expect(await c.cover(older)).toMatchObject({ coveredMinor: 80_000, leftMinor: 20_000, creditKey: part });
    await setSettledBeforeApp(c.database, c.ws, shoes, false);
    expect(await c.cover(shoes)).toMatchObject({ coveredMinor: 80_000, leftMinor: 370_000 });

    await saveInstallment(c.database, c.ws, { cardAccountId: c.visa.id, description: 'Shoes plan', totalMinor: 450_000, months: 3, firstBilledMonth: '2026-11', transactionId: shoes });
    expect(await c.cover(older)).toMatchObject({ whole: false, coveredMinor: 80_000 });
  });

  it('a part paid on a later statement comes off its purchase there, as a settlement would', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const december = await c.buy('2026-11-28', 'Toko Contoh', 70_000);
    const part = await c.payOne(shoes, 200_000, { occurredOn: '2026-11-29' });
    const s = await c.statement(NOVEMBER, '2026-11-30');
    expect(s.cover[shoes]).toMatchObject({ coveredMinor: 200_000, leftMinor: 250_000, creditKey: part });
    expect(s.laterCredits.map((l) => l.transactionId)).toContain(part);
    expect((await c.statement(DECEMBER, '2026-11-30')).cover[december]).toMatchObject({ coveredMinor: 0, leftMinor: 70_000 });
  });
});

describe('one purchase paid with more than is left of it', () => {
  it('pays it whole, settled; what is over covers the card’s other purchases, oldest first', async () => {
    const c = await card();
    const older = await c.buy('2026-10-25', 'Warung Contoh', 100_000);
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const payment = await c.payOne(shoes, 500_000);

    expect((await c.line(shoes)).paidBy?.transactionId).toBe(payment);
    expect(await c.cover(older)).toMatchObject({ coveredMinor: 50_000, leftMinor: 50_000, creditKey: payment });
    expect(await c.rows('card_part_payments')).toEqual([]);
    expect(await c.balance()).toBe(-50_000);
  });

  it('with nothing else to pay, what is over stays on the card as credit for the next purchases', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    await c.payOne(shoes, 500_000);
    expect(await c.balance()).toBe(50_000);
    const next = await c.buy('2026-11-27', 'Toko Contoh', 30_000);
    expect((await c.statement(DECEMBER, '2026-12-25')).cover[next]).toMatchObject({ whole: true });
  });

  it('typed at exactly what is left, it writes the very rows the fixed amount writes', async () => {
    const a = await card();
    const shoesA = await a.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    await a.payOne(shoesA, 450_000);
    expect((await a.line(shoesA)).paidBy).not.toBeNull();
    expect(await a.rows('card_part_payments')).toEqual([]);
    expect(await a.balance()).toBe(0);
  });

  it('refuses an amount of its own for several purchases, or nothing', async () => {
    const c = await card();
    const one = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const two = await c.buy('2026-11-04', 'Toko Contoh', 50_000);
    await expect(
      payCardPurchases(c.database, c.ws, { cardAccountId: c.visa.id, fromAccountId: c.bank.id, occurredOn: TODAY, purchaseTransactionIds: [one, two], payMinor: 100_000, today: TODAY }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    for (const payMinor of [0, -1, 1.5]) await expect(c.payOne(one, payMinor)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(await c.balance()).toBe(-500_000);
  });
});

describe('several purchases ticked with one paid in part before', () => {
  it('pays each for what is left and settles both', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    const bag = await c.buy('2026-11-05', 'Toko Tas Contoh', 120_000);
    await c.payOne(shoes, 300_000);
    const both = await payCardPurchases(c.database, c.ws, {
      cardAccountId: c.visa.id,
      fromAccountId: c.bank.id,
      occurredOn: TODAY,
      purchaseTransactionIds: [shoes, bag],
      amountsMinor: { [shoes]: 150_000 },
      today: TODAY,
    });
    expect((await c.line(shoes)).paidBy?.transactionId).toBe(both);
    expect((await c.line(bag)).paidBy?.transactionId).toBe(both);
    expect(await c.balance()).toBe(0);
    await expect(c.payOne(shoes, undefined, { amountsMinor: { [shoes]: 1 } })).rejects.toMatchObject({ code: 'ALREADY_PAID' });
  });

  it('refuses more than is left of it', async () => {
    const c = await card();
    const shoes = await c.buy('2026-11-03', 'Toko Sepatu Contoh', 450_000);
    await c.payOne(shoes, 300_000);
    await expect(c.payOne(shoes, undefined, { amountsMinor: { [shoes]: 200_000 } })).rejects.toMatchObject({ code: 'STALE_AMOUNT' });
    await expect(c.payOne(shoes, undefined)).rejects.toMatchObject({ code: 'STALE_AMOUNT' });
  });
});
