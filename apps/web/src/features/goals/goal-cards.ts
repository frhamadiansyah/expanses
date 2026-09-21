import { formatMinor, type GoalKind, type StageState } from '@expanses/core';
import type { GoalHistoryEntry, GoalPlanRow } from '@expanses/db';

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
  statusLabel: 'Done' | 'Funded' | 'On track' | 'Behind';
  statusTone: 'good' | 'warn';
  neededMonthlyMinor: number;
  plannedMonthlyMinor: number;
  /** What is set up minus what is needed: negative means short. */
  differenceMinor: number;
  stageLines: StageLine[];
  riskWarning: string | null;
  earmarkWarning: string | null;
  /** Every stage paid. Never for an emergency fund: a standing level is rebuilt, not finished (ruling Q3). */
  done: boolean;
  /** The last day a stage was paid, when done. */
  doneOn: string | null;
  /** Each account that holds less of this goal's promise than it was promised, in that account's money. */
  shortLines: { accountName: string; shortMinor: number; currency: string }[];
}

const monthYear = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/** "3 Aug" — for dates inside the year a goal's card is read in. */
export const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * What a goal form's box may take from one account: the money free there plus this goal's own promise there, which
 * the save replaces. `freeMinor` is the account's shared-out view (signed); with no view (nothing promised on the
 * account) it is the balance. All in the account's own money.
 */
export function roomFor(freeMinor: number | null, balanceMinor: number, ownPromiseMinor: number): number {
  return (freeMinor ?? balanceMinor) + ownPromiseMinor;
}

/** The box's hint: what is free for this goal, or — when the typed figure is more — how short it leaves the account. */
export function setAsideHint(roomMinor: number, typedMinor: number | null, accountName: string, currency: string): { text: string; warn: boolean } {
  if (typedMinor !== null && typedMinor > roomMinor) return { text: `That leaves ${accountName} ${formatMinor(typedMinor - roomMinor, currency)} short`, warn: true };
  return { text: `${formatMinor(Math.max(0, roomMinor), currency)} free for this goal`, warn: false };
}

/** A history line's day: "3 Aug" within the year it is read in, "3 Aug 2025" before it. */
export const historyDay = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4) ? dayMonth(iso) : `${dayMonth(iso)} ${iso.slice(0, 4)}`);

/**
 * When a goal that was whole was borrowed from: the newest such borrow, and the day it last reached its target before that
 * (null when the records cannot say — ruling Q4 reads it "Fully funded until …"). Null when nothing was borrowed.
 */
export function fundedWindow(
  history: GoalHistoryEntry[],
  /** Whether the borrow with this history key was taken while the goal was whole (its draw's `wasWhole`). All, when absent. */
  wasWhole: (key: string) => boolean = () => true,
): { from: string | null; until: string; description: string; amountMinor: number; currency: string } | null {
  const borrow = history.filter((entry) => entry.kind === 'borrowed' && wasWhole(entry.key)).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))[0];
  if (!borrow) return null;
  const reached = history
    .filter((entry) => entry.kind === 'reached' && entry.occurredOn <= borrow.occurredOn)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))[0];
  return { from: reached?.occurredOn ?? null, until: borrow.occurredOn, description: borrow.text, amountMinor: Math.abs(borrow.amountMinor ?? 0), currency: borrow.currency };
}

export function goalCard(plan: GoalPlanRow): GoalCard {
  const unpaid = plan.stages.filter((stage) => stage.state !== 'paid');
  const last = unpaid[unpaid.length - 1] ?? plan.stages[plan.stages.length - 1];
  const done = plan.goal.kind !== 'emergency' && plan.stages.length > 0 && plan.stages.every((stage) => stage.state === 'paid');
  const statusLabel = done ? 'Done' : plan.status === 'funded' ? 'Funded' : plan.status === 'on_track' ? 'On track' : 'Behind';
  const paidDays = plan.goal.stages.map((stage) => stage.paidOn).filter((day): day is string => !!day).sort();
  return {
    goalId: plan.goalId,
    name: plan.goal.name,
    kindLabel: GOAL_KIND_LABELS[plan.goal.kind],
    dueLabel: last ? monthYear(last.dueOn) : '—',
    currentMinor: plan.currentMinor,
    targetMinor: plan.totalTargetMinor,
    progressPercent: plan.totalTargetMinor > 0 ? Math.max(0, Math.min(100, (plan.currentMinor / plan.totalTargetMinor) * 100)) : 0,
    statusLabel,
    statusTone: done || plan.status !== 'behind' ? 'good' : 'warn',
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
    done,
    doneOn: done ? (paidDays.at(-1) ?? null) : null,
    shortLines: plan.links.filter((link) => link.shortMinor > 0).map((link) => ({ accountName: link.name, shortMinor: link.shortMinor, currency: link.currency })),
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

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    kind: 'emergency',
    label: 'Emergency fund',
    growthBps: 0,
    returnBps: 200,
    stage: { name: 'Emergency fund', targetMinor: null, targetMonths: 6, monthsAway: 24 },
    hint: 'Months of spending and debt payments, kept in savings or a deposit.',
  },
  {
    kind: 'hajj',
    label: 'Hajj or umrah',
    growthBps: 500,
    returnBps: 600,
    stage: { name: 'First payment', targetMinor: null, targetMonths: null, monthsAway: 12 },
    hint: 'Put in the first payment your scheme asks for, at the price it costs today, then add a stage for each payment that follows.',
  },
  {
    kind: 'education',
    label: 'Education',
    growthBps: 1000,
    returnBps: 1000,
    stage: { name: 'First year', targetMinor: null, targetMonths: null, monthsAway: 120 },
    hint: 'Education costs rise faster than everything else, so the growth starts at 10% a year.',
  },
  {
    kind: 'retirement',
    label: 'Retirement',
    growthBps: 400,
    returnBps: 900,
    stage: { name: 'Retirement fund', targetMinor: null, targetMonths: null, monthsAway: 240 },
    hint: 'BPJS JHT and DPLK are not counted yet; add them as other assets to include them.',
  },
  { kind: 'home', label: 'Home down payment', growthBps: 700, returnBps: 500, stage: { name: 'Down payment', targetMinor: null, targetMonths: null, monthsAway: 36 }, hint: 'Property prices move with the area, so check the growth yourself.' },
  { kind: 'wedding', label: 'Wedding', growthBps: 500, returnBps: 500, stage: { name: 'Wedding', targetMinor: null, targetMonths: null, monthsAway: 24 }, hint: 'Add stages for the venue deposit and the balance if you pay in steps.' },
  { kind: 'vehicle', label: 'Vehicle', growthBps: 300, returnBps: 450, stage: { name: 'Vehicle', targetMinor: null, targetMonths: null, monthsAway: 36 }, hint: 'A down payment and the loan go on Loans; this is for paying cash.' },
  { kind: 'holiday', label: 'Holiday', growthBps: 300, returnBps: 450, stage: { name: 'Holiday', targetMinor: null, targetMonths: null, monthsAway: 9 }, hint: 'Short goals belong in savings or a money market fund, not shares.' },
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
