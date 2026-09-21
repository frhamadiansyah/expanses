import { describe, expect, it } from 'vitest';
import { fitByRank, type Goal, type GoalLink, type GoalStage, goalPlan, futureValueMinor, monthlyNeededMinor } from '../src/index';

const TODAY = '2026-09-12';

const stage = (partial: Partial<GoalStage> & Pick<GoalStage, 'id' | 'name' | 'dueOn'>): GoalStage => ({
  targetMinor: 100_000_000,
  targetMonths: null,
  paidOn: null,
  ...partial,
});

const goal = (partial: Partial<Goal> & Pick<Goal, 'id' | 'name' | 'kind' | 'stages'>): Goal => ({
  rank: 1,
  growthBps: 500,
  returnBps: 600,
  standingMonthlyMinor: 0,
  standingNote: null,
  ...partial,
});

const link = (valueMinor: number, partial: Partial<GoalLink> = {}): GoalLink => ({
  accountId: 'gold',
  name: 'Antam gold bars',
  kind: 'tagged',
  unitsMicro: 31_000_000,
  valueMinor,
  currency: 'IDR',
  // In the base currency already, which is the ordinary case: `baseMinor` follows `valueMinor` unless a
  // test is about a foreign holding, and then it says so.
  baseMinor: valueMinor,
  risk: 'medium',
  ...partial,
});

describe('futureValueMinor', () => {
  it('grows money at the rate given', () => {
    expect(futureValueMinor(100_000_000, 1000, 12)).toBe(110_000_000);
    expect(futureValueMinor(100_000_000, 1000, 24)).toBe(121_000_000);
  });

  it('leaves money alone at 0%', () => {
    expect(futureValueMinor(100_000_000, 0, 120)).toBe(100_000_000);
  });
});

describe('monthlyNeededMinor', () => {
  it('splits the gap evenly at 0%', () => {
    expect(monthlyNeededMinor(12_000_000, 0, 12)).toBe(1_000_000);
  });

  it('matches a known annuity figure', () => {
    // Rp 1.000.000 in 12 months at 12% a year needs about Rp 78.849 a month.
    expect(monthlyNeededMinor(1_000_000, 1200, 12)).toBeCloseTo(78_849, -1);
  });

  it('needs nothing when there is no gap', () => {
    expect(monthlyNeededMinor(0, 600, 24)).toBe(0);
    expect(monthlyNeededMinor(-5_000_000, 600, 24)).toBe(0);
  });
});

describe('goalPlan', () => {
  const holiday = goal({
    id: 'japan',
    name: 'Japan trip',
    kind: 'holiday',
    growthBps: 300,
    returnBps: 450,
    stages: [stage({ id: 's1', name: 'Japan trip', dueOn: '2027-06-15', targetMinor: 30_000_000 })],
  });

  it('counts what every link is worth today', () => {
    const plan = goalPlan(holiday, [link(20_000_000, { accountId: 'rdpu', name: 'Money market fund', risk: 'low' }), link(2_000_000, { kind: 'earmark', unitsMicro: null })], 0, 0, TODAY);
    expect(plan.currentMinor).toBe(22_000_000);
  });

  it('grows the target by the cost growth', () => {
    const plan = goalPlan(holiday, [], 0, 0, TODAY);
    expect(plan.stages[0]!.targetMinor).toBeGreaterThan(30_000_000);
    expect(plan.totalTargetMinor).toBe(plan.stages[0]!.targetMinor);
  });

  it('needs nothing when the links already cover the target', () => {
    const plan = goalPlan(holiday, [link(60_000_000)], 0, 0, TODAY);
    expect(plan.stages[0]!.state).toBe('covered');
    expect(plan.requiredMonthlyMinor).toBe(0);
    expect(plan.status).toBe('funded');
  });

  it('asks for a monthly amount when the links fall short', () => {
    const plan = goalPlan(holiday, [link(10_000_000)], 0, 0, TODAY);
    expect(plan.stages[0]!.state).toBe('saving');
    expect(plan.requiredMonthlyMinor).toBeGreaterThan(0);
    expect(plan.status).toBe('behind');
    expect(plan.shortfallMonthlyMinor).toBe(plan.requiredMonthlyMinor);
  });

  it('is on track once the planned amount covers what is needed', () => {
    const short = goalPlan(holiday, [link(10_000_000)], 0, 0, TODAY);
    const plan = goalPlan(holiday, [link(10_000_000)], short.requiredMonthlyMinor, 0, TODAY);
    expect(plan.status).toBe('on_track');
    expect(plan.shortfallMonthlyMinor).toBe(0);
  });

  it('adds the standing amount to what is set up', () => {
    const withStanding = goal({ ...holiday, standingMonthlyMinor: 1_000_000 });
    const plan = goalPlan(withStanding, [link(10_000_000)], 500_000, 0, TODAY);
    expect(plan.plannedMonthlyMinor).toBe(1_500_000);
  });

  const twoStages = goal({
    id: 'hajj',
    name: 'Hajj for two',
    kind: 'hajj',
    stages: [
      stage({ id: 'awal', name: 'Setoran awal', dueOn: '2027-06-30', targetMinor: 50_000_000 }),
      stage({ id: 'lunas', name: 'Final payment', dueOn: '2048-06-30', targetMinor: 120_000_000 }),
    ],
  });

  it('covers the first stage and carries the surplus to the next', () => {
    const plan = goalPlan(twoStages, [link(57_000_000)], 0, 0, TODAY);
    expect(plan.stages.map((row) => row.state)).toEqual(['covered', 'saving']);
    expect(plan.requiredMonthlyMinor).toBeGreaterThan(0);
  });

  it('marks stages after the one being saved for as later', () => {
    const plan = goalPlan(
      goal({ ...twoStages, stages: [...twoStages.stages, stage({ id: 'extra', name: 'Extra step', dueOn: '2050-06-30', targetMinor: 50_000_000 })] }),
      [link(1_000_000)],
      0,
      0,
      TODAY,
    );
    expect(plan.stages.map((row) => row.state)).toEqual(['saving', 'later', 'later']);
  });

  it('skips a stage that is already paid', () => {
    const plan = goalPlan(
      goal({ ...twoStages, stages: [stage({ id: 'awal', name: 'Setoran awal', dueOn: '2027-06-30', targetMinor: 50_000_000, paidOn: '2026-07-01' }), twoStages.stages[1]!] }),
      [link(1_000_000)],
      0,
      0,
      TODAY,
    );
    expect(plan.stages[0]!.state).toBe('paid');
    expect(plan.stages[1]!.state).toBe('saving');
  });

  it('works stages in date order however they arrive', () => {
    const plan = goalPlan(goal({ ...twoStages, stages: [twoStages.stages[1]!, twoStages.stages[0]!] }), [link(57_000_000)], 0, 0, TODAY);
    expect(plan.stages.map((row) => row.stageId)).toEqual(['awal', 'lunas']);
  });

  it('takes an emergency target from months of outgoings', () => {
    const emergency = goal({
      id: 'ef',
      name: 'Emergency fund',
      kind: 'emergency',
      growthBps: 0,
      returnBps: 200,
      stages: [stage({ id: 'ef1', name: 'Emergency fund', dueOn: '2028-12-31', targetMinor: null, targetMonths: 6 })],
    });
    const plan = goalPlan(emergency, [link(100_000_000, { kind: 'earmark', unitsMicro: null })], 0, 61_773_000, TODAY);
    expect(plan.stages[0]!.todayMinor).toBe(6 * 61_773_000);
    expect(plan.stages[0]!.targetMinor).toBe(6 * 61_773_000);
  });

  it('warns when a goal due soon is held in something risky', () => {
    const soon = goal({ ...holiday, stages: [stage({ id: 's1', name: 'Japan trip', dueOn: '2027-06-15', targetMinor: 30_000_000 })] });
    const risky = goalPlan(soon, [link(10_000_000, { risk: 'high', name: 'Equity fund' })], 0, 0, TODAY);
    expect(risky.riskWarning).toContain('Equity fund');

    const safe = goalPlan(soon, [link(10_000_000, { risk: 'low', name: 'Money market fund' })], 0, 0, TODAY);
    expect(safe.riskWarning).toBeNull();
  });

  it('leaves a distant goal in shares alone', () => {
    const plan = goalPlan(twoStages, [link(10_000_000, { risk: 'high', name: 'Equity fund' })], 0, 0, TODAY);
    expect(plan.riskWarning).toBeNull();
  });
});

describe('fitByRank', () => {
  const plans = [
    { goalId: 'ef', requiredMonthlyMinor: 5_000_000 },
    { goalId: 'hajj', requiredMonthlyMinor: 600_000 },
    { goalId: 'edu', requiredMonthlyMinor: 3_000_000 },
    { goalId: 'retire', requiredMonthlyMinor: 12_000_000 },
  ].map((row) => ({
    goalId: row.goalId,
    currentMinor: 0,
    totalTargetMinor: 0,
    stages: [],
    requiredMonthlyMinor: row.requiredMonthlyMinor,
    plannedMonthlyMinor: 0,
    status: 'behind' as const,
    shortfallMonthlyMinor: row.requiredMonthlyMinor,
    riskWarning: null,
  }));
  const goals = [
    goal({ id: 'ef', name: 'Emergency fund', kind: 'emergency', rank: 1, stages: [] }),
    goal({ id: 'hajj', name: 'Hajj', kind: 'hajj', rank: 2, stages: [] }),
    goal({ id: 'edu', name: 'Education', kind: 'education', rank: 3, stages: [] }),
    goal({ id: 'retire', name: 'Retirement', kind: 'retirement', rank: 4, stages: [] }),
  ];

  it('funds compulsory goals first, then by rank, until the money runs out', () => {
    const fits = fitByRank(plans, goals, 7_000_000);
    // Retirement is compulsory, so it follows the emergency fund though it is ranked last.
    expect(fits.map((fit) => [fit.goalId, fit.fits])).toEqual([
      ['ef', 'full'],
      ['retire', 'partial'],
      ['hajj', 'none'],
      ['edu', 'none'],
    ]);
    expect(fits[1]!.fundedMonthlyMinor).toBe(7_000_000 - 5_000_000);
  });

  it('funds additional goals by rank once the compulsory ones are covered', () => {
    const fits = fitByRank(plans, goals, 19_000_000);
    expect(fits.map((fit) => [fit.goalId, fit.fits])).toEqual([
      ['ef', 'full'],
      ['retire', 'full'],
      ['hajj', 'full'],
      ['edu', 'partial'],
    ]);
    expect(fits[3]!.fundedMonthlyMinor).toBe(19_000_000 - 5_000_000 - 12_000_000 - 600_000);
  });

  it('funds everything when there is enough to go round', () => {
    const fits = fitByRank(plans, goals, 100_000_000);
    expect(fits.every((fit) => fit.fits === 'full')).toBe(true);
  });

  it('funds nothing when there is nothing spare', () => {
    const fits = fitByRank(plans, goals, 0);
    expect(fits.every((fit) => fit.fits === 'none')).toBe(true);
  });
});
