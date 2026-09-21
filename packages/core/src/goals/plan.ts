import type { Risk } from '../assets/presets';
import { roundHalfAwayFromZero } from '../money/money';
import { fundingOrder } from './classes';

export type GoalKind = 'emergency' | 'hajj' | 'umrah' | 'education' | 'retirement' | 'home' | 'wedding' | 'vehicle' | 'holiday' | 'other';

export interface GoalStage {
  id: string;
  name: string;
  /** What it costs in today's money. Null on an emergency stage, which counts months instead. */
  targetMinor: number | null;
  targetMonths: number | null;
  dueOn: string;
  paidOn: string | null;
}

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  rank: number;
  /** How fast the cost grows, in basis points a year. */
  growthBps: number;
  /** What the money funding it is expected to earn, in basis points a year. */
  returnBps: number;
  standingMonthlyMinor: number;
  standingNote: string | null;
  stages: GoalStage[];
}

export interface GoalLink {
  accountId: string;
  name: string;
  /** Units tagged to the goal, or an amount set aside from a savings account. */
  kind: 'tagged' | 'earmark';
  unitsMicro: number | null;
  /**
   * What is set aside or tagged, **in the account's own money** — a US$100,03 set-aside on a USD account is
   * 10_003, not what it converts to. That is what the account holds and what will be withdrawn.
   */
  valueMinor: number;
  /** The currency `valueMinor` is counted in. Without it nothing downstream can convert, or know not to. */
  currency: string;
  /**
   * `valueMinor` in the workspace's base currency, or null when no rate is known for the day.
   *
   * Null is not zero. A holding nobody has a rate for has not stopped existing, and a goals screen that
   * showed it as nothing would read as "you have saved nothing" — so it is left out of the total and said
   * out loud instead.
   */
  baseMinor: number | null;
  risk: Risk | null;
}

export type StageState = 'paid' | 'covered' | 'saving' | 'later';

export interface StagePlan {
  stageId: string;
  name: string;
  dueOn: string;
  months: number;
  todayMinor: number;
  targetMinor: number;
  state: StageState;
}

export type GoalStatus = 'funded' | 'on_track' | 'behind';

export interface GoalPlan {
  goalId: string;
  currentMinor: number;
  totalTargetMinor: number;
  stages: StagePlan[];
  requiredMonthlyMinor: number;
  plannedMonthlyMinor: number;
  status: GoalStatus;
  shortfallMonthlyMinor: number;
  riskWarning: string | null;
}

export interface RankFit {
  goalId: string;
  fundedMonthlyMinor: number;
  fits: 'full' | 'partial' | 'none';
}

/** A goal this close is too near for money that can fall in value. */
export const RISK_HORIZON_MONTHS = 36;
/** Set up at least this share of what is needed and the goal counts as on track. */
const ON_TRACK_SHARE = 0.98;

const DAYS_PER_MONTH = 30.44;

export function monthsUntil(from: string, to: string): number {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return Math.max(1, Math.round(days / DAYS_PER_MONTH));
}

const yearlyFactor = (rateBps: number, months: number) => (1 + rateBps / 10_000) ** (months / 12);

/** What an amount grows to after so many months at a yearly rate. */
export function futureValueMinor(presentMinor: number, rateBps: number, months: number): number {
  return roundHalfAwayFromZero(presentMinor * yearlyFactor(rateBps, months));
}

/** The level monthly amount that closes a gap by the due date, money earning the rate on the way. */
export function monthlyNeededMinor(gapMinor: number, rateBps: number, months: number): number {
  if (gapMinor <= 0 || months <= 0) return 0;
  const monthlyRate = rateBps / 10_000 / 12;
  if (monthlyRate === 0) return roundHalfAwayFromZero(gapMinor / months);
  return roundHalfAwayFromZero((gapMinor * monthlyRate) / ((1 + monthlyRate) ** months - 1));
}

/**
 * Where a goal stands: what funds it today, what each stage will cost, which stage is being saved for,
 * and the monthly amount that closes the gap.
 */
export function goalPlan(goal: Goal, links: GoalLink[], plannedMonthlyMinor: number, monthlyOutgoingMinor: number, today: string): GoalPlan {
  // Only what can be counted in one currency is added up: `valueMinor` is each account's own money, and
  // summing a USD set-aside into an IDR total was adding 10_003 where Rp 1.600.480 belonged — or, on a
  // US$50.000 holding, Rp 5.000.000 where Rp 800.000.000 belonged. A link with no rate is excluded, and
  // `goalPlansFor` says so beside the goal rather than quietly under-reporting it.
  const currentMinor = links.reduce((total, link) => total + (link.baseMinor ?? 0), 0);
  const ordered = [...goal.stages].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));

  let carryMinor = currentMinor;
  let requiredMonthlyMinor: number | null = null;
  const stages: StagePlan[] = [];

  for (const stage of ordered) {
    const months = monthsUntil(today, stage.dueOn);
    const todayMinor = stage.targetMinor ?? (stage.targetMonths ?? 0) * monthlyOutgoingMinor;
    const targetMinor = futureValueMinor(todayMinor, goal.growthBps, months);
    const row = { stageId: stage.id, name: stage.name, dueOn: stage.dueOn, months, todayMinor, targetMinor };

    if (stage.paidOn) {
      stages.push({ ...row, state: 'paid' });
      continue;
    }
    if (requiredMonthlyMinor !== null) {
      stages.push({ ...row, state: 'later' });
      continue;
    }
    const availableMinor = futureValueMinor(carryMinor, goal.returnBps, months);
    if (availableMinor >= targetMinor) {
      // The surplus keeps funding the next stage, so bring it back to today's money.
      carryMinor = roundHalfAwayFromZero((availableMinor - targetMinor) / yearlyFactor(goal.returnBps, months));
      stages.push({ ...row, state: 'covered' });
      continue;
    }
    requiredMonthlyMinor = monthlyNeededMinor(targetMinor - availableMinor, goal.returnBps, months);
    carryMinor = 0;
    stages.push({ ...row, state: 'saving' });
  }

  const needed = requiredMonthlyMinor ?? 0;
  const planned = plannedMonthlyMinor + goal.standingMonthlyMinor;
  const status: GoalStatus = needed === 0 ? 'funded' : planned >= needed * ON_TRACK_SHARE ? 'on_track' : 'behind';
  const unpaid = stages.filter((stage) => stage.state !== 'paid');
  const lastMonths = unpaid.length > 0 ? unpaid[unpaid.length - 1]!.months : 0;
  const risky = links.find((link) => link.risk === 'high');
  const riskWarning =
    unpaid.length > 0 && lastMonths <= RISK_HORIZON_MONTHS && risky
      ? `${goal.name} is due in ${lastMonths} months but is held in ${risky.name}, which can fall in value before you need it.`
      : null;

  return {
    goalId: goal.id,
    currentMinor,
    totalTargetMinor: unpaid.reduce((total, stage) => total + stage.targetMinor, 0),
    stages,
    requiredMonthlyMinor: needed,
    plannedMonthlyMinor: planned,
    status,
    shortfallMonthlyMinor: status === 'behind' ? needed - planned : 0,
    riskWarning,
  };
}

/** Fills goals from what you can save: compulsory goals first, then additional ones, each in rank order. */
export function fitByRank(plans: GoalPlan[], goals: Goal[], capacityMonthlyMinor: number): RankFit[] {
  const order = fundingOrder(goals).map((goal) => goal.id);
  const position = (goalId: string) => {
    const index = order.indexOf(goalId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const ordered = [...plans].sort((a, b) => position(a.goalId) - position(b.goalId));
  let left = Math.max(0, capacityMonthlyMinor);
  return ordered.map((plan) => {
    const needed = plan.requiredMonthlyMinor;
    if (needed <= 0) return { goalId: plan.goalId, fundedMonthlyMinor: 0, fits: 'full' as const };
    if (left >= needed) {
      left -= needed;
      return { goalId: plan.goalId, fundedMonthlyMinor: needed, fits: 'full' as const };
    }
    const funded = left;
    left = 0;
    return { goalId: plan.goalId, fundedMonthlyMinor: funded, fits: funded > 0 ? ('partial' as const) : ('none' as const) };
  });
}
