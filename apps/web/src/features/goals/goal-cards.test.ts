import type { GoalPlanRow, GoalRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { cardHistory, dayMonth, fundedWindow, GOAL_TEMPLATES, goalCard, historyDay, prefilledReturnBps, roomFor, setAsideHint, templateDueOn, templateFor } from './goal-cards';

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
  unconvertedWarning: null,
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

  it('carries the risk warning through; the short state is its own lines, not a warning sentence (M7)', () => {
    const card = goalCard(plan({ riskWarning: 'Japan trip is due in 9 months', earmarkWarning: 'You set aside more than BCA Tahapan holds' }));
    expect(card.riskWarning).toContain('Japan trip');
    expect(card).not.toHaveProperty('earmarkWarning');
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

describe('done and short', () => {
  const paidStage = { id: 's1', name: 'Tickets', targetMinor: 1, targetMonths: null, dueOn: '2027-03-31', paidOn: '2026-09-19' };
  const paidPlan = { stageId: 's1', name: 'Tickets', dueOn: '2027-03-31', months: 6, todayMinor: 1, targetMinor: 1, state: 'paid' as const };

  it('reads Done when every stage of a one-stage goal is paid, and names the last day paid', () => {
    const card = goalCard(plan({ status: 'funded', goal: goal({ name: 'Umrah', kind: 'umrah', stages: [paidStage] }), stages: [paidPlan] }));
    expect(card).toMatchObject({ statusLabel: 'Done', statusTone: 'good', done: true, doneOn: '2026-09-19' });
  });

  it('names the latest day paid across stages, not the first, and is not Done while one stage is still open', () => {
    const later = { ...paidStage, id: 's2', name: 'Hotel', paidOn: '2026-10-02' };
    const both = goalCard(plan({ status: 'funded', goal: goal({ kind: 'umrah', stages: [later, paidStage] }), stages: [paidPlan, { ...paidPlan, stageId: 's2', name: 'Hotel' }] }));
    expect(both).toMatchObject({ done: true, doneOn: '2026-10-02' });
    const open = goalCard(plan({ status: 'funded', goal: goal({ kind: 'umrah', stages: [paidStage, { ...later, paidOn: null }] }), stages: [paidPlan, { ...paidPlan, stageId: 's2', state: 'covered' as const }] }));
    expect(open).toMatchObject({ done: false, doneOn: null, statusLabel: 'Funded' });
  });

  it('never reads Done for an emergency fund: it is a standing level, rebuilt after it is spent (ruling Q3)', () => {
    // Same paid stage, same plan, only the kind differs — so the kind alone is what keeps it open.
    const card = goalCard(plan({ status: 'funded', goal: goal({ name: 'Emergency fund', kind: 'emergency', stages: [paidStage] }), stages: [paidPlan] }));
    expect(card.done).toBe(false);
    expect(card.statusLabel).not.toBe('Done');
    expect(card.doneOn).toBeNull();
  });

  it('never reads Done for a goal with no stages: nothing paid is not everything paid (M2)', () => {
    const card = goalCard(plan({ status: 'funded', goal: goal({ kind: 'umrah', stages: [] }), stages: [] }));
    expect(card).toMatchObject({ done: false, doneOn: null, statusLabel: 'Funded' });
  });

  it('keeps a Done goal in the good tone though its plan reads behind (M2)', () => {
    // Every stage paid; the plan still says behind (nothing more is set up). Done wins, and Done is not a warning.
    const card = goalCard(plan({ status: 'behind', goal: goal({ kind: 'umrah', stages: [paidStage] }), stages: [paidPlan] }));
    expect(card).toMatchObject({ statusLabel: 'Done', statusTone: 'good' });
    // The same plan with a stage still open is Behind, in the warn tone.
    expect(goalCard(plan({ status: 'behind', goal: goal({ kind: 'umrah', stages: [{ ...paidStage, paidOn: null }] }), stages: [{ ...paidPlan, state: 'saving' }] }))).toMatchObject({ statusLabel: 'Behind', statusTone: 'warn' });
  });

  it('shows six history lines and reads the funded window from all of them (M3)', () => {
    const line = (day: number) => ({ key: `s${day}`, kind: 'set-aside' as const, occurredOn: `2026-09-${String(day).padStart(2, '0')}`, amountMinor: 100_000, currency: 'IDR', text: 'Jenius' });
    // Newest first: the borrow, six set-asides after the target was reached, then the reached day itself — the eighth line.
    const full = [
      { key: 'b', kind: 'borrowed' as const, occurredOn: '2026-09-19', amountMinor: -1_800_000, currency: 'IDR', text: 'Laptop' },
      line(18), line(17), line(16), line(15), line(14), line(13),
      { key: 'r', kind: 'reached' as const, occurredOn: '2026-08-03', amountMinor: null, currency: 'IDR', text: 'Reached the target' },
    ];
    const { lines, stood } = cardHistory(full, () => true);
    expect(lines.map((entry) => entry.key)).toEqual(['b', 's18', 's17', 's16', 's15', 's14']);
    // Read from the six on show, the reached day is gone and the card would say "Fully funded until 19 Sep".
    expect(stood).toEqual({ from: '2026-08-03', until: '2026-09-19', description: 'Laptop', amountMinor: 1_800_000, currency: 'IDR' });
  });

  it('lists what each account is short, in that account\'s money', () => {
    const card = goalCard(plan({ links: [{ goalId: 'g', accountId: 'wise', name: 'Wise USD', kind: 'earmark', unitsMicro: null, valueMinor: 5_000, currency: 'USD', baseMinor: null, risk: null, promisedMinor: 10_003, shortMinor: 5_003, overBalance: true }] }));
    expect(card.shortLines).toEqual([{ accountName: 'Wise USD', shortMinor: 5_003, currency: 'USD' }]);
  });

  it('leaves a covered link off the short lines', () => {
    const card = goalCard(plan({ links: [{ goalId: 'g', accountId: 'bca', name: 'BCA', kind: 'earmark', unitsMicro: null, valueMinor: 5_000, currency: 'IDR', baseMinor: 5_000, risk: null, promisedMinor: 5_000, shortMinor: 0, overBalance: false }] }));
    expect(card.shortLines).toEqual([]);
  });

  it('keeps the dates a borrowed-from goal stood whole', () => {
    const history = [
      { key: 'b', kind: 'borrowed' as const, occurredOn: '2026-09-19', amountMinor: -1_800_000, currency: 'IDR', text: 'Laptop' },
      { key: 'r', kind: 'reached' as const, occurredOn: '2026-08-03', amountMinor: null, currency: 'IDR', text: 'Reached the target' },
    ];
    expect(fundedWindow(history)).toEqual({ from: '2026-08-03', until: '2026-09-19', description: 'Laptop', amountMinor: 1_800_000, currency: 'IDR' });
    expect(fundedWindow([history[0]!])).toMatchObject({ from: null, until: '2026-09-19' });
    expect(fundedWindow([])).toBeNull();
  });

  it('reads only a borrow taken while the goal was whole: a goal that was never whole never "stood whole" (spec §7.2)', () => {
    const history = [
      { key: 'b2', kind: 'borrowed' as const, occurredOn: '2026-09-19', amountMinor: -1_800_000, currency: 'IDR', text: 'Laptop' },
      { key: 'b1', kind: 'borrowed' as const, occurredOn: '2026-07-01', amountMinor: -500_000, currency: 'IDR', text: 'Phone' },
    ];
    expect(fundedWindow(history, (key) => key === 'b1')).toEqual({ from: null, until: '2026-07-01', description: 'Phone', amountMinor: 500_000, currency: 'IDR' });
    expect(fundedWindow(history, () => false)).toBeNull();
  });

  it('reads the newest borrow, and no reached day after it', () => {
    const history = [
      { key: 'r2', kind: 'reached' as const, occurredOn: '2026-10-01', amountMinor: null, currency: 'IDR', text: 'Reached the target' },
      { key: 'b2', kind: 'borrowed' as const, occurredOn: '2026-09-19', amountMinor: -1_800_000, currency: 'IDR', text: 'Laptop' },
      { key: 'b1', kind: 'borrowed' as const, occurredOn: '2026-07-01', amountMinor: -500_000, currency: 'IDR', text: 'Phone' },
      { key: 's', kind: 'set-aside' as const, occurredOn: '2026-06-01', amountMinor: 30_000_000, currency: 'IDR', text: 'Jenius' },
    ];
    expect(fundedWindow(history)).toEqual({ from: null, until: '2026-09-19', description: 'Laptop', amountMinor: 1_800_000, currency: 'IDR' });
  });

  it('dates a history line without its year only inside the year it is read in', () => {
    expect(historyDay('2026-08-03', '2026-09-21')).toBe('3 Aug');
    expect(historyDay('2025-12-30', '2026-09-21')).toBe('30 Dec 2025');
  });

  it('writes a day and a month, with no year', () => {
    expect(dayMonth('2026-08-03')).toBe('3 Aug');
    // September's short name is ICU's to choose ("Sep" or "Sept"); the day and the absent year are ours.
    expect(dayMonth('2026-09-19')).toMatch(/^19 Sept?$/);
  });
});

describe('the goal form\'s free hint', () => {
  it('counts the free money plus this goal\'s own promise there, which the save replaces', () => {
    // Jenius 42.500.000 holding EF 30.000.000 and Umrah 7.500.000: 5.000.000 free; editing Umrah may take 12.500.000.
    expect(roomFor(5_000_000, 42_500_000, 7_500_000)).toBe(12_500_000);
    // Nothing promised on the account: its balance is what is free.
    expect(roomFor(null, 3_250_000, 0)).toBe(3_250_000);
    // Already short (free −16.500.000): Umrah's own 7.500.000 back still leaves 9.000.000 missing.
    expect(roomFor(-16_500_000, 21_000_000, 7_500_000)).toBe(-9_000_000);
  });

  it('says what is free, never below nought', () => {
    expect(setAsideHint(12_500_000, null, 'Jenius', 'IDR')).toEqual({ text: 'Rp\u00a012.500.000 free for this goal', warn: false });
    expect(setAsideHint(-9_000_000, null, 'Jenius', 'IDR')).toEqual({ text: 'Rp\u00a00 free for this goal', warn: false });
    // Exactly the room is not over it.
    expect(setAsideHint(12_500_000, 12_500_000, 'Jenius', 'IDR').warn).toBe(false);
  });

  it('says how short a figure over the room leaves the account, in its own money', () => {
    expect(setAsideHint(12_500_000, 12_500_001, 'Jenius', 'IDR')).toEqual({ text: 'That leaves Jenius Rp\u00a01 short', warn: true });
    expect(setAsideHint(-9_000_000, 7_500_000, 'Jenius', 'IDR')).toEqual({ text: 'That leaves Jenius Rp\u00a016.500.000 short', warn: true });
    expect(setAsideHint(5_000, 10_003, 'Wise USD', 'USD').text).toBe('That leaves Wise USD US$50,03 short');
  });
});

describe('the return a goal opens with', () => {
  it('comes from the band for the template’s first stage, except the two with figures of their own', () => {
    const returnOf = (kind: string) => GOAL_TEMPLATES.find((template) => template.kind === kind)!.returnBps;
    expect(returnOf('holiday')).toBe(400); // 9 months
    expect(returnOf('vehicle')).toBe(500); // 36 months
    expect(returnOf('hajj')).toBe(400); // 12 months — at 24 it would be 5%
    expect(returnOf('home')).toBe(500); // 36 months
    expect(returnOf('wedding')).toBe(500); // 24 months
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
