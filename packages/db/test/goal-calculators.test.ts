import { describe, expect, it } from 'vitest';
import type { EducationLevel, EducationPlanInputs } from '@expanses/core';
import { sql } from 'drizzle-orm';
import {
  clearGoalCalculator,
  createAccount,
  goalPlansFor,
  saveEarmark,
  setStagePaid,
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

    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toEqual({ ...inputs, version: 2 });
  });

  it('works the figure out again when an assumption changes', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Retirement', 'retirement');
    const inputs = { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 500, returnInRetirementBps: 800 };
    await saveGoalCalculator(database, ws, { goalId, kind: 'retirement', inputs, today: TODAY });
    const before = (await stagesOf(database, ws, goalId))[0]!.targetMinor!;

    await saveGoalCalculator(database, ws, { goalId, kind: 'retirement', inputs: { ...inputs, yearsInRetirement: 30 }, today: TODAY });

    expect((await stagesOf(database, ws, goalId))[0]!.targetMinor!).toBeGreaterThan(before);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toEqual({ ...inputs, yearsInRetirement: 30, version: 2 });
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

const levels = (extra: EducationLevel[] = []): EducationPlanInputs => ({
  version: 2 as const, birthday: null, feeInflationBps: 1200,
  levels: [
    { id: 'primary', name: 'Primary School', startAge: null, untilAge: null, startYear: 2032, untilYear: 2038, returnBps: null,
      fees: [{ id: 'e', name: 'Enrollment', amountTodayMinor: 45_000_000, charged: 'once' as const }, { id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }] },
    ...extra,
  ],
});

describe('today’s money', () => {
  it('stores education years at today’s prices and the fee inflation as the goal’s growth, so the plan inflates once', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels(), today: '2026-01-01' });

    const row = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(row.growthBps).toBe(1200);
    expect(row.stages.map((stage) => stage.targetMinor)).toEqual([65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]);
    // Inflated once: 409.180.906. Stored inflated and inflated again, it would be over 1,2 milyar.
    expect((await goalPlansFor(database, ws, '2026-01-01')).plans.find((p) => p.goalId === goalId)!.totalTargetMinor).toBe(409_180_906);
    expect(await getGoalCalculator(database, ws, goalId)).toMatchObject({ computedMinor: 165_000_000, inputs: levels() });
  });

  it('stores an education working from before levels as levels', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'School fees', 'education');
    await saveGoalCalculator(database, ws, {
      goalId, kind: 'education', today: TODAY,
      inputs: { feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 },
    });
    const row = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(row.growthBps).toBe(1000);
    expect(row.stages.map((stage) => [stage.dueOn, stage.targetMinor])).toEqual([
      ['2036-01-01', 100_000_000], ['2037-01-01', 100_000_000], ['2038-01-01', 100_000_000], ['2039-01-01', 100_000_000],
    ]);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ version: 2, levels: [{ startYear: 2036, untilYear: 2040 }] });
  });

  it('stores retirement as today’s pot, with inflation as growth and 10% while saving', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, {
      name: 'Retirement', kind: 'retirement', today: '2026-09-21',
      inputs: { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 },
    });
    const row = (await listGoals(database, ws)).find((g) => g.id === goalId)!;
    expect(row).toMatchObject({ growthBps: 350, returnBps: 1000 });
    expect(row.stages[0]).toMatchObject({ targetMinor: 2_070_575_495, dueOn: '2046-09-21' });
    expect((await goalPlansFor(database, ws, '2026-09-21')).plans[0]!.totalTargetMinor).toBe(4_120_008_061);
  });

  it('saves retirement’s return while saving onto an existing goal', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Retirement', 'retirement');
    const inputs = { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 };
    await saveGoalCalculator(database, ws, { goalId, kind: 'retirement', inputs, today: '2026-09-21' });
    expect((await listGoals(database, ws))[0]).toMatchObject({ growthBps: 350, returnBps: 1000 });
    await saveGoalCalculator(database, ws, { goalId, kind: 'retirement', inputs: { ...inputs, returnBeforeBps: 700 }, today: '2026-09-21' });
    expect((await listGoals(database, ws))[0]).toMatchObject({ growthBps: 350, returnBps: 700 });
  });

  it('gives an emergency fund no growth: it follows spending instead', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: { months: 6 }, today: TODAY });
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)).toMatchObject({ growthBps: 0, returnBps: 200 });
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toEqual({ months: 6, version: 2 });
  });

  it('starts an education goal at the band for when its first level begins', async () => {
    const { database, ws } = await setupDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Aisha', kind: 'education', inputs: levels(), today: '2030-01-01' });
    // 24 months to 2032: the 1–3 years band, not the 8% a far-off level gets.
    expect((await listGoals(database, ws)).find((g) => g.id === goalId)).toMatchObject({ growthBps: 1200, returnBps: 500 });
  });

  it('stores each level’s return on its stages', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels([{ ...levels().levels[0]!, id: 'pre', name: 'Preschool', startYear: 2027, untilYear: 2028, returnBps: 450 }]), today: '2026-01-01' });
    const stages = (await listGoals(database, ws)).find((g) => g.id === goalId)!.stages;
    expect(stages.find((stage) => stage.name === 'Preschool')!.returnBps).toBe(450);
    expect(stages.find((stage) => stage.name === 'Primary School · year 1')!.returnBps).toBe(800);
  });

  it('writes nothing when the working is refused', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels(), today: '2026-01-01' });
    const before = await listGoals(database, ws);
    await expect(
      saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: { ...levels(), levels: [{ ...levels().levels[0]!, untilYear: 2032 }] }, today: '2026-01-01' }),
    ).rejects.toThrow(/end after it starts/);
    expect(await listGoals(database, ws)).toEqual(before);
  });
});

describe('adding a level', () => {
  it('raises the target and keeps what is set aside, the stages already there and their paid marks', async () => {
    const { database, ws } = await setupDb();
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels(), today: '2026-01-01' });
    await saveEarmark(database, ws, { goalId, accountId: bank.id, amountMinor: 10_000_000 });
    const before = (await listGoals(database, ws)).find((g) => g.id === goalId)!.stages;
    await setStagePaid(database, ws, before[0]!.id, '2026-01-02');

    await saveGoalCalculator(database, ws, {
      goalId, kind: 'education', today: '2026-01-01',
      inputs: levels([{ ...levels().levels[0]!, id: 'middle', name: 'Middle School', startYear: 2038, untilYear: 2041, fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 30_000_000, charged: 'yearly' }] }]),
    });

    const after = (await listGoals(database, ws)).find((g) => g.id === goalId)!.stages;
    expect(after.slice(0, before.length).map((stage) => stage.id)).toEqual(before.map((stage) => stage.id));
    expect(after[0]!.paidOn).toBe('2026-01-02');
    expect(after.reduce((total, stage) => total + stage.targetMinor!, 0)).toBe(165_000_000 + 90_000_000);
    expect((await goalPlansFor(database, ws, '2026-01-01')).plans.find((p) => p.goalId === goalId)!.currentMinor).toBe(10_000_000);
  });
});

describe('removing a level', () => {
  const twoLevels = () => levels([{ ...levels().levels[0]!, id: 'pre', name: 'Preschool', startYear: 2027, untilYear: 2029, fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 10_000_000, charged: 'yearly' }] }]);

  it('drops its unpaid years but keeps a paid one, and finds it again by key when the level comes back', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: twoLevels(), today: '2026-01-01' });
    const paid = (await stagesOf(database, ws, goalId)).find((stage) => stage.name === 'Preschool · year 1')!;
    await setStagePaid(database, ws, paid.id, '2027-01-05');

    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels(), today: '2026-01-01' });
    const stages = await stagesOf(database, ws, goalId);
    expect(stages.map((stage) => stage.name)).toEqual(['Preschool · year 1', ...Array.from({ length: 6 }, (_, i) => `Primary School · year ${i + 1}`)]);
    expect(stages[0]).toMatchObject({ id: paid.id, paidOn: '2027-01-05', targetMinor: 10_000_000 });
    // The working itself counts only what it asked for.
    expect((await getGoalCalculator(database, ws, goalId))!.computedMinor).toBe(165_000_000);

    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: twoLevels(), today: '2026-01-01' });
    const back = await stagesOf(database, ws, goalId);
    expect(back.filter((stage) => stage.name.startsWith('Preschool')).map((stage) => stage.id)[0]).toBe(paid.id);
    expect(back).toHaveLength(8);
  });

  it('keeps a year that money was drawn against', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: twoLevels(), today: '2026-01-01' });
    const drawn = (await stagesOf(database, ws, goalId)).find((stage) => stage.name === 'Preschool · year 2')!;
    // The set-aside branch's table, as its migration makes it: a draw names the stage it paid.
    await database.execScript('CREATE TABLE goal_draws (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, goal_id TEXT NOT NULL, stage_id TEXT)');
    await database.db.run(sql`INSERT INTO goal_draws (id, workspace_id, goal_id, stage_id) VALUES ('d1', ${ws.workspaceId}, ${goalId}, ${drawn.id})`);

    await saveGoalCalculator(database, ws, { goalId, kind: 'education', inputs: levels(), today: '2026-01-01' });
    const stages = await stagesOf(database, ws, goalId);
    expect(stages.map((stage) => stage.id)).toContain(drawn.id);
    expect(stages.filter((stage) => stage.name.startsWith('Preschool'))).toHaveLength(1);
  });
});

describe('matching a re-work to the stages already there', () => {
  const level = (id: string, name: string, startYear: number) => ({
    id, name, startAge: null, untilAge: null, startYear, untilYear: startYear + 2, returnBps: null,
    fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }],
  });
  const plan = (...levels: ReturnType<typeof level>[]) => ({ version: 2 as const, birthday: null, feeInflationBps: 1000, levels });

  it('follows the level’s key, not the position, even when the count is the same', async () => {
    const { database, ws } = await setupDb();
    const goalId = await goal(database, ws, 'Aisha', 'education');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: plan(level('pre', 'Preschool', 2027), level('primary', 'Primary', 2032)) });
    const before = await stagesOf(database, ws, goalId);
    const paid = before.find((stage) => stage.name === 'Preschool · year 1')!;
    const primaryYear1 = before.find((stage) => stage.name === 'Primary · year 1')!;
    await setStagePaid(database, ws, paid.id, '2027-01-05');

    // Both levels renamed, and the first moved past the second: four years before, four after, nothing in common
    // but the keys. By position, Preschool's paid mark would land on 2032.
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: plan(level('pre', 'Kindergarten', 2036), level('primary', 'Primary School', 2032)) });
    const after = await stagesOf(database, ws, goalId);
    expect(after).toHaveLength(4);
    expect(after.find((stage) => stage.id === paid.id)).toMatchObject({ name: 'Kindergarten · year 1', dueOn: '2036-01-01', paidOn: '2027-01-05' });
    expect(after.find((stage) => stage.id === primaryYear1.id)).toMatchObject({ name: 'Primary School · year 1', dueOn: '2032-01-01', paidOn: null });
  });
});

