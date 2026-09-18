import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  bookNamesOf,
  categoryIdsByKey,
  categoryIdsByKeyAll,
  createAccount,
  createBook,
  guessCategoryFromHistory,
  inBook,
  personalBook,
  postTransaction,
  recordLoan,
  recordTrade,
  replaceTransaction,
  saveAssetProfile,
  saveBudget,
  saveExpenseTemplate,
} from '../src/index';
import { setupDb } from './helpers';

const copy = async () => {
  const { database, ws } = await setupDb();
  const personal = await personalBook(database, ws);
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
  return { database, ws, personal: personal.id, business };
};

describe('a system key once every workspace has a copy of it', () => {
  it('answers with the open workspace’s copy, and with every copy when asked for all', async () => {
    const { database, ws, personal, business } = await copy();
    const key = 'food_beverage.restaurants';
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))[key]!;
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))[key]!;
    expect(mine).not.toBe(theirs);
    // No book named: Personal, as every default has always been.
    expect((await categoryIdsByKey(database, ws))[key]).toBe(mine);
    expect([...(await categoryIdsByKeyAll(database, ws))[key]!].sort()).toEqual([mine, theirs].sort());

    // Each id really is filed in the book that claimed it.
    expect(await database.db.values(sql`SELECT book_id FROM book_categories WHERE category_account_id = ${theirs}`)).toEqual([[business]]);
  });

  it('keeps a new category out of it until it is given a key', async () => {
    const { database, ws, business } = await copy();
    const fresh = await createAccount(database, inBook(ws, business), { name: 'Client gifts', kind: 'expense', subtype: 'category', currency: null });
    const all = await categoryIdsByKeyAll(database, ws);
    expect(Object.values(all).flat()).not.toContain(fresh.id);
  });
});

describe('one workspace per transaction', () => {
  it('guesses a category from the open workspace’s own history only', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const keys = await categoryIdsByKey(database, inBook(ws, personal));
    const mine = keys['household.groceries']!;
    await postTransaction(database, inBook(ws, personal), {
      occurredOn: '2026-09-02',
      description: 'Superindo Kebayoran',
      lines: [
        { accountId: mine, amountMinor: 412_300, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -412_300, currency: 'IDR' },
      ],
    });
    expect(await guessCategoryFromHistory(database, inBook(ws, personal), 'Superindo')).toBe(mine);
    // Business has never shopped there, so it is not handed a category it would then refuse.
    expect(await guessCategoryFromHistory(database, inBook(ws, business), 'Superindo')).toBeNull();
  });

  it('refuses a budget and a bill whose category belongs to another workspace', async () => {
    const { database, ws, personal, business } = await copy();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['household.groceries']!;
    await expect(saveBudget(database, inBook(ws, personal), { categoryAccountId: theirs, amountMinor: 1_000_000 })).rejects.toMatchObject({ code: 'OTHER_BOOK' });
    await expect(
      saveExpenseTemplate(database, inBook(ws, personal), { name: 'Veg box', categoryAccountId: theirs, moneyAccountId: bank.id, amountMinor: 260_000, dayOfMonth: 2 }),
    ).rejects.toMatchObject({ code: 'OTHER_BOOK' });
  });

  it('says "workspaces", not "spend", when a transaction would straddle two', async () => {
    const { database, ws, personal, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))['household.groceries']!;
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['household.groceries']!;
    await expect(
      postTransaction(database, ws, {
        occurredOn: '2026-09-02',
        description: 'Mixed',
        lines: [
          { accountId: mine, amountMinor: 100, currency: 'IDR' },
          { accountId: theirs, amountMinor: 100, currency: 'IDR' },
          { accountId: card.id, amountMinor: -200, currency: 'IDR' },
        ],
      }),
    ).rejects.toThrow(/cannot belong to two workspaces/);
  });

  it('keeps a transaction’s workspace when it is edited', async () => {
    const { database, ws, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    const dinner = await postTransaction(database, inBook(ws, business), {
      occurredOn: '2026-09-02',
      description: 'Supplier dinner',
      lines: [
        { accountId: theirs, amountMinor: 640_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const edited = await replaceTransaction(database, inBook(ws, business), dinner, {
      occurredOn: '2026-09-02',
      description: 'Supplier dinner',
      lines: [
        { accountId: theirs, amountMinor: 700_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -700_000, currency: 'IDR' },
      ],
    });
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${edited}`)).toEqual([[business]]);
  });

  it('files a card-funded purchase and a card-paid loan in no workspace, so they show in every one', async () => {
    const { database, ws, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const gold = await createAccount(database, ws, { name: 'UBS gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['shopping']!;

    // The category rides on the card line as spend_category_id — it is what the card bought, not spending —
    // so neither posting carries a category line to be filed by.
    const trade = await recordTrade(database, inBook(ws, business), {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: '2026-09-12',
      unitsMicro: 2_000_000,
      grossMinor: 3_980_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: card.id,
      spendCategoryId: theirs,
      mcc: '5944',
    });
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${trade.transactionId}`)).toEqual([]);

    const loan = await recordLoan(database, inBook(ws, business), {
      person: { name: 'Rizky', direction: 'lent', currency: 'IDR' },
      occurredOn: '2026-09-12',
      amountMinor: 1_500_000,
      moneyAccountId: card.id,
      spendCategoryId: theirs,
    });
    expect(await database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${loan.transactionId}`)).toEqual([]);
  });

  it('names the workspace of each transaction asked about, and says nothing about a transfer', async () => {
    const { database, ws, business } = await copy();
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    const dinner = await postTransaction(database, inBook(ws, business), {
      occurredOn: '2026-09-02',
      description: 'Supplier dinner',
      lines: [
        { accountId: theirs, amountMinor: 640_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const payment = await postTransaction(database, ws, {
      occurredOn: '2026-09-20',
      description: 'Card bill',
      lines: [
        { accountId: card.id, amountMinor: 640_000, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -640_000, currency: 'IDR' },
      ],
    });
    const names = await bookNamesOf(database, ws, [dinner, payment]);
    expect(names[dinner]).toMatchObject({ id: business, name: 'Business', kind: 'business' });
    expect(names[payment]).toBeUndefined();
    expect(await bookNamesOf(database, ws, [])).toEqual({});
  });
});
