import { describe, expect, it } from 'vitest';
import {
  clearGoalCalculator,
  createGoalFromCalculator,
  getGoalCalculator,
  listGoals,
  saveGoal,
  saveGoalCalculator,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';

async function goal(database: Database, ws: WorkspaceContext, name: string, kind: 'retirement' | 'education' | 'emergency') {
  return saveGoal(database, ws, {
    name,
    kind,
    growthBps: 400,
    returnBps: 900,
    stages: [{ name: 'Placeholder', targetMinor: 1_000_000, targetMonths: null, dueOn: '2030-01-01' }],
  });
}

const stagesOf = async (database: Database, ws: WorkspaceContext, goalId: string) =>
  (await listGoals(database, ws)).find((row) => row.id === goalId)!.stages;

describe('a derived target', () => {
  it('replaces the goal stages with what the calculator worked out', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Retirement', 'retirement');

    await saveGoalCalculator(database, ws, {
      goalId,
      kind: 'retirement',
      inputs: { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 500, returnInRetirementBps: 800 },
      today: TODAY,
    });

    const stages = await stagesOf(database, ws, goalId);
    expect(stages).toHaveLength(1);
    expect(stages[0]!.targetMinor).toBeGreaterThan(0);
    expect(stages[0]!.name).not.toBe('Placeholder');
  });

  it('gives education one stage a year, each dearer than the last', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'School fees', 'education');

    await saveGoalCalculator(database, ws, {
      goalId,
      kind: 'education',
      inputs: { feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 },
      today: TODAY,
    });

    const stages = await stagesOf(database, ws, goalId);
    expect(stages).toHaveLength(4);
    expect(stages[3]!.targetMinor!).toBeGreaterThan(stages[0]!.targetMinor!);
  });

  it('counts months rather than an amount for an emergency fund', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Emergency fund', 'emergency');

    await saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: { months: 6 }, today: TODAY });

    const stages = await stagesOf(database, ws, goalId);
    expect(stages[0]).toMatchObject({ targetMonths: 6, targetMinor: null });
  });

  it('remembers the two answers and the base beside the months', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Emergency fund', 'emergency');
    const inputs = { months: 24, household: 'children', income: 'irregular', base: 'all' } as const;
    await saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs, today: TODAY });
    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ inputs });
    expect((await stagesOf(database, ws, goalId))[0]).toMatchObject({ targetMonths: 24, targetMinor: null });
  });

  it('refuses an answer it does not know', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Emergency fund', 'emergency');
    await expect(saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: { months: 6, household: 'big' } as never, today: TODAY })).rejects.toThrow(/household/);
    await expect(saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: { months: 6, base: 'some' } as never, today: TODAY })).rejects.toThrow(/essential or all/);
  });

  it('remembers the inputs, so the working can be reopened', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Retirement', 'retirement');
    const inputs = { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 500, returnInRetirementBps: 800 };

    await saveGoalCalculator(database, ws, { goalId, kind: 'retirement', inputs, today: TODAY });

    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ kind: 'retirement', inputs });
  });

  it('works the figure out again when an assumption changes', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Retirement', 'retirement');
    const inputs = { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 500, returnInRetirementBps: 800 };
    await saveGoalCalculator(database, ws, { goalId, kind: 'retirement', inputs, today: TODAY });
    const before = (await stagesOf(database, ws, goalId))[0]!.targetMinor!;

    await saveGoalCalculator(database, ws, { goalId, kind: 'retirement', inputs: { ...inputs, yearsInRetirement: 30 }, today: TODAY });

    expect((await stagesOf(database, ws, goalId))[0]!.targetMinor!).toBeGreaterThan(before);
  });
});

describe('breaking the link', () => {
  it('forgets the calculator when the amount is typed by hand', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Retirement', 'retirement');
    await saveGoalCalculator(database, ws, {
      goalId,
      kind: 'retirement',
      inputs: { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 500, returnInRetirementBps: 800 },
      today: TODAY,
    });

    await saveGoal(database, ws, {
      id: goalId,
      name: 'Retirement',
      kind: 'retirement',
      growthBps: 400,
      returnBps: 900,
      stages: [{ name: 'Typed by hand', targetMinor: 3_000_000_000, targetMonths: null, dueOn: '2046-09-13' }],
    });

    expect(await getGoalCalculator(database, ws, goalId)).toBeNull();
  });

  it('can be broken on purpose, without touching the stages', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Emergency fund', 'emergency');
    await saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs: { months: 6 }, today: TODAY });

    await clearGoalCalculator(database, ws, goalId);

    expect(await getGoalCalculator(database, ws, goalId)).toBeNull();
    expect(await stagesOf(database, ws, goalId)).toHaveLength(1);
  });

  it('says nothing for a goal that was never derived', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Hajj', 'education');

    expect(await getGoalCalculator(database, ws, goalId)).toBeNull();
  });
});

describe('starting a goal from a calculator', () => {
  it('creates the goal and derives it in one go', async () => {
    const { database, ws } = await setupDb();

    const goalId = await createGoalFromCalculator(database, ws, {
      name: 'Dana hari tua',
      kind: 'retirement',
      inputs: { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 500, returnInRetirementBps: 800 },
      today: TODAY,
    });

    const goal = (await listGoals(database, ws)).find((row) => row.id === goalId)!;
    expect(goal.name).toBe('Dana hari tua');
    expect(goal.stages).toHaveLength(1);
    expect(goal.stages[0]!.targetMinor).toBeGreaterThan(0);
    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ kind: 'retirement' });
  });

  it('leaves no half-made goal behind when the figures are refused', async () => {
    const { database, ws } = await setupDb();

    await expect(
      createGoalFromCalculator(database, ws, {
        name: 'Nonsense',
        kind: 'retirement',
        inputs: { annualSpendTodayMinor: 0, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 500, returnInRetirementBps: 800 },
        today: TODAY,
      }),
    ).rejects.toThrow();

    expect(await listGoals(database, ws)).toHaveLength(0);
  });
});
