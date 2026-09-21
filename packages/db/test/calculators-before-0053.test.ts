import { afterEach, describe, expect, it } from 'vitest';
import { goalCalculators } from '../src/schema-budget';
import {
  createDatabase,
  createGoalFromCalculator,
  createWorkspace,
  getGoalCalculator,
  listGoals,
  migrate,
  MIGRATIONS,
  saveGoal,
  saveGoalCalculator,
  setStagePaid,
  upgradeCalculatorGoals,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

/**
 * A database whose migrations stopped before 0053: no goal_stage_terms. The blocked-update and recovery paths open
 * such databases, so every goal and calculator path has to work on one exactly as it did before stage terms existed.
 */
let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function oldDb(): Promise<{ database: Database; ws: WorkspaceContext }> {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version < 53));
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { database, ws };
}

const level = (id: string, name: string, startYear: number, untilYear: number) => ({
  id, name, startAge: null, untilAge: null, startYear, untilYear, returnBps: null,
  fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }],
});
const plan = (...levels: ReturnType<typeof level>[]) => ({ version: 2 as const, birthday: null, feeInflationBps: 1000, levels });

describe('a database stopped before 0053', () => {
  it('saves and lists goals, typed and re-typed, with no stage return', async () => {
    const { database, ws } = await oldDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Holiday', kind: 'holiday', growthBps: 300, returnBps: 400,
      stages: [{ name: 'Holiday', targetMinor: 10_000_000, targetMonths: null, dueOn: '2027-06-01' }],
    });
    const [goal] = await listGoals(database, ws);
    expect(goal!.stages[0]).toMatchObject({ targetMinor: 10_000_000, returnBps: null });

    await saveGoal(database, ws, { id: goalId, name: 'Holiday', kind: 'holiday', growthBps: 300, returnBps: 400, stages: [{ ...goal!.stages[0]!, targetMinor: 12_000_000 }] });
    expect((await listGoals(database, ws))[0]!.stages).toMatchObject([{ id: goal!.stages[0]!.id, targetMinor: 12_000_000, returnBps: null }]);
  });

  it('works an education goal out, and keeps a paid year by position when it is worked out again', async () => {
    const { database, ws } = await oldDb();
    const goalId = await createGoalFromCalculator(database, ws, { name: 'Aisha', kind: 'education', today: '2026-01-01', inputs: plan(level('pre', 'Preschool', 2027, 2029)) });
    const before = (await listGoals(database, ws))[0]!.stages;
    expect(before.map((stage) => [stage.dueOn, stage.targetMinor, stage.returnBps])).toEqual([['2027-01-01', 20_000_000, null], ['2028-01-01', 20_000_000, null]]);
    await setStagePaid(database, ws, before[0]!.id, '2027-01-05');

    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: plan({ ...level('pre', 'Preschool', 2027, 2029), fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 25_000_000, charged: 'yearly' }] }) });
    const after = (await listGoals(database, ws))[0]!.stages;
    expect(after.map((stage) => stage.id)).toEqual(before.map((stage) => stage.id));
    expect(after.map((stage) => [stage.targetMinor, stage.paidOn])).toEqual([[25_000_000, '2027-01-05'], [25_000_000, null]]);
  });

  it('upgrades an old working once, and leaves a v2 education working alone on every open after', async () => {
    const { database, ws } = await oldDb();
    const goalId = await saveGoal(database, ws, {
      name: 'University', kind: 'education', growthBps: 1000, returnBps: 1000, derived: true,
      stages: [0, 1].map((i) => ({ name: `Year ${i + 1}`, targetMinor: Math.round(100_000_000 * 1.1 ** (10 + i)), targetMonths: null, dueOn: `${2036 + i}-09-13` })),
    });
    await database.db.insert(goalCalculators).values({
      goalId, workspaceId: ws.workspaceId, kind: 'education', computedMinor: 0, computedAt: '2026-09-13T08:00:00.000Z',
      inputsJson: JSON.stringify({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 2, feeInflationBps: 1000 }),
    });

    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([goalId]);
    expect((await listGoals(database, ws))[0]!.stages.map((stage) => stage.targetMinor)).toEqual([100_000_000, 100_000_000]);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ version: 2 });
    // The stages have nowhere to keep a return, so the working's returns are no difference: nothing to do.
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
    expect(await upgradeCalculatorGoals(database, ws, '2031-09-21')).toEqual([]);
  });
});
