import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSetCategory,
  archiveAccount,
  CategoryDeleteError,
  categoryUsage,
  createAccount,
  createCategorySet,
  createDraft,
  createProgram,
  deleteCategory,
  dismissDraft,
  listAccounts,
  postTransaction,
  saveBudget,
  saveCategoryMcc,
  saveCategoryNeed,
  saveEarnRule,
  saveEvent,
  saveEventItem,
  saveExpenseTemplate,
  setCategoryColour,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * Deleting a category (repos/category-delete.ts): only one nothing uses. Each USE there refuses in plain words; each
 * SETTING there goes with the category. The classification is the comment at the top of that file; this is its test.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function setup() {
  current = await setupDb();
  const { database, ws } = current;
  const make = async (name: string, parentId: string | null = null) =>
    (await createAccount(database, ws, { name, kind: 'expense', subtype: 'category', currency: null, parentId })).id;
  const bank = (await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  return { ...current, make, bank };
}

async function rowsFor(t: TestDb, id: string) {
  const count = async (table: string, column = 'category_account_id') =>
    Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM ${sql.raw(table)} WHERE ${sql.raw(column)} = ${id}`))[0]![0]);
  return {
    account: await count('accounts', 'id'),
    need: await count('category_needs'),
    colour: await count('category_colours'),
    mcc: await count('category_mccs', 'category_id'),
    set: await count('category_set_members'),
    book: await count('book_categories'),
    drafts: await count('draft_transactions'),
  };
}

describe('deleteCategory', () => {
  it('deletes an unused custom category, and its settings go with it', async () => {
    const t = await setup();
    const syalala = await t.make('Syalala');
    await saveCategoryNeed(t.database, t.ws, syalala, 'lifestyle');
    await setCategoryColour(t.database, t.ws, syalala, '#16a34a');
    await saveCategoryMcc(t.database, t.ws, syalala, '5812');
    const dismissed = await createDraft(t.database, t.ws, { source: 'manual', occurredOn: '2026-09-01', description: 'Kopi', amountMinor: 30_000, currency: 'IDR', categoryAccountId: syalala });
    await dismissDraft(t.database, t.ws, dismissed);
    expect(await rowsFor(t, syalala)).toEqual({ account: 1, need: 1, colour: 1, mcc: 1, set: 0, book: 1, drafts: 1 });

    expect(await categoryUsage(t.database, t.ws, syalala)).toEqual({ uses: [], builtIn: false, canDelete: true });
    await deleteCategory(t.database, t.ws, syalala);
    expect(await rowsFor(t, syalala)).toEqual({ account: 0, need: 0, colour: 0, mcc: 0, set: 0, book: 0, drafts: 0 });
    expect((await listAccounts(t.database, t.ws)).some((a) => a.id === syalala)).toBe(false);
  });

  it("takes a set's category out of its set", async () => {
    const t = await setup();
    const setId = await createCategorySet(t.database, t.ws, 'Trips');
    const tickets = await addSetCategory(t.database, t.ws, setId, 'Tickets');
    await deleteCategory(t.database, t.ws, tickets);
    expect(await rowsFor(t, tickets)).toMatchObject({ account: 0, set: 0, book: 0 });
  });

  it('refuses a built-in category, which would come back by itself', async () => {
    const t = await setup();
    const groceries = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Groceries' && a.systemKey !== null)!.id;
    expect(await categoryUsage(t.database, t.ws, groceries)).toMatchObject({ builtIn: true, canDelete: false });
    await expect(deleteCategory(t.database, t.ws, groceries)).rejects.toThrow(/built in.*Archive it instead/);
  });

  it('refuses anything that is not a category', async () => {
    const t = await setup();
    await expect(deleteCategory(t.database, t.ws, t.bank)).rejects.toThrow(CategoryDeleteError);
  });

  describe('each use keeps the category', () => {
    const cases: [string, (t: Awaited<ReturnType<typeof setup>>, id: string) => Promise<unknown>, RegExp][] = [
      [
        'a posted transaction',
        (t, id) => postTransaction(t.database, t.ws, { occurredOn: '2026-09-01', description: 'Lunch', lines: expenseLines({ categoryAccountId: id, paymentAccountId: t.bank, amountMinor: 50_000, currency: 'IDR' }) }),
        /Syalala is used by a transaction\. Archive it instead\./,
      ],
      [
        'a voided transaction',
        async (t, id) =>
          voidTransaction(
            t.database,
            t.ws,
            await postTransaction(t.database, t.ws, { occurredOn: '2026-09-01', description: 'Lunch', lines: expenseLines({ categoryAccountId: id, paymentAccountId: t.bank, amountMinor: 50_000, currency: 'IDR' }) }),
          ),
        /used by a transaction/,
      ],
      [
        'a draft waiting for review',
        (t, id) => createDraft(t.database, t.ws, { source: 'manual', occurredOn: '2026-09-01', description: 'Kopi', amountMinor: 30_000, currency: 'IDR', categoryAccountId: id }),
        /used by a draft waiting for review/,
      ],
      ['a subcategory', (t, id) => t.make('Child', id), /used by a subcategory/],
      [
        'an archived subcategory',
        async (t, id) => archiveAccount(t.database, t.ws, await t.make('Child', id)),
        /used by a subcategory/,
      ],
      ['a budget', (t, id) => saveBudget(t.database, t.ws, { categoryAccountId: id, amountMinor: 1_000_000 }), /used by a budget/],
      [
        'a recurring bill',
        (t, id) => saveExpenseTemplate(t.database, t.ws, { name: 'Gym', categoryAccountId: id, moneyAccountId: t.bank, amountMinor: 300_000, dayOfMonth: 5 }),
        /used by a recurring bill/,
      ],
      [
        'an event plan',
        async (t, id) => saveEventItem(t.database, t.ws, await saveEvent(t.database, t.ws, { name: 'Trip', startsOn: '2026-09-01', endsOn: '2026-09-05' }), { name: 'Snacks', unitPriceMinor: 10_000, categoryAccountId: id }),
        /used by an event plan/,
      ],
      [
        'a card earning rule',
        async (t, id) => {
          const card = await createAccount(t.database, t.ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
          const program = await createProgram(t.database, t.ws, { cardAccountId: card.id, name: 'Points', unit: 'points', cycleAnchor: 'statement' });
          await saveEarnRule(t.database, t.ws, program.id, {
            name: 'Not here', priority: 1, stackable: false, match: { excludeCategoryIds: [id] }, rateNum: 1, rateDen: 2500,
            rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
          });
        },
        /used by a card earning rule/,
      ],
    ];
    for (const [what, use, message] of cases) {
      it(what, async () => {
        const t = await setup();
        const syalala = await t.make('Syalala');
        await use(t, syalala);
        expect(await categoryUsage(t.database, t.ws, syalala)).toMatchObject({ canDelete: false });
        await expect(deleteCategory(t.database, t.ws, syalala)).rejects.toThrow(message);
        expect((await rowsFor(t, syalala)).account).toBe(1);
      });
    }
  });

  it('names every use at once', async () => {
    const t = await setup();
    const syalala = await t.make('Syalala');
    for (const day of ['01', '02']) {
      await postTransaction(t.database, t.ws, { occurredOn: `2026-09-${day}`, description: 'Lunch', lines: expenseLines({ categoryAccountId: syalala, paymentAccountId: t.bank, amountMinor: 50_000, currency: 'IDR' }) });
    }
    await saveBudget(t.database, t.ws, { categoryAccountId: syalala, amountMinor: 1_000_000 });
    await expect(deleteCategory(t.database, t.ws, syalala)).rejects.toThrow('Syalala is used by 2 transactions and a budget. Archive it instead.');
  });
});
