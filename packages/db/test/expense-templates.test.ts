import { describe, expect, it } from 'vitest';
import {
  committedByCategory,
  createAccount,
  deleteExpenseTemplate,
  dueExpenseTemplates,
  listExpenseTemplates,
  postTransaction,
  saveExpenseTemplate,
} from '../src/index';
import { setupDb } from './helpers';

const MONTH = '2026-09';

/** A wallet to pay from and two spending categories, which is all a bill needs. */
async function household() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const phone = await createAccount(database, ws, { name: 'Phone', kind: 'expense', subtype: 'category', currency: null });
  const water = await createAccount(database, ws, { name: 'Water & sanitation', kind: 'expense', subtype: 'category', currency: null });
  return { database, ws, bca, phone, water };
}

type Household = Awaited<ReturnType<typeof household>>;

/** Spending: the category is debited and the wallet pays for it. */
const pay = (
  { database, ws }: Household,
  { categoryId, walletId, occurredOn, amountMinor, templateId }: { categoryId: string; walletId: string; occurredOn: string; amountMinor: number; templateId?: string },
) =>
  postTransaction(database, ws, {
    occurredOn,
    description: 'Bill',
    templateId,
    lines: [
      { accountId: categoryId, amountMinor, currency: 'IDR' },
      { accountId: walletId, amountMinor: -amountMinor, currency: 'IDR' },
    ],
  });

describe('saveExpenseTemplate', () => {
  it('keeps a bill whose amount differs every month', async () => {
    const context = await household();
    await saveExpenseTemplate(context.database, context.ws, {
      name: 'Electricity',
      categoryAccountId: context.water.id,
      moneyAccountId: context.bca.id,
      dayOfMonth: 20,
    });

    const [bill] = await listExpenseTemplates(context.database, context.ws);
    expect(bill).toMatchObject({ name: 'Electricity', amountMinor: null, dayOfMonth: 20, active: true });
  });

  it('refuses a wallet where a category belongs', async () => {
    const context = await household();

    await expect(
      saveExpenseTemplate(context.database, context.ws, {
        name: 'Phone',
        categoryAccountId: context.bca.id,
        moneyAccountId: context.bca.id,
        dayOfMonth: 20,
      }),
    ).rejects.toThrow(/spending category/);
  });

  it('refuses a category where the money should be', async () => {
    const context = await household();

    await expect(
      saveExpenseTemplate(context.database, context.ws, {
        name: 'Phone',
        categoryAccountId: context.phone.id,
        moneyAccountId: context.water.id,
        dayOfMonth: 20,
      }),
    ).rejects.toThrow(/account or a card/);
  });

  it('refuses a day outside the month', async () => {
    const context = await household();

    await expect(
      saveExpenseTemplate(context.database, context.ws, { name: 'Phone', categoryAccountId: context.phone.id, moneyAccountId: context.bca.id, dayOfMonth: 32 }),
    ).rejects.toThrow(/between 1 and 31/);
  });

  it('refuses an amount of nothing, which is not the same as leaving it open', async () => {
    const context = await household();

    await expect(
      saveExpenseTemplate(context.database, context.ws, {
        name: 'Phone',
        categoryAccountId: context.phone.id,
        moneyAccountId: context.bca.id,
        amountMinor: 0,
        dayOfMonth: 20,
      }),
    ).rejects.toThrow(/differs every month/);
  });

  it('edits in place rather than making a second bill', async () => {
    const context = await household();
    const id = await saveExpenseTemplate(context.database, context.ws, {
      name: 'Phone',
      categoryAccountId: context.phone.id,
      moneyAccountId: context.bca.id,
      amountMinor: 150_000,
      dayOfMonth: 20,
    });
    await saveExpenseTemplate(context.database, context.ws, {
      id,
      name: 'Phone and internet',
      categoryAccountId: context.phone.id,
      moneyAccountId: context.bca.id,
      amountMinor: 400_000,
      dayOfMonth: 20,
    });

    const bills = await listExpenseTemplates(context.database, context.ws);
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ name: 'Phone and internet', amountMinor: 400_000 });
  });

  it('drops a bill you no longer have', async () => {
    const context = await household();
    const id = await saveExpenseTemplate(context.database, context.ws, {
      name: 'Phone',
      categoryAccountId: context.phone.id,
      moneyAccountId: context.bca.id,
      dayOfMonth: 20,
    });
    await deleteExpenseTemplate(context.database, context.ws, id);

    expect(await listExpenseTemplates(context.database, context.ws)).toEqual([]);
  });
});

describe('dueExpenseTemplates', () => {
  const bill = (context: Household, dayOfMonth: number, name = 'Phone') =>
    saveExpenseTemplate(context.database, context.ws, {
      name,
      categoryAccountId: context.phone.id,
      moneyAccountId: context.bca.id,
      amountMinor: 150_000,
      dayOfMonth,
    });

  it('says nothing before the day has come round', async () => {
    const context = await household();
    await bill(context, 20);

    expect(await dueExpenseTemplates(context.database, context.ws, `${MONTH}-19`)).toEqual([]);
  });

  it('asks on the day itself', async () => {
    const context = await household();
    await bill(context, 20);

    expect(await dueExpenseTemplates(context.database, context.ws, `${MONTH}-20`)).toHaveLength(1);
  });

  it('stops asking once a payment says it settled the bill', async () => {
    const context = await household();
    const id = await bill(context, 20);
    await pay(context, { categoryId: context.phone.id, walletId: context.bca.id, occurredOn: `${MONTH}-21`, amountMinor: 150_000, templateId: id });

    expect(await dueExpenseTemplates(context.database, context.ws, `${MONTH}-25`)).toEqual([]);
  });

  it('counts a bill paid early, because the question is whether this month is settled', async () => {
    const context = await household();
    const id = await bill(context, 20);
    await pay(context, { categoryId: context.phone.id, walletId: context.bca.id, occurredOn: `${MONTH}-03`, amountMinor: 150_000, templateId: id });

    expect(await dueExpenseTemplates(context.database, context.ws, `${MONTH}-20`)).toEqual([]);
  });

  it('asks again the next month, however faithfully the last one was paid', async () => {
    const context = await household();
    const id = await bill(context, 20);
    await pay(context, { categoryId: context.phone.id, walletId: context.bca.id, occurredOn: `${MONTH}-21`, amountMinor: 150_000, templateId: id });

    expect(await dueExpenseTemplates(context.database, context.ws, '2026-10-20')).toHaveLength(1);
  });

  it('is not settled by a payment in the same category that names no bill', async () => {
    const context = await household();
    await bill(context, 20);
    // Spending on the phone category is not proof the bill itself was paid.
    await pay(context, { categoryId: context.phone.id, walletId: context.bca.id, occurredOn: `${MONTH}-21`, amountMinor: 150_000 });

    expect(await dueExpenseTemplates(context.database, context.ws, `${MONTH}-25`)).toHaveLength(1);
  });
});

describe('committedByCategory', () => {
  it('adds up what the bills in a category already claim', async () => {
    const context = await household();
    await saveExpenseTemplate(context.database, context.ws, {
      name: 'Phone',
      categoryAccountId: context.phone.id,
      moneyAccountId: context.bca.id,
      amountMinor: 150_000,
      dayOfMonth: 20,
    });
    await saveExpenseTemplate(context.database, context.ws, {
      name: 'Internet',
      categoryAccountId: context.phone.id,
      moneyAccountId: context.bca.id,
      amountMinor: 350_000,
      dayOfMonth: 5,
    });

    expect(await committedByCategory(context.database, context.ws)).toEqual({ [context.phone.id]: 500_000 });
  });

  it('leaves an open-ended bill out rather than guessing what it will be', async () => {
    const context = await household();
    await saveExpenseTemplate(context.database, context.ws, {
      name: 'Electricity',
      categoryAccountId: context.water.id,
      moneyAccountId: context.bca.id,
      dayOfMonth: 20,
    });

    expect(await committedByCategory(context.database, context.ws)).toEqual({});
  });
});
