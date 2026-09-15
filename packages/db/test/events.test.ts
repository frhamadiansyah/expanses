import { describe, expect, it } from 'vitest';
import { budgetSheetFor, createAccount, deleteEvent, eventSheetFor, finishEvent, listEventBudgets, listEvents, postTransaction, replaceTransaction, saveBudget, saveEvent, setEventBudget, suggestForEvent, tagTransaction } from '../src/index';
import { setupDb } from './helpers';

const MONTH = '2026-09';
const WINDOW = { startsOn: `${MONTH}-18`, endsOn: `${MONTH}-28` };

async function household() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const gifts = await createAccount(database, ws, { name: 'Gift giving', kind: 'expense', subtype: 'category', currency: null });
  const food = await createAccount(database, ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
  return { database, ws, bca, gifts, food };
}

type Household = Awaited<ReturnType<typeof household>>;

const spend = ({ database, ws, bca }: Household, categoryId: string, occurredOn: string, amountMinor: number, description = 'Spending') =>
  postTransaction(database, ws, {
    occurredOn,
    description,
    lines: [
      { accountId: categoryId, amountMinor, currency: 'IDR' },
      { accountId: bca.id, amountMinor: -amountMinor, currency: 'IDR' },
    ],
  });

const lebaran = (context: Household) => saveEvent(context.database, context.ws, { name: 'Lebaran', ...WINDOW });

describe('finishing an event', () => {
  it('calls it done and puts it back, keeping it in the list either way', async () => {
    const context = await household();
    const id = await lebaran(context);

    await finishEvent(context.database, context.ws, id, true);
    const finished = (await listEvents(context.database, context.ws)).find((event) => event.id === id)!;
    expect(finished.finishedAt).toEqual(expect.any(String));

    await finishEvent(context.database, context.ws, id, false);
    expect((await listEvents(context.database, context.ws)).find((event) => event.id === id)!.finishedAt).toBeNull();
  });
});

describe('saveEvent', () => {
  it('stores an occasion and its window', async () => {
    const context = await household();
    await lebaran(context);

    expect(await listEvents(context.database, context.ws)).toEqual([
      { id: expect.any(String), name: 'Lebaran', startsOn: WINDOW.startsOn, endsOn: WINDOW.endsOn, plannedMinor: null, goalId: null, setId: null, finishedAt: null },
    ]);
  });

  it('refuses an occasion that ends before it starts', async () => {
    const context = await household();

    await expect(
      saveEvent(context.database, context.ws, { name: 'Backwards', startsOn: `${MONTH}-28`, endsOn: `${MONTH}-18` }),
    ).rejects.toThrow(/cannot end before/);
  });

  it('drops one you no longer want', async () => {
    const context = await household();
    await deleteEvent(context.database, context.ws, await lebaran(context));

    expect(await listEvents(context.database, context.ws)).toEqual([]);
  });
});

describe('the plan', () => {
  it('carries a figure per category, and edits in place', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 4_000_000 });

    expect(await listEventBudgets(context.database, context.ws, id)).toEqual([
      { categoryAccountId: context.gifts.id, plannedMinor: 4_000_000 },
    ]);
  });

  it('refuses to plan against something that is not a spending category', async () => {
    const context = await household();
    const id = await lebaran(context);

    await expect(
      setEventBudget(context.database, context.ws, id, { categoryAccountId: context.bca.id, plannedMinor: 1_000 }),
    ).rejects.toThrow(/spending categories/);
  });
});

describe('suggestForEvent', () => {
  it('offers payments inside the window in a category the occasion draws on', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000, 'Hampers');

    const candidates = await suggestForEvent(context.database, context.ws, id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ description: 'Hampers', amountBaseMinor: 1_500_000 });
  });

  it('leaves out what falls outside the window', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    await spend(context, context.gifts.id, `${MONTH}-02`, 1_500_000);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });

  it('leaves out a category the occasion does not draw on', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    await spend(context, context.food.id, `${MONTH}-20`, 900_000);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });

  it('stops offering a payment once it is tagged', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    const transactionId = await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000);
    await tagTransaction(context.database, context.ws, transactionId, id);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });

  it('offers nothing while the occasion draws on no category, rather than the whole month', async () => {
    const context = await household();
    const id = await lebaran(context);
    await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000);

    expect(await suggestForEvent(context.database, context.ws, id)).toEqual([]);
  });
});

describe('eventSheetFor', () => {
  it('puts what was planned beside what it came to', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    const transactionId = await spend(context, context.gifts.id, `${MONTH}-20`, 4_200_000);
    await tagTransaction(context.database, context.ws, transactionId, id);

    const sheet = await eventSheetFor(context.database, context.ws, id);
    expect(sheet.plannedMinor).toBe(3_000_000);
    expect(sheet.actualMinor).toBe(4_200_000);
    expect(sheet.overMinor).toBe(1_200_000);
  });

  it('flags spending in a category the plan never mentioned', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    const transactionId = await spend(context, context.food.id, `${MONTH}-20`, 900_000);
    await tagTransaction(context.database, context.ws, transactionId, id);

    const sheet = await eventSheetFor(context.database, context.ws, id);
    expect(sheet.unplannedMinor).toBe(900_000);
  });

  it('counts nothing that was never tagged', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    await spend(context, context.gifts.id, `${MONTH}-20`, 4_200_000);

    expect((await eventSheetFor(context.database, context.ws, id)).actualMinor).toBe(0);
  });
});

describe('the monthly budget', () => {
  it('leaves an occasion out of the caps but still takes it off what is left', async () => {
    const context = await household();
    await saveBudget(context.database, context.ws, { categoryAccountId: context.gifts.id, amountMinor: 1_000_000 });
    const id = await lebaran(context);
    const transactionId = await spend(context, context.gifts.id, `${MONTH}-20`, 5_000_000, 'Hampers');

    const before = await budgetSheetFor(context.database, context.ws, MONTH);
    expect(before.spendingActualMinor).toBe(5_000_000);
    expect(before.overCount).toBe(1);

    await tagTransaction(context.database, context.ws, transactionId, id);

    // The cap is no longer blown by money that was always meant to go, but the money is still gone.
    const after = await budgetSheetFor(context.database, context.ws, MONTH);
    expect(after.spendingActualMinor).toBe(0);
    expect(after.overCount).toBe(0);
    expect(after.eventSpendingMinor).toBe(5_000_000);
    expect(after.leftOverActualMinor).toBe(before.leftOverActualMinor);
  });
});

describe('editing tagged spending', () => {
  it('keeps the event tag when a purchase is corrected', async () => {
    const context = await household();
    const id = await lebaran(context);
    await setEventBudget(context.database, context.ws, id, { categoryAccountId: context.gifts.id, plannedMinor: 3_000_000 });
    const transactionId = await spend(context, context.gifts.id, `${MONTH}-20`, 1_500_000);
    await tagTransaction(context.database, context.ws, transactionId, id);

    await replaceTransaction(context.database, context.ws, transactionId, {
      occurredOn: `${MONTH}-21`,
      description: 'Hampers, corrected',
      lines: [
        { accountId: context.gifts.id, amountMinor: 1_800_000, currency: 'IDR' },
        { accountId: context.bca.id, amountMinor: -1_800_000, currency: 'IDR' },
      ],
    });

    expect((await eventSheetFor(context.database, context.ws, id)).actualMinor).toBe(1_800_000);
  });
});
