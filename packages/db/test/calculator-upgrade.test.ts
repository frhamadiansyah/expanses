import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { goalCalculators } from '../src/schema-budget';
import { archiveGoal, contextOf, createWorkspace, getGoalCalculator, listGoals, listWorkspaces, saveGoal, saveGoalCalculator, setStagePaid, upgradeCalculatorGoals } from '../src/index';
import { setupDb } from './helpers';

/** A goal as the old calculator left it: stages already inflated, growth still applied on top. */
async function oldEducationGoal(database: Awaited<ReturnType<typeof setupDb>>['database'], ws: Awaited<ReturnType<typeof setupDb>>['ws']) {
  const goalId = await saveGoal(database, ws, {
    name: 'University', kind: 'education', growthBps: 1000, returnBps: 1000, derived: true,
    stages: [0, 1, 2, 3].map((i) => ({ name: `Year ${i + 1}`, targetMinor: Math.round(100_000_000 * 1.1 ** (10 + i)), targetMonths: null, dueOn: `${2036 + i}-09-13` })),
  });
  await database.db.insert(goalCalculators).values({
    goalId, workspaceId: ws.workspaceId, kind: 'education', computedMinor: 0, computedAt: '2026-09-13T08:00:00.000Z',
    inputsJson: JSON.stringify({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 4, feeInflationBps: 1000 }),
  });
  return goalId;
}

describe('upgrading an old working', () => {
  it('re-states the stages in today’s money, keeps their ids and paid marks, and is done once', async () => {
    const { database, ws } = await setupDb();
    const goalId = await oldEducationGoal(database, ws);
    const before = (await listGoals(database, ws))[0]!.stages;
    await setStagePaid(database, ws, before[0]!.id, '2026-09-14');

    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([goalId]);
    const after = (await listGoals(database, ws))[0]!;
    expect(after.growthBps).toBe(1000);
    expect(after.stages.map((stage) => stage.targetMinor)).toEqual([100_000_000, 100_000_000, 100_000_000, 100_000_000]);
    expect(after.stages.map((stage) => stage.id)).toEqual(before.map((stage) => stage.id));
    expect(after.stages[0]!.paidOn).toBe('2026-09-14');
    // A v1 course becomes calendar years, so its years fall on 1 January (Q7) — the only date that moves, and
    // it moves because v2 cannot say "13 September" without a birthday. Needs-human item in the ledger.
    expect(after.stages.map((stage) => stage.dueOn)).toEqual(['2036-01-01', '2037-01-01', '2038-01-01', '2039-01-01']);
    // Its working keeps the day it was first worked out.
    expect((await getGoalCalculator(database, ws, goalId))!.computedAt).toBe('2026-09-13T08:00:00.000Z');
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ version: 2 });

    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
  });

  it('keeps an education goal’s own return: its stages carry it, never a band (spec §8)', async () => {
    const { database, ws } = await setupDb();
    const goalId = await oldEducationGoal(database, ws);
    await upgradeCalculatorGoals(database, ws, '2026-09-21');
    const goal = (await listGoals(database, ws))[0]!;
    expect(goal.returnBps).toBe(1000);
    expect(goal.stages.map((stage) => stage.returnBps)).toEqual([1000, 1000, 1000, 1000]);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ levels: [{ returnBps: 1000 }] });
  });

  it('keeps a retirement goal’s own return as the return while saving', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Retirement', kind: 'retirement', growthBps: 400, returnBps: 900, derived: true,
      stages: [{ name: 'Retirement fund', targetMinor: 4_120_008_061, targetMonths: null, dueOn: '2046-09-21' }],
    });
    await database.db.insert(goalCalculators).values({
      goalId, workspaceId: ws.workspaceId, kind: 'retirement', computedMinor: 4_120_008_061, computedAt: '2026-09-21T00:00:00.000Z',
      inputsJson: JSON.stringify({ annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 }),
    });
    await upgradeCalculatorGoals(database, ws, '2026-09-21');
    expect((await listGoals(database, ws))[0]).toMatchObject({ growthBps: 350, returnBps: 900, stages: [{ targetMinor: 2_070_575_495, dueOn: '2046-09-21' }] });
  });

  it('only stamps a working whose figures come out the same', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 200, derived: true,
      stages: [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2028-09-13' }],
    });
    await database.db.insert(goalCalculators).values({ goalId, workspaceId: ws.workspaceId, kind: 'emergency', computedMinor: 0, computedAt: '2026-09-13T00:00:00.000Z', inputsJson: JSON.stringify({ months: 6 }) });
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ version: 2 });
  });

  it('re-reads the band for a level whose return was never typed, and leaves a typed one alone (Part 2 Q1)', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Aisha', kind: 'education', growthBps: 1000, returnBps: 800,
      stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2032-01-01' }],
    });
    const fee = [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }];
    await saveGoalCalculator(database, ws, {
      goalId, kind: 'education', today: '2026-01-01',
      inputs: { version: 2, birthday: null, feeInflationBps: 1000, levels: [
        { id: 'primary', name: 'Primary', startAge: null, untilAge: null, startYear: 2032, untilYear: 2033, returnBps: null, fees: fee },
        { id: 'middle', name: 'Middle', startAge: null, untilAge: null, startYear: 2032, untilYear: 2033, returnBps: 450, fees: fee },
      ] },
    });
    const returns = async () => Object.fromEntries((await listGoals(database, ws))[0]!.stages.map((stage) => [stage.name, stage.returnBps]));
    expect(await returns()).toEqual({ Primary: 800, Middle: 450 }); // 72 months away: the > 5 years band

    // Two years on, 48 months away: 3–5 years, 6%. The typed 4,5% stays.
    expect(await upgradeCalculatorGoals(database, ws, '2028-01-01')).toEqual([goalId]);
    expect(await returns()).toEqual({ Primary: 600, Middle: 450 });
    // Same band on the next open: nothing to do.
    expect(await upgradeCalculatorGoals(database, ws, '2028-02-01')).toEqual([]);
  });

  it('never touches a goal whose target was typed by hand', async () => {
    const { database, ws } = await setupDb();
    const goalId = await oldEducationGoal(database, ws);
    const stages = (await listGoals(database, ws))[0]!.stages;
    // Typing by hand breaks the link: saveGoal without `derived` removes the calculator row.
    await saveGoal(database, ws, { id: goalId, name: 'University', kind: 'education', growthBps: 1000, returnBps: 1000, stages: stages.map((stage) => ({ ...stage, targetMinor: 300_000_000 })) });
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
    expect((await listGoals(database, ws))[0]!.stages.every((stage) => stage.targetMinor === 300_000_000)).toBe(true);
  });

  it('leaves a working the rules now refuse exactly as it is', async () => {
    const { database, ws } = await setupDb();
    const goalId = await oldEducationGoal(database, ws);
    await database.db.update(goalCalculators).set({ inputsJson: JSON.stringify({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 0, feeInflationBps: 1000 }) });
    const before = await listGoals(database, ws);
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
    expect(await listGoals(database, ws)).toEqual(before);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).not.toHaveProperty('version');
  });

  it('does not keep re-working a goal for a paid year its working no longer asks for', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, { name: 'Aisha', kind: 'education', growthBps: 1000, returnBps: 800, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2032-01-01' }] });
    const level = (id: string, startYear: number) => ({
      id, name: id, startAge: null, untilAge: null, startYear, untilYear: startYear + 1, returnBps: null,
      fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }],
    });
    const inputs = (...levels: ReturnType<typeof level>[]) => ({ version: 2 as const, birthday: null, feeInflationBps: 1000, levels });
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: inputs(level('pre', 2027), level('primary', 2040)) });
    await setStagePaid(database, ws, (await listGoals(database, ws))[0]!.stages[0]!.id, '2027-01-02');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: inputs(level('primary', 2040)) });
    expect((await listGoals(database, ws))[0]!.stages).toHaveLength(2);
    expect(await upgradeCalculatorGoals(database, ws, '2026-02-01')).toEqual([]);
  });

  it('drops a year its working no longer asks for once it is no longer paid', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, { name: 'Aisha', kind: 'education', growthBps: 1000, returnBps: 800, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2032-01-01' }] });
    const level = (id: string, startYear: number) => ({
      id, name: id, startAge: null, untilAge: null, startYear, untilYear: startYear + 1, returnBps: null,
      fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }],
    });
    const inputs = (...levels: ReturnType<typeof level>[]) => ({ version: 2 as const, birthday: null, feeInflationBps: 1000, levels });
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: inputs(level('pre', 2027), level('primary', 2040)) });
    const paid = (await listGoals(database, ws))[0]!.stages[0]!;
    await setStagePaid(database, ws, paid.id, '2027-01-02');
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: inputs(level('primary', 2040)) });
    await setStagePaid(database, ws, paid.id, null);

    expect(await upgradeCalculatorGoals(database, ws, '2026-02-01')).toEqual([goalId]);
    expect((await listGoals(database, ws))[0]!.stages.map((stage) => stage.name)).toEqual(['primary']);
  });

  it('never visits a retirement or emergency working already in today’s money: their dates count from the day they were done', async () => {
    const { database, ws } = await setupDb();
    const retirement = await saveGoal(database, ws, { name: 'Retirement', kind: 'retirement', growthBps: 350, returnBps: 1000, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2046-01-01' }] });
    const emergency = await saveGoal(database, ws, { name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 200, stages: [{ name: 'x', targetMinor: null, targetMonths: 3, dueOn: '2028-01-01' }] });
    await saveGoalCalculator(database, ws, {
      goalId: retirement, kind: 'retirement', today: '2026-09-21',
      inputs: { version: 2, annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnBeforeBps: 1000, returnInRetirementBps: 500 },
    });
    await saveGoalCalculator(database, ws, { goalId: emergency, kind: 'emergency', today: '2026-09-21', inputs: { months: 6 } });
    const dates = async () => (await listGoals(database, ws)).map((goal) => [goal.name, goal.stages.map((stage) => stage.dueOn)]);
    const before = await dates();
    expect(before).toEqual([['Retirement', ['2046-09-21']], ['Emergency fund', ['2028-09-21']]]);

    expect(await upgradeCalculatorGoals(database, ws, '2026-10-21')).toEqual([]);
    expect(await dates()).toEqual(before);
  });

  it('upgrades a goal that is archived too, so it is right if it comes back', async () => {
    const { database, ws } = await setupDb();
    const goalId = await oldEducationGoal(database, ws);
    await archiveGoal(database, ws, goalId);
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([goalId]);
    expect((await listGoals(database, ws, { includeArchived: true }))[0]!.stages.map((stage) => stage.targetMinor)).toEqual([100_000_000, 100_000_000, 100_000_000, 100_000_000]);
  });

  it('does not keep re-working a goal for a year drawn against that its working no longer asks for', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, { name: 'Aisha', kind: 'education', growthBps: 1000, returnBps: 800, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2032-01-01' }] });
    const level = (id: string, startYear: number) => ({
      id, name: id, startAge: null, untilAge: null, startYear, untilYear: startYear + 1, returnBps: null,
      fees: [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }],
    });
    const inputs = (...levels: ReturnType<typeof level>[]) => ({ version: 2 as const, birthday: null, feeInflationBps: 1000, levels });
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: inputs(level('pre', 2027), level('primary', 2040)) });
    const drawn = (await listGoals(database, ws))[0]!.stages[0]!;
    // The set-aside branch's table, as its migration makes it: a draw names the stage it paid.
    // 0050's own table (set-aside): a spend's draw naming the stage it paid.
    await database.db.run(sql`INSERT INTO goal_draws (id, workspace_id, transaction_id, goal_id, account_id, intent, amount_minor, stage_id, occurred_on, created_at) VALUES ('d1', ${ws.workspaceId}, 'tx', ${goalId}, 'account', 'spend', 1, ${drawn.id}, '2026-09-19', '2026-09-19T00:00:00.000Z')`);
    await saveGoalCalculator(database, ws, { goalId, kind: 'education', today: '2026-01-01', inputs: inputs(level('primary', 2040)) });
    expect((await listGoals(database, ws))[0]!.stages.map((stage) => stage.id)).toContain(drawn.id);
    expect(await upgradeCalculatorGoals(database, ws, '2026-02-01')).toEqual([]);
  });
});

/**
 * v1 stamped computed_at in UTC and dated its stages from the local day. 01:00 WIB on 1 January 2026 is
 * 18:00 UTC on 31 December 2025: the stages say 2026, computed_at says 2025.
 */
describe('upgrading a working saved just after midnight in WIB', () => {
  const AT_0100_WIB_NEW_YEAR = '2025-12-31T18:00:00.000Z';

  it('keeps an education course in the years its stages were dated to', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'University', kind: 'education', growthBps: 1000, returnBps: 1000, derived: true,
      stages: [0, 1].map((i) => ({ name: `Year ${i + 1}`, targetMinor: Math.round(100_000_000 * 1.1 ** (10 + i)), targetMonths: null, dueOn: `${2036 + i}-01-01` })),
    });
    await database.db.insert(goalCalculators).values({
      goalId, workspaceId: ws.workspaceId, kind: 'education', computedMinor: 0, computedAt: AT_0100_WIB_NEW_YEAR,
      inputsJson: JSON.stringify({ feeTodayMinor: 100_000_000, startsInYears: 10, yearsOfStudy: 2, feeInflationBps: 1000 }),
    });
    await upgradeCalculatorGoals(database, ws, '2026-09-21');
    expect((await listGoals(database, ws))[0]!.stages.map((stage) => stage.dueOn)).toEqual(['2036-01-01', '2037-01-01']);
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ levels: [{ startYear: 2036, untilYear: 2038 }] });
  });

  it('keeps a retirement date on the day its stage was dated to', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Retirement', kind: 'retirement', growthBps: 400, returnBps: 900, derived: true,
      stages: [{ name: 'Retirement fund', targetMinor: 4_120_008_061, targetMonths: null, dueOn: '2046-01-01' }],
    });
    await database.db.insert(goalCalculators).values({
      goalId, workspaceId: ws.workspaceId, kind: 'retirement', computedMinor: 0, computedAt: AT_0100_WIB_NEW_YEAR,
      inputsJson: JSON.stringify({ annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 }),
    });
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([goalId]);
    expect((await listGoals(database, ws))[0]!.stages[0]).toMatchObject({ targetMinor: 2_070_575_495, dueOn: '2046-01-01' });
  });

  it('only stamps an emergency fund whose figures are the same, rather than moving it back a day', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 200, derived: true,
      stages: [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2028-01-01' }],
    });
    await database.db.insert(goalCalculators).values({ goalId, workspaceId: ws.workspaceId, kind: 'emergency', computedMinor: 0, computedAt: AT_0100_WIB_NEW_YEAR, inputsJson: JSON.stringify({ months: 6 }) });
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([]);
    expect((await listGoals(database, ws))[0]!.stages[0]!.dueOn).toBe('2028-01-01');
    expect((await getGoalCalculator(database, ws, goalId))!.inputs).toMatchObject({ version: 2 });
  });

  it('dates from computed_at’s own day when the stages match none of the days around it', async () => {
    const { database, ws } = await setupDb();
    const goalId = await saveGoal(database, ws, {
      name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 200, derived: true,
      stages: [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2030-06-15' }],
    });
    await database.db.insert(goalCalculators).values({ goalId, workspaceId: ws.workspaceId, kind: 'emergency', computedMinor: 0, computedAt: AT_0100_WIB_NEW_YEAR, inputsJson: JSON.stringify({ months: 6 }) });
    expect(await upgradeCalculatorGoals(database, ws, '2026-09-21')).toEqual([goalId]);
    expect((await listGoals(database, ws))[0]!.stages[0]!.dueOn).toBe('2027-12-31');
  });
});


/**
 * The bootstrap loop runs on every open. Running it twice on the same day must change nothing the second time, in
 * every workspace, for every kind of working — v1 or v2, typed or untyped, paid or not.
 */
describe('upgrading on open, twice', () => {
  const WORKED_OUT = '2024-06-01T03:00:00.000Z'; // two years back: a different return band from today's

  async function fill(database: Awaited<ReturnType<typeof setupDb>>['database'], ws: Awaited<ReturnType<typeof setupDb>>['ws'], returnBps: number | null = 1000) {
    const raw = async (name: string, kind: 'education' | 'retirement' | 'emergency', stages: { name: string; targetMinor: number | null; targetMonths: number | null; dueOn: string }[], inputs: object, goalReturn: number) => {
      const goalId = await saveGoal(database, ws, { name, kind, growthBps: 1000, returnBps: goalReturn, derived: true, stages });
      await database.db.insert(goalCalculators).values({ goalId, workspaceId: ws.workspaceId, kind, computedMinor: 0, computedAt: WORKED_OUT, inputsJson: JSON.stringify(inputs) });
      return goalId;
    };
    // v1 education: the course starts five years after 2024-06-01, so 55 months out then, 32 months out today.
    await raw('University', 'education', [0, 1].map((i) => ({ name: `Year ${i + 1}`, targetMinor: Math.round(100_000_000 * 1.1 ** (5 + i)), targetMonths: null, dueOn: `${2029 + i}-06-01` })),
      { feeTodayMinor: 100_000_000, startsInYears: 5, yearsOfStudy: 2, feeInflationBps: 1000 }, returnBps ?? 1000);
    await raw('Retirement', 'retirement', [{ name: 'Retirement fund', targetMinor: 4_120_008_061, targetMonths: null, dueOn: '2044-06-01' }],
      { annualSpendTodayMinor: 120_000_000, yearsToRetirement: 20, yearsInRetirement: 20, inflationBps: 350, returnInRetirementBps: 500 }, 900);
    await raw('Emergency fund', 'emergency', [{ name: 'Emergency fund', targetMinor: null, targetMonths: 6, dueOn: '2026-06-01' }], { months: 6 }, 200);
    // v2 education: one level typed, one untyped, one year paid — worked out two years back.
    const goalId = await saveGoal(database, ws, { name: 'Aisha', kind: 'education', growthBps: 1000, returnBps: 800, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2032-01-01' }] });
    const fee = [{ id: 'a', name: 'Academic', amountTodayMinor: 20_000_000, charged: 'yearly' as const }];
    await saveGoalCalculator(database, ws, {
      goalId, kind: 'education', today: '2024-06-01',
      inputs: { version: 2, birthday: null, feeInflationBps: 1000, levels: [
        { id: 'primary', name: 'Primary', startAge: null, untilAge: null, startYear: 2027, untilYear: 2029, returnBps: null, fees: fee },
        { id: 'middle', name: 'Middle', startAge: null, untilAge: null, startYear: 2030, untilYear: 2031, returnBps: 450, fees: fee },
      ] },
    });
    await setStagePaid(database, ws, (await listGoals(database, ws)).find((goal) => goal.id === goalId)!.stages[0]!.id, '2024-06-02');
  }

  const snapshot = async (database: Awaited<ReturnType<typeof setupDb>>['database']) =>
    Promise.all(['goals', 'goal_stages', 'goal_stage_terms', 'goal_calculators'].map((table) => database.db.all(sql.raw(`SELECT * FROM ${table} ORDER BY 1, 2`))));

  const openApp = async (database: Awaited<ReturnType<typeof setupDb>>['database'], today: string) => {
    const changed: string[] = [];
    for (const each of await listWorkspaces(database)) changed.push(...(await upgradeCalculatorGoals(database, contextOf(each), today)));
    return changed;
  };

  it('changes nothing the second time, in any workspace', async () => {
    const { database, ws } = await setupDb('IDR');
    const usd = await createWorkspace(database, { name: 'Abroad', type: 'personal', baseCurrency: 'USD' });
    await fill(database, ws);
    await fill(database, usd);

    expect(await openApp(database, '2026-09-21')).toHaveLength(8);
    const once = await snapshot(database);
    expect(await openApp(database, '2026-09-21')).toEqual([]);
    expect(await snapshot(database)).toEqual(once);
  });
});
