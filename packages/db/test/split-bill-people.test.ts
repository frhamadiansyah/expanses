import { afterEach, expect, it } from 'vitest';
import { addCard, createAccount, createCardAccount, listAccounts, listTransactions, peopleDebts, recentPeople, saveDebtProfile, splitBill } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function dinner() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const restaurants = (await listAccounts(database, ws)).find((a) => a.systemKey === 'food_beverage.restaurants')!.id;
  return { database, ws, card, restaurants };
}

it('opens one account per person and leaves your share in the category', async () => {
  const d = await dinner();
  const { debtAccountIds } = await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-17',
    description: 'Dinner for four',
    totalMinor: 400_000,
    moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants,
    ownShareMinor: 100_000,
    shares: [
      { person: { name: 'Andi', currency: 'IDR' }, amountMinor: 100_000 },
      { person: { name: 'Putri', currency: 'IDR' }, amountMinor: 100_000 },
      { person: { name: 'Chika', currency: 'IDR' }, amountMinor: 100_000 },
    ],
    channel: 'offline',
  });
  expect(debtAccountIds).toHaveLength(3);

  const [tx] = await listTransactions(d.database, d.ws);
  // The card is charged the whole bill, so the statement and the points still match the bank.
  expect(tx!.entries.find((e) => e.accountId === d.card.id)!.amountMinor).toBe(-400_000);
  expect(tx!.entries.find((e) => e.accountId === d.restaurants)!.amountMinor).toBe(100_000);
  expect(tx).toMatchObject({ channel: 'offline' });

  const people = await peopleDebts(d.database, d.ws, '2026-09-17');
  expect(people.owedToYou.map((person) => [person.personName, person.totalMinor])).toEqual([
    ['Andi', 100_000],
    ['Chika', 100_000],
    ['Putri', 100_000],
  ]);
});

it('offers the people you have split with before, most recent first', async () => {
  const d = await dinner();
  await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-17', description: 'Dinner', totalMinor: 200_000, moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants, ownShareMinor: 100_000, shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 100_000 }],
  });
  await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-18', description: 'Coffee', totalMinor: 100_000, moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants, ownShareMinor: 50_000, shares: [{ person: { name: 'Budi', currency: 'IDR' }, amountMinor: 50_000 }],
  });
  expect((await recentPeople(d.database, d.ws)).map((person) => person.personName)).toEqual(['Budi', 'Andi']);
});

// The brief's dinner splits every share equally, so a bug that charged every friend `totalMinor / shares.length`
// (or copied the first share to every account) would still pass it. A bill that does not divide evenly, with
// three *different* shares, is the only way to tell "each account got its own amount" from "they all got the
// same wrong number".
it('keeps each uneven share on its own account, to the rupiah', async () => {
  const d = await dinner();
  await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-17',
    description: 'Dinner for three, split unevenly',
    totalMinor: 100_003,
    moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants,
    ownShareMinor: 1,
    shares: [
      { person: { name: 'Andi', currency: 'IDR' }, amountMinor: 33_334 },
      { person: { name: 'Putri', currency: 'IDR' }, amountMinor: 33_335 },
      { person: { name: 'Chika', currency: 'IDR' }, amountMinor: 33_333 },
    ],
  });

  const people = await peopleDebts(d.database, d.ws, '2026-09-17');
  const byName = new Map(people.owedToYou.map((person) => [person.personName, person.totalMinor]));
  expect(byName.get('Andi')).toBe(33_334);
  expect(byName.get('Putri')).toBe(33_335);
  expect(byName.get('Chika')).toBe(33_333);
  // Every rupiah of the bill is accounted for: the three shares plus the own share sum to the total.
  expect([...byName.values()].reduce((sum, minor) => sum + minor, 0) + 1).toBe(100_003);
});

// The spec says recentPeople falls back to createdAt for a person with no ledger movement yet. Nothing in the
// splitBill-driven tests above exercises that path, since every person there already has an entry. A profile
// saved directly (no transaction posted) is the only way to reach the fallback.
it('offers a person with no movement yet, by when their profile was opened', async () => {
  const d = await dinner();
  const account = await createAccount(d.database, d.ws, { name: 'Deni', kind: 'asset', subtype: 'receivable', currency: 'IDR' });
  await saveDebtProfile(d.database, d.ws, { accountId: account.id, personName: 'Deni' });

  const people = await recentPeople(d.database, d.ws);
  expect(people.map((p) => p.personName)).toEqual(['Deni']);
  expect(people[0]!.lastOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it('records the card the bill was paid on and what it was charged in before conversion', async () => {
  current = await setupDb();
  const { database, ws } = current;
  const account = await createCardAccount(database, ws, {
    name: 'BCA KrisFlyer', issuer: 'BCA', subtype: 'credit_card', currency: 'IDR', last4: '1467', holderName: 'Fandrian',
  });
  // Two cards on one account: which of them was used is the only thing the single statement cannot tell you,
  // and it is exactly what a shared bill used to drop.
  const supplement = await addCard(database, ws, { accountId: account.id, last4: '8802', holderName: 'Spouse' });
  const restaurants = (await listAccounts(database, ws)).find((a) => a.systemKey === 'food_beverage.restaurants')!.id;
  // ¥120 charged to the IDR card as Rp 272.400, split down the middle with Andi. Both facts are the purchase's,
  // not the table's: without them the row prints no card digits and the receipt has no "Original amount" line.
  await splitBill(database, ws, {
    occurredOn: '2026-09-17',
    description: 'Dinner with Andi',
    totalMinor: 272_400,
    moneyAccountId: account.id,
    ownCategoryId: restaurants,
    ownShareMinor: 136_200,
    shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 136_200 }],
    cardId: supplement,
    originalCurrency: 'CNY',
    originalAmountMinor: 12_000,
  });

  const [tx] = await listTransactions(database, ws);
  expect(tx).toMatchObject({ cardId: supplement, originalCurrency: 'CNY', originalAmountMinor: 12_000 });
});

it('names no card and no original currency on a bill that had neither', async () => {
  const d = await dinner();
  await splitBill(d.database, d.ws, {
    occurredOn: '2026-09-17', description: 'Coffee', totalMinor: 100_000, moneyAccountId: d.card.id,
    ownCategoryId: d.restaurants, ownShareMinor: 50_000, shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 50_000 }],
  });
  const [tx] = await listTransactions(d.database, d.ws);
  expect(tx).toMatchObject({ cardId: null, originalCurrency: null, originalAmountMinor: null });
});
