import { DEFAULT_INFLATION_BPS, DRAWDOWN_RETURN_BPS, type LifeCover, type LifeCoverInputs, lifeCoverMinor, type SheetTotals, type StagePlan } from '@expanses/core';
import type { LifeCoverSaved } from '@expanses/db';
import { type Field, readMoney, readPercent, readWhole } from './fields';

/**
 * What life cover opens on. Debts and liquid assets come from the balance sheet, through `sheetTotals` — the reader the
 * net-worth page uses — and are null when an account's currency has no rate yet: a figure missing an account is
 * flagged, never passed off as the whole.
 */
export interface LifeCoverPrefill {
  debtsMinor: number | null;
  liquidAssetsMinor: number | null;
  educationMinor: number;
  missingRates: string[];
}

/** The typed boxes; `undefined` in a prefilled one means "not touched", so the prefill stands. One shape with the store's. */
export type LifeCoverDraft = LifeCoverSaved;

export const LIFE_COVER_DEFAULTS: LifeCoverDraft = {
  annualNeed: '',
  years: '10',
  inflation: String(DEFAULT_INFLATION_BPS / 100),
  returnPercent: String(DRAWDOWN_RETURN_BPS / 100),
  finalExpenses: '',
  inForce: '',
  debts: undefined,
  education: undefined,
  liquidAssets: undefined,
};

/** Debts and liquid assets from the balance sheet; education from the stages of education goals not yet paid, in today's money. */
export function lifeCoverPrefill(
  totals: SheetTotals,
  plans: readonly { goal: { kind: string }; stages: readonly Pick<StagePlan, 'state' | 'todayMinor'>[] }[],
  missingRates: readonly string[] = [],
): LifeCoverPrefill {
  const educationMinor = plans
    .filter((plan) => plan.goal.kind === 'education')
    .flatMap((plan) => plan.stages)
    .filter((stage) => stage.state !== 'paid')
    .reduce((total, stage) => total + stage.todayMinor, 0);
  const known = missingRates.length === 0;
  return {
    debtsMinor: known ? totals.liabilitiesMinor : null,
    liquidAssetsMinor: known ? totals.liquidMinor : null,
    educationMinor,
    missingRates: [...missingRates],
  };
}

export interface LifeCoverWorking {
  problems: Partial<Record<keyof LifeCoverDraft, string>>;
  inputs: LifeCoverInputs | null;
  result: LifeCover | null;
}

/** Every box read once; a box that does not read puts its sentence on its own row. Never throws. */
export function lifeCoverWorking(draft: LifeCoverDraft, prefill: LifeCoverPrefill, currency: string): LifeCoverWorking {
  const problems: LifeCoverWorking['problems'] = {};
  const read = <T>(key: keyof LifeCoverDraft, field: Field<T>): T | null => {
    if (field.ok) return field.value;
    problems[key] = field.problem;
    return null;
  };
  const noRate = `No rate for ${prefill.missingRates.join(', ')} yet, so the balance sheet cannot count those accounts. Type the figure.`;
  const prefilled = (key: 'debts' | 'education' | 'liquidAssets', typed: string | undefined, from: number | null) => {
    if (typed !== undefined) return read(key, readMoney(typed, currency));
    if (from === null) problems[key] = noRate;
    return from;
  };
  const inputs = {
    annualNeedTodayMinor: read('annualNeed', readMoney(draft.annualNeed, currency)),
    yearsOfSupport: read('years', readWhole(draft.years)),
    inflationBps: read('inflation', readPercent(draft.inflation)),
    returnBps: read('returnPercent', readPercent(draft.returnPercent)),
    debtsMinor: prefilled('debts', draft.debts, prefill.debtsMinor),
    educationMinor: prefilled('education', draft.education, prefill.educationMinor),
    finalExpensesMinor: read('finalExpenses', readMoney(draft.finalExpenses, currency)),
    liquidAssetsMinor: prefilled('liquidAssets', draft.liquidAssets, prefill.liquidAssetsMinor),
    inForceCoverMinor: read('inForce', readMoney(draft.inForce, currency)),
  };
  if (Object.keys(problems).length > 0) return { problems, inputs: null, result: null };
  const whole = inputs as LifeCoverInputs;
  if (whole.annualNeedTodayMinor <= 0) return { problems, inputs: whole, result: null };
  try {
    const result = lifeCoverMinor(whole);
    if (!Object.values(result).every(Number.isSafeInteger)) return { problems: { annualNeed: 'Too large to work out' }, inputs: null, result: null };
    return { problems, inputs: whole, result };
  } catch (error) {
    return { problems: { annualNeed: error instanceof Error ? error.message : 'Cannot be worked out' }, inputs: null, result: null };
  }
}

/** The inputs the typed boxes give, the prefill standing where nothing was typed. Throws the first refusal's sentence. */
export function lifeCoverInputsOf(draft: LifeCoverDraft, prefill: LifeCoverPrefill, currency: string): LifeCoverInputs {
  const working = lifeCoverWorking(draft, prefill, currency);
  const first = Object.values(working.problems)[0];
  if (first) throw new Error(first);
  return working.inputs!;
}
