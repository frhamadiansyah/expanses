import { describe, expect, it } from 'vitest';
import { createGoalFromCalculator, getGoalCalculator, goalPlansFor, listGoals, saveGoalCalculator } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';

describe('an emergency working with a fixed monthly outgoing', () => {
  it('sizes the goal as months times the typed figure, with no spending on record', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, {
      name: 'Emergency fund',
      kind: 'emergency',
      inputs: { months: 6, monthlyOutgoingMinor: 10_000_000 },
      today: TODAY,
    });
    const plan = (await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === goalId)!;
    expect(plan.totalTargetMinor).toBe(60_000_000);
    // Still stated in months, so the card can say "6 months of spending".
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)!.stages[0]).toMatchObject({ targetMonths: 6, targetMinor: null });
  });

  it('moves the target when the figure is changed on a saved goal', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: { months: 6, monthlyOutgoingMinor: 10_000_000 }, today: TODAY });
    await saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: { months: 6, monthlyOutgoingMinor: 12_000_000 }, today: TODAY });
    expect((await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === goalId)!.totalTargetMinor).toBe(72_000_000);
    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ inputs: { monthlyOutgoingMinor: 12_000_000 } });
  });

  it('keeps an old working as it was: no figure, so the target follows spending', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: { months: 6 }, today: TODAY });
    expect((await goalPlansFor(database, ws, TODAY)).plans.find((row) => row.goalId === goalId)!.totalTargetMinor).toBe(0);
  });

  it('dates the goal by the horizon and writes the return when the working names them', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, {
      name: 'Emergency fund',
      kind: 'emergency',
      inputs: { months: 3, monthlyOutgoingMinor: 5_000_000, horizonMonths: 12, returnBps: 350 },
      today: '2026-01-31',
    });
    const goal = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(goal.stages[0]!.dueOn).toBe('2027-01-31');
    expect(goal.returnBps).toBe(350);
    const short = await createGoalFromCalculator(database, ws, { name: 'Second', kind: 'emergency', inputs: { months: 3, horizonMonths: 1 }, today: '2026-01-31' });
    expect((await listGoals(database, ws)).find((g) => g.id === short)!.stages[0]!.dueOn).toBe('2026-02-28');
  });

  it('refuses a figure that is not an amount above zero, and a horizon below a month', async () => {
    const { database, ws } = await setupDb();
    const input = (inputs: object) => ({ name: 'Emergency fund', kind: 'emergency' as const, inputs: { months: 6, ...inputs }, today: TODAY });
    await expect(createGoalFromCalculator(database, ws, input({ monthlyOutgoingMinor: 0 }))).rejects.toThrow(/above zero/);
    await expect(createGoalFromCalculator(database, ws, input({ monthlyOutgoingMinor: 1.5 }))).rejects.toThrow(/above zero/);
    await expect(createGoalFromCalculator(database, ws, input({ horizonMonths: 0 }))).rejects.toThrow(/months/);
    await expect(createGoalFromCalculator(database, ws, input({ returnBps: -1 }))).rejects.toThrow(/return/);
  });
});
