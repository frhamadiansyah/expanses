import { savingPlanFor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { createGoalFromCalculator, getGoalCalculator, goalPlansFor, listGoals, saveGoalCalculator, setEmergencyOwnTarget } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';
const working = { months: 12, household: 'children' as const, income: 'salaried' as const, monthlyOutgoingMinor: 17_000_000, horizonMonths: 12, returnBps: 350 };

describe('an emergency working with a target of its own', () => {
  it('without it, the target is months times the outgoing, as before', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: working, today: TODAY });
    expect((await goalPlansFor(database, ws, TODAY)).plans.find((p) => p.goalId === goalId)!.totalTargetMinor).toBe(204_000_000);
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)!.stages[0]).toMatchObject({ targetMonths: 12, targetMinor: null });
  });

  it('with it, the stage target is exactly that amount and the working keeps the rest', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: { ...working, targetMinor: 250_000_000 }, today: TODAY });
    const plan = (await goalPlansFor(database, ws, TODAY)).plans.find((p) => p.goalId === goalId)!;
    expect(plan.totalTargetMinor).toBe(250_000_000);
    // The monthly need is worked out for the typed amount over the horizon at the return.
    const expected = savingPlanFor({ targetMinor: 250_000_000, alreadySavedMinor: 0, returnBps: 350, months: 12 }).monthlyMinor;
    expect(expected).toBeGreaterThan(Math.round(204_000_000 / 12));
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)!.stages[0]).toMatchObject({ targetMonths: null, targetMinor: 250_000_000 });
    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ inputs: { months: 12, household: 'children', monthlyOutgoingMinor: 17_000_000, targetMinor: 250_000_000 } });
  });

  it('round trips: saving the working again without it goes back to months', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: { ...working, targetMinor: 250_000_000 }, today: TODAY });
    await saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: working, today: TODAY });
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).not.toHaveProperty('targetMinor');
    expect((await goalPlansFor(database, ws, TODAY)).plans.find((p) => p.goalId === goalId)!.totalTargetMinor).toBe(204_000_000);
  });

  it('refuses a target that is not an amount above zero', async () => {
    const { database, ws } = await setupDb();
    const input = (targetMinor: number) => ({ name: 'Emergency fund', kind: 'emergency' as const, inputs: { ...working, targetMinor }, today: TODAY });
    await expect(createGoalFromCalculator(database, ws, input(0))).rejects.toThrow(/above zero/);
    await expect(createGoalFromCalculator(database, ws, input(1.5))).rejects.toThrow(/above zero/);
    await expect(createGoalFromCalculator(database, ws, input(-5))).rejects.toThrow(/above zero/);
  });

  it('setEmergencyOwnTarget sets and clears it on the working without touching the stage dates', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: working, today: TODAY });
    const due = (await listGoals(database, ws)).find((g) => g.id === goalId)!.stages[0]!.dueOn;
    await setEmergencyOwnTarget(database, ws, goalId, { targetMinor: 250_000_000 });
    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ inputs: { targetMinor: 250_000_000, months: 12 } });
    await setEmergencyOwnTarget(database, ws, goalId, { months: 6 });
    const cleared = await getGoalCalculator(database, ws, goalId);
    expect(cleared!.inputs).not.toHaveProperty('targetMinor');
    expect(cleared!.inputs).toMatchObject({ months: 6 });
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)!.stages[0]!.dueOn).toBe(due);
    await expect(setEmergencyOwnTarget(database, ws, goalId, { targetMinor: 0 })).rejects.toThrow(/above zero/);
  });
});
