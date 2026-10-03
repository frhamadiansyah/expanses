import { expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { categoryTotalsIn, createAccount, createBook, inBook, listAccounts, postTransaction, upsertRate } from '../src/index';
import { setupDb } from './helpers';

/**
 * Cashflow's donut follows the list's Paid with filter (spec S11, §3.7): only transactions with an entry on that
 * account, each counted by that account's share of what paid for it.
 */
describe('categoryTotalsIn paid with one account', () => {
  async function household() {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'Checking', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const all = await listAccounts(database, ws);
    const id = (name: string) => all.find((a) => a.name === name)!.id;
    const spend = (category: string, payer: string, amountMinor: number) =>
      postTransaction(database, ws, {
        occurredOn: '2026-09-10',
        description: category,
        lines: expenseLines({ categoryAccountId: id(category), paymentAccountId: payer, amountMinor, currency: 'IDR' }),
      });
    await spend('Groceries', card.id, 100);
    await spend('Groceries', bank.id, 50);
    await spend('Restaurants', card.id, 30);
    return { database, ws, card, bank, id };
  }

  const amounts = (rows: { accountId: string; amountBaseMinor: number }[]) =>
    Object.fromEntries(rows.map((row) => [row.accountId, row.amountBaseMinor]));

  it('keeps only what the card paid, and everything without the option', async () => {
    const { database, ws, card, id } = await household();
    const everything = await categoryTotalsIn(database, ws, 'expense', '2026-09-01', '2026-09-30');
    expect(amounts(everything.rows)).toEqual({ [id('Groceries')]: 150, [id('Restaurants')]: 30 });

    const onCard = await categoryTotalsIn(database, ws, 'expense', '2026-09-01', '2026-09-30', { paidAccountId: card.id });
    expect(amounts(onCard.rows)).toEqual({ [id('Groceries')]: 100, [id('Restaurants')]: 30 });
    expect(onCard.rows.find((row) => row.accountId === id('Groceries'))!.transactions).toBe(1);
  });

  it("counts the card's share of a purchase paid partly from the bank", async () => {
    const { database, ws, card, bank, id } = await household();
    await postTransaction(database, ws, {
      occurredOn: '2026-09-12',
      description: 'Shared dinner',
      lines: [
        { accountId: id('Restaurants'), amountMinor: 100, currency: 'IDR' },
        { accountId: card.id, amountMinor: -80, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -20, currency: 'IDR' },
      ],
    });
    const onCard = await categoryTotalsIn(database, ws, 'expense', '2026-09-01', '2026-09-30', { paidAccountId: card.id });
    expect(amounts(onCard.rows)).toEqual({ [id('Groceries')]: 100, [id('Restaurants')]: 30 + 80 });
    const onBank = await categoryTotalsIn(database, ws, 'expense', '2026-09-01', '2026-09-30', { paidAccountId: bank.id });
    expect(amounts(onBank.rows)).toEqual({ [id('Groceries')]: 50, [id('Restaurants')]: 20 });
  });

  it('applies the same share in a workspace that reads in another currency', async () => {
    const { database, ws } = await setupDb();
    const sgd = await createBook(database, ws, { name: 'Singapore', kind: 'business', baseCurrency: 'SGD' });
    const book = inBook(ws, sgd);
    await upsertRate(database, { fromCurrency: 'IDR', toCurrency: 'SGD', onDate: '2026-09-01', rate: 0.0001, source: 'manual', sourceDate: '2026-09-01' });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'Checking', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const meals = await createAccount(database, book, { name: 'Client meals', kind: 'expense', subtype: 'category', currency: null });
    await postTransaction(database, book, {
      occurredOn: '2026-09-12',
      description: 'Dinner',
      lines: [
        { accountId: meals.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -750_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -250_000, currency: 'IDR' },
      ],
    });
    const all = await categoryTotalsIn(database, book, 'expense', '2026-09-01', '2026-09-30');
    expect(all.currency).toBe('SGD');
    expect(amounts(all.rows)).toEqual({ [meals.id]: 10_000 });
    const onCard = await categoryTotalsIn(database, book, 'expense', '2026-09-01', '2026-09-30', { paidAccountId: card.id });
    expect(amounts(onCard.rows)).toEqual({ [meals.id]: 7_500 });
  });
});
