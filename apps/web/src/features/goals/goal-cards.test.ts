import type { GoalPlanRow, GoalRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { GOAL_TEMPLATES, goalCard, prefilledReturnBps, templateDueOn, templateFor } from './goal-cards';

const TODAY = '2026-09-12';

const goal = (partial: Partial<GoalRow> = {}): GoalRow => ({
  id: 'hajj',
  workspaceId: 'ws',
  name: 'Hajj for two',
  kind: 'hajj',
  rank: 0,
  growthBps: 500,
  returnBps: 600,
  standingMonthlyMinor: 0,
  standingNote: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  stages: [],
  ...partial,
});

const plan = (partial: Partial<GoalPlanRow> = {}): GoalPlanRow => ({
  goalId: 'hajj',
  currentMinor: 30_000_000,
  totalTargetMinor: 60_000_000,
  stages: [
    { stageId: 'awal', name: 'First payment', dueOn: '2027-06-30', months: 10, todayMinor: 25_000_000, targetMinor: 26_000_000, state: 'covered' },
    { stageId: 'lunas', name: 'Pelunasan', dueOn: '2035-06-30', months: 105, todayMinor: 120_000_000, targetMinor: 190_000_000, state: 'saving' },
  ],
  requiredMonthlyMinor: 1_000_000,
  plannedMonthlyMinor: 600_000,
  status: 'behind',
  shortfallMonthlyMinor: 400_000,
  riskWarning: null,
  goal: goal(),
  links: [],
  earmarkWarning: null,
  ...partial,
});

describe('goalCard', () => {
  it('measures progress against the target and never passes 100', () => {
    expect(goalCard(plan()).progressPercent).toBeCloseTo(50, 5);
    expect(goalCard(plan({ currentMinor: 90_000_000 })).progressPercent).toBe(100);
    expect(goalCard(plan({ totalTargetMinor: 0 })).progressPercent).toBe(0);
  });

  it('says Behind with how much is missing each month', () => {
    const card = goalCard(plan());
    expect(card.statusLabel).toBe('Behind');
    expect(card.statusTone).toBe('warn');
    expect(card.differenceMinor).toBe(-400_000);
  });

  it('says Funded when nothing more is needed', () => {
    const card = goalCard(plan({ status: 'funded', requiredMonthlyMinor: 0, shortfallMonthlyMinor: 0 }));
    expect(card.statusLabel).toBe('Funded');
    expect(card.statusTone).toBe('good');
  });

  it('says On track when what is set up covers it', () => {
    expect(goalCard(plan({ status: 'on_track', plannedMonthlyMinor: 1_000_000, shortfallMonthlyMinor: 0 })).statusLabel).toBe('On track');
  });

  it('names each stage state in plain words', () => {
    expect(goalCard(plan()).stageLines.map((line) => line.stateLabel)).toEqual(['Covered', 'Saving for this']);
    const withPaid = goalCard(plan({ stages: [{ stageId: 'awal', name: 'First payment', dueOn: '2027-06-30', months: 10, todayMinor: 1, targetMinor: 1, state: 'paid' }] }));
    expect(withPaid.stageLines[0]!.stateLabel).toBe('Paid');
  });

  it('takes the due label from the last stage still to pay', () => {
    expect(goalCard(plan()).dueLabel).toBe('Jun 2035');
  });

  it('carries the warnings through', () => {
    const card = goalCard(plan({ riskWarning: 'Japan trip is due in 9 months', earmarkWarning: 'You set aside more than BCA Tahapan holds' }));
    expect(card.riskWarning).toContain('Japan trip');
    expect(card.earmarkWarning).toContain('BCA Tahapan');
  });
});

describe('templates', () => {
  it('never prefills an amount, because every owner has their own figure', () => {
    for (const template of GOAL_TEMPLATES) expect(template.stage.targetMinor, template.kind).toBeNull();
  });

  it('starts every goal with one stage, because schemes differ', () => {
    for (const template of GOAL_TEMPLATES) {
      expect(template.stage.name, template.kind).toBeTruthy();
      expect(template.hint, template.kind).toBeTruthy();
    }
  });

  it('names no country scheme or product in a hint — only the tax report is local', () => {
    for (const template of GOAL_TEMPLATES) expect(template.hint, template.kind).not.toMatch(/BPJS|JHT|DPLK|Taspen|reksadana|deposito/i);
    expect(templateFor('retirement')!.hint).toMatch(/pension/i);
  });

  it('asks an emergency fund for months, not an amount', () => {
    const emergency = templateFor('emergency')!;
    expect(emergency.stage.targetMonths).toBe(6);
    expect(emergency.stage.targetMinor).toBeNull();
  });

  it('leaves the hajj amount empty, because only the owner knows their scheme and year', () => {
    const hajj = templateFor('hajj')!;
    expect(hajj.stage.targetMinor).toBeNull();
    expect(hajj.stage.targetMonths).toBeNull();
    expect(hajj.hint).toMatch(/first payment/i);
  });

  it('opens hajj at the setoran awal and says to add the rest', () => {
    const hajj = templateFor('hajj')!;
    expect(hajj.stage.name).toBe('First payment');
    expect(hajj.hint).toContain('each payment that follows');
  });

  it('dates the first stage from today', () => {
    expect(templateDueOn(templateFor('holiday')!, TODAY)).toBe('2027-06-12');
    expect(templateDueOn(templateFor('emergency')!, TODAY)).toBe('2028-09-12');
  });
});

describe('the return a goal opens with', () => {
  it('comes from the band for the template’s first stage, except the two with figures of their own', () => {
    const returnOf = (kind: string) => GOAL_TEMPLATES.find((template) => template.kind === kind)!.returnBps;
    expect(returnOf('holiday')).toBe(400); // 9 months
    expect(returnOf('vehicle')).toBe(500); // 36 months
    expect(returnOf('education')).toBe(800); // 120 months — was 10%
    expect(returnOf('retirement')).toBe(1000);
    expect(returnOf('emergency')).toBe(200);
    expect(GOAL_TEMPLATES.find((template) => template.kind === 'retirement')!.growthBps).toBe(350);
    expect(Math.max(...GOAL_TEMPLATES.map((template) => template.returnBps))).toBeLessThanOrEqual(1000);
  });

  it('follows a stage’s date', () => {
    expect(prefilledReturnBps('holiday', '2027-09-21', '2026-09-21')).toBe(400);
    expect(prefilledReturnBps('holiday', '2030-09-21', '2026-09-21')).toBe(600);
    expect(prefilledReturnBps('retirement', '2027-09-21', '2026-09-21')).toBe(1000);
    expect(prefilledReturnBps('emergency', '2040-09-21', '2026-09-21')).toBe(200);
  });
});
