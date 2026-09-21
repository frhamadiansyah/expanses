import { DEFAULT_INFLATION_BPS, DRAWDOWN_RETURN_BPS, RETIREMENT_RETURN_BPS, type RetirementInputs, retirementTargetMinor, savingPlanFor } from '@expanses/core';
import { type Field, readMoney, readPercent, readWhole } from './fields';

/** The retirement boxes as typed. */
export interface RetirementDraft {
  annualSpend: string;
  ageNow: string;
  retireAge: string;
  yearsInRetirement: string;
  inflation: string;
  returnBefore: string;
  returnInRetirement: string;
  alreadySaved: string;
}

/** The agreed prefills: 3.5% inflation, 10% while saving, 5% while retired. */
export const RETIREMENT_DEFAULTS: RetirementDraft = {
  annualSpend: '',
  ageNow: '35',
  retireAge: '55',
  yearsInRetirement: '20',
  inflation: String(DEFAULT_INFLATION_BPS / 100),
  returnBefore: String(RETIREMENT_RETURN_BPS / 100),
  returnInRetirement: String(DRAWDOWN_RETURN_BPS / 100),
  alreadySaved: '',
};

export interface RetirementAnswer {
  /** The pot on the day you stop — for showing; the goal stores it in today's money. */
  targetMinor: number;
  monthlyMinor: number;
  gapMinor: number;
  /** The rate the monthly figure is saved at: the return while saving. */
  returnBps: number;
}

export interface RetirementWorking {
  problems: Partial<Record<keyof RetirementDraft, string>>;
  /** What a saved goal is given, once every box reads. */
  inputs: RetirementInputs | null;
  answer: RetirementAnswer | null;
}

/**
 * Reads every box and works the answer out, never throwing: a box that does not read puts its sentence on its own
 * row, and the answer waits. The monthly figure is saved at the return while saving — the drawdown return only sizes
 * the pot.
 */
export function retirementWorking(draft: RetirementDraft, currency: string): RetirementWorking {
  const problems: RetirementWorking['problems'] = {};
  const read = <T>(key: keyof RetirementDraft, field: Field<T>): T | null => {
    if (field.ok) return field.value;
    problems[key] = field.problem;
    return null;
  };
  const annualSpend = read('annualSpend', readMoney(draft.annualSpend, currency));
  const ageNow = read('ageNow', readWhole(draft.ageNow));
  const retireAge = read('retireAge', readWhole(draft.retireAge));
  const yearsInRetirement = read('yearsInRetirement', readWhole(draft.yearsInRetirement));
  const inflationBps = read('inflation', readPercent(draft.inflation));
  const returnBeforeBps = read('returnBefore', readPercent(draft.returnBefore));
  const returnInRetirementBps = read('returnInRetirement', readPercent(draft.returnInRetirement));
  const alreadySaved = read('alreadySaved', readMoney(draft.alreadySaved, currency));
  if (ageNow !== null && retireAge !== null && retireAge <= ageNow) problems.retireAge = 'Retiring comes after now';
  if (yearsInRetirement === 0) problems.yearsInRetirement = 'At least one year';

  const none = { problems, inputs: null, answer: null };
  if (Object.keys(problems).length > 0 || !annualSpend) return none;
  const inputs: RetirementInputs = {
    version: 2,
    annualSpendTodayMinor: annualSpend,
    yearsToRetirement: retireAge! - ageNow!,
    yearsInRetirement: yearsInRetirement!,
    inflationBps: inflationBps!,
    returnBeforeBps: returnBeforeBps!,
    returnInRetirementBps: returnInRetirementBps!,
  };
  try {
    const targetMinor = retirementTargetMinor(inputs);
    const plan = savingPlanFor({ targetMinor, alreadySavedMinor: alreadySaved!, returnBps: returnBeforeBps!, months: inputs.yearsToRetirement * 12 });
    if (![targetMinor, plan.monthlyMinor, plan.gapMinor].every(Number.isSafeInteger)) {
      return { problems: { annualSpend: 'Too large to work out' }, inputs: null, answer: null };
    }
    return { problems, inputs, answer: { targetMinor, monthlyMinor: plan.monthlyMinor, gapMinor: plan.gapMinor, returnBps: returnBeforeBps! } };
  } catch (error) {
    return { problems: { annualSpend: error instanceof Error ? error.message : 'Cannot be worked out' }, inputs: null, answer: null };
  }
}
