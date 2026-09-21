import { type EducationPlanInputs, educationPlanStages, type Goal, goalPlan } from '@expanses/core';
import { type EducationDraft, educationInputsOf } from '../goals/education-model';

export interface EducationWorking {
  /** The sentence shown instead of an answer, or null. */
  problem: string | null;
  inputs: EducationPlanInputs | null;
  answer: { totalMinor: number; monthlyMinor: number } | null;
}

/**
 * The levels as the goal they would make, answered by the goal engine itself: stages in today's money, inflated once
 * at the fee inflation, each saved for at its own return. So the page and the goal it saves cannot disagree. Never
 * throws; with no level yet there is simply no answer.
 */
export function educationWorking(draft: EducationDraft, currency: string, today: string): EducationWorking {
  if (draft.levels.length === 0) return { problem: null, inputs: null, answer: null };
  try {
    const inputs = educationInputsOf(draft, currency);
    const stages = educationPlanStages(inputs, today);
    const goal: Goal = {
      id: 'calculator',
      name: 'Education fund',
      kind: 'education',
      rank: 0,
      growthBps: inputs.feeInflationBps,
      returnBps: stages[0]?.returnBps ?? 0,
      standingMonthlyMinor: 0,
      standingNote: null,
      stages: stages.map((stage) => ({
        id: stage.key,
        name: stage.name,
        targetMinor: stage.targetTodayMinor,
        targetMonths: null,
        dueOn: stage.dueOn,
        paidOn: null,
        returnBps: stage.returnBps,
      })),
    };
    const plan = goalPlan(goal, [], 0, 0, today);
    if (!Number.isSafeInteger(plan.totalTargetMinor) || !Number.isSafeInteger(plan.requiredMonthlyMinor)) {
      return { problem: 'Too large to work out', inputs: null, answer: null };
    }
    return { problem: null, inputs, answer: { totalMinor: plan.totalTargetMinor, monthlyMinor: plan.requiredMonthlyMinor } };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : 'Cannot be worked out', inputs: null, answer: null };
  }
}
