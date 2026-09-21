import {
  assumedReturnBps,
  DEFAULT_INFLATION_BPS,
  EMERGENCY_RETURN_BPS,
  type GoalKind,
  monthsUntil,
  RETIREMENT_RETURN_BPS,
  type StageState,
} from '@expanses/core';
import type { GoalPlanRow } from '@expanses/db';

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  emergency: 'Emergency fund',
  hajj: 'Hajj',
  umrah: 'Umrah',
  education: 'Education',
  retirement: 'Retirement',
  home: 'Home',
  wedding: 'Wedding',
  vehicle: 'Vehicle',
  holiday: 'Holiday',
  other: 'Other',
};

const STAGE_STATE_LABELS: Record<StageState, string> = {
  paid: 'Paid',
  covered: 'Covered',
  saving: 'Saving for this',
  later: 'Later',
};

export interface StageLine {
  stageId: string;
  name: string;
  when: string;
  todayMinor: number;
  targetMinor: number;
  stateLabel: string;
  state: StageState;
}

export interface GoalCard {
  goalId: string;
  name: string;
  kindLabel: string;
  /** When the goal finishes: the last stage still to pay. */
  dueLabel: string;
  currentMinor: number;
  targetMinor: number;
  progressPercent: number;
  statusLabel: 'Funded' | 'On track' | 'Behind';
  statusTone: 'good' | 'warn';
  neededMonthlyMinor: number;
  plannedMonthlyMinor: number;
  /** What is set up minus what is needed: negative means short. */
  differenceMinor: number;
  stageLines: StageLine[];
  riskWarning: string | null;
  earmarkWarning: string | null;
}

const monthYear = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

export function goalCard(plan: GoalPlanRow): GoalCard {
  const unpaid = plan.stages.filter((stage) => stage.state !== 'paid');
  const last = unpaid[unpaid.length - 1] ?? plan.stages[plan.stages.length - 1];
  const statusLabel = plan.status === 'funded' ? 'Funded' : plan.status === 'on_track' ? 'On track' : 'Behind';
  return {
    goalId: plan.goalId,
    name: plan.goal.name,
    kindLabel: GOAL_KIND_LABELS[plan.goal.kind],
    dueLabel: last ? monthYear(last.dueOn) : '—',
    currentMinor: plan.currentMinor,
    targetMinor: plan.totalTargetMinor,
    progressPercent: plan.totalTargetMinor > 0 ? Math.max(0, Math.min(100, (plan.currentMinor / plan.totalTargetMinor) * 100)) : 0,
    statusLabel,
    statusTone: plan.status === 'behind' ? 'warn' : 'good',
    neededMonthlyMinor: plan.requiredMonthlyMinor,
    plannedMonthlyMinor: plan.plannedMonthlyMinor,
    differenceMinor: plan.plannedMonthlyMinor - plan.requiredMonthlyMinor,
    stageLines: plan.stages.map((stage) => ({
      stageId: stage.stageId,
      name: stage.name,
      when: monthYear(stage.dueOn),
      todayMinor: stage.todayMinor,
      targetMinor: stage.targetMinor,
      stateLabel: STAGE_STATE_LABELS[stage.state],
      state: stage.state,
    })),
    riskWarning: plan.riskWarning,
    earmarkWarning: plan.earmarkWarning,
  };
}

export interface GoalTemplate {
  kind: GoalKind;
  label: string;
  growthBps: number;
  returnBps: number;
  /** Every template opens with one stage; you add the rest, because schemes differ. */
  stage: { name: string; targetMinor: number | null; targetMonths: number | null; monthsAway: number };
  hint: string;
}

/** The return a goal opens with: the horizon band for when it is needed, except the two that have figures of their own. */
export function prefilledReturnBps(kind: GoalKind, dueOn: string, today: string): number {
  if (kind === 'emergency') return EMERGENCY_RETURN_BPS;
  if (kind === 'retirement') return RETIREMENT_RETURN_BPS;
  return assumedReturnBps(monthsUntil(today, dueOn));
}

const bandReturn = (monthsAway: number) => assumedReturnBps(monthsAway);

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    kind: 'emergency',
    label: 'Emergency fund',
    growthBps: 0,
    returnBps: EMERGENCY_RETURN_BPS,
    stage: { name: 'Emergency fund', targetMinor: null, targetMonths: 6, monthsAway: 24 },
    hint: 'Months of what you spend, with loan principal added, kept in savings or a deposit.',
  },
  {
    kind: 'hajj',
    label: 'Hajj or umrah',
    growthBps: 500,
    returnBps: bandReturn(12),
    stage: { name: 'First payment', targetMinor: null, targetMonths: null, monthsAway: 12 },
    hint: 'Put in the first payment your scheme asks for, at the price it costs today, then add a stage for each payment that follows.',
  },
  {
    kind: 'education',
    label: 'Education',
    growthBps: 1000,
    returnBps: bandReturn(120),
    stage: { name: 'First year', targetMinor: null, targetMonths: null, monthsAway: 120 },
    hint: 'Education costs rise faster than everything else, so the growth starts at 10% a year. The return follows how far away it is.',
  },
  {
    kind: 'retirement',
    label: 'Retirement',
    growthBps: DEFAULT_INFLATION_BPS,
    returnBps: RETIREMENT_RETURN_BPS,
    stage: { name: 'Retirement fund', targetMinor: null, targetMonths: null, monthsAway: 240 },
    hint: 'Pension savings you already hold, from work or of your own, are not counted yet; add them as other assets to include them.',
  },
  { kind: 'home', label: 'Home down payment', growthBps: 700, returnBps: bandReturn(36), stage: { name: 'Down payment', targetMinor: null, targetMonths: null, monthsAway: 36 }, hint: 'Property prices move with the area, so check the growth yourself.' },
  { kind: 'wedding', label: 'Wedding', growthBps: 500, returnBps: bandReturn(24), stage: { name: 'Wedding', targetMinor: null, targetMonths: null, monthsAway: 24 }, hint: 'Add stages for the venue deposit and the balance if you pay in steps.' },
  { kind: 'vehicle', label: 'Vehicle', growthBps: 300, returnBps: bandReturn(36), stage: { name: 'Vehicle', targetMinor: null, targetMonths: null, monthsAway: 36 }, hint: 'A down payment and the loan go on Debts; this is for paying cash.' },
  { kind: 'holiday', label: 'Holiday', growthBps: 300, returnBps: bandReturn(9), stage: { name: 'Holiday', targetMinor: null, targetMonths: null, monthsAway: 9 }, hint: 'Short goals belong in savings or a money market fund, not shares.' },
];

export function templateFor(kind: GoalKind): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((template) => template.kind === kind);
}

/** The date a template's first stage lands on, so the form opens with something sensible. */
export function templateDueOn(template: GoalTemplate, today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + template.stage.monthsAway, day!));
  return date.toISOString().slice(0, 10);
}
