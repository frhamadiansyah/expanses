import {
  DEFAULT_INFLATION_BPS,
  DRAWDOWN_RETURN_BPS,
  type EducationInputs,
  educationFromV1,
  type EducationPlanInputs,
  groupedMajorString,
  groupTypedAmount,
  isoDate,
  parseGroupedMajor,
  RETIREMENT_RETURN_BPS,
  type RetirementInputs,
} from '@expanses/core';
import { type CalculatorKind, type EmergencyInputs, type GoalCalculatorRow, type GoalRow, saveGoalCalculator } from '@expanses/db';
import { type FormEvent, type ReactElement, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, TextRow } from '../../ui/native';
import { Answer } from '../calculators/parts';
import { EducationEditor } from './EducationEditor';
import { educationDraftFrom, educationInputsOf } from './education-model';
import { useEmergencyFields } from '../calculators/emergency-fields';
import { useGoalCalculators, useGoalPlans } from './queries';

/** The kinds a calculator exists for. Everything else is typed in, because only you know the figure. */
export const CALCULABLE: CalculatorKind[] = ['emergency', 'education', 'retirement'];

export function calculatorKindOf(kind: string): CalculatorKind | null {
  return CALCULABLE.includes(kind as CalculatorKind) ? (kind as CalculatorKind) : null;
}

/** "3,5" or "3.5" as basis points; a box half-typed ("-", ",") is refused with a sentence rather than saved as NaN. */
function percentToBps(value: string, what: string): number {
  const trimmed = value.trim().replace(',', '.');
  const number = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(number)) throw new Error(`${what} must be a percentage`);
  return Math.round(number * 100);
}

const percentOf = (bps: number) => String(bps / 100);

const BLURBS: Record<CalculatorKind, string> = {
  emergency: 'Months of spending, with loan principal added. The amount follows that spending, so it moves when spending does.',
  education: 'Each year at today’s prices; the goal raises each one to the year it is paid.',
  retirement: 'What the pot must hold the day saving stops, drawn down while it keeps earning.',
};

/**
 * Waits for the saved workings before the form opens, so a working saved earlier reopens as it was saved rather
 * than on the defaults the form would otherwise start from.
 */
export function Calculator({ goal, onDone, onCancel }: { goal: GoalRow; onDone: () => void; onCancel?: () => void }) {
  const calculators = useGoalCalculators();
  if (!calculators.isSuccess) return null;
  const saved = calculators.data.find((row) => row.goalId === goal.id);
  if (goal.kind === 'emergency') return <EmergencyWorking key={goal.id} goal={goal} saved={saved} onDone={onDone} onCancel={onCancel} />;
  return <CalculatorForm key={goal.id} goal={goal} saved={saved} onDone={onDone} onCancel={onCancel} />;
}

/** A saved education working as levels: one from before levels existed is read as the one course it described. */
function savedEducation(saved: GoalCalculatorRow | undefined): EducationPlanInputs | undefined {
  if (saved?.kind !== 'education') return undefined;
  return 'feeTodayMinor' in saved.inputs ? educationFromV1(saved.inputs as EducationInputs, saved.computedAt.slice(0, 10)) : (saved.inputs as EducationPlanInputs);
}

function CalculatorForm({ goal, saved, onDone, onCancel }: { goal: GoalRow; saved: GoalCalculatorRow | undefined; onDone: () => void; onCancel?: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const kind = calculatorKindOf(goal.kind)!;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Education: the saved levels come back as they were saved, ids and typed returns included.
  const [education, setEducation] = useState(() => educationDraftFrom(savedEducation(saved), ws.baseCurrency));
  // Retirement: the saved working, or the agreed prefills — 3.5% inflation, 10% while saving, 5% while retired.
  const retirement = saved?.kind === 'retirement' ? (saved.inputs as RetirementInputs) : undefined;
  const [annualSpend, setAnnualSpend] = useState(() => (retirement ? groupedMajorString(retirement.annualSpendTodayMinor, ws.baseCurrency) : ''));
  const [yearsToRetirement, setYearsToRetirement] = useState(() => String(retirement?.yearsToRetirement ?? 20));
  const [yearsInRetirement, setYearsInRetirement] = useState(() => String(retirement?.yearsInRetirement ?? 20));
  const [inflation, setInflation] = useState(() => percentOf(retirement?.inflationBps ?? DEFAULT_INFLATION_BPS));
  const [returnBefore, setReturnBefore] = useState(() => percentOf(retirement?.returnBeforeBps ?? goal.returnBps ?? RETIREMENT_RETURN_BPS));
  const [returnInRetirement, setReturnInRetirement] = useState(() => percentOf(retirement?.returnInRetirementBps ?? DRAWDOWN_RETURN_BPS));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const inputs =
        kind === 'education'
          ? educationInputsOf(education, ws.baseCurrency)
          : {
              version: 2 as const,
              annualSpendTodayMinor: parseGroupedMajor(annualSpend, ws.baseCurrency),
              yearsToRetirement: Number(yearsToRetirement.replace(',', '.')),
              yearsInRetirement: Number(yearsInRetirement.replace(',', '.')),
              inflationBps: percentToBps(inflation, 'Inflation'),
              returnBeforeBps: percentToBps(returnBefore, 'The return while saving'),
              returnInRetirementBps: percentToBps(returnInRetirement, 'The return while retired'),
            };
      await saveGoalCalculator(database, ws, { goalId: goal.id, kind, inputs, today: isoDate() });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // The group places each row it is handed, so the rows are a flat list rather than fragments.
  const rows: ReactElement[] =
    kind === 'education'
      ? []
      : [
          <TextRow
            key="spend"
            label="Yearly spending in retirement"
            prefix={ws.baseCurrency}
            hint="At today's prices. Inflation is applied automatically."
            value={annualSpend}
            onChange={(e) => setAnnualSpend(groupTypedAmount(e.target.value, ws.baseCurrency))}
            inputMode="decimal"
            placeholder="Amount"
            required
          />,
          <TextRow
            key="to"
            label="Years until retirement"
            value={yearsToRetirement}
            onChange={(e) => setYearsToRetirement(e.target.value)}
            inputMode="numeric"
            required
          />,
          <TextRow
            key="in"
            label="Years in retirement"
            value={yearsInRetirement}
            onChange={(e) => setYearsInRetirement(e.target.value)}
            inputMode="numeric"
            required
          />,
          <TextRow key="inflation" label="Inflation a year (%)" value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" required />,
          <TextRow
            key="before"
            label="Return while saving (%)"
            hint="What the money earns until saving stops. Written as the goal's return."
            value={returnBefore}
            onChange={(e) => setReturnBefore(e.target.value)}
            inputMode="decimal"
            required
          />,
          <TextRow
            key="return"
            label="Return while retired (%)"
            hint="What the pot earns while it is being spent."
            value={returnInRetirement}
            onChange={(e) => setReturnInRetirement(e.target.value)}
            inputMode="decimal"
            required
          />,
        ];

  return (
    <form ref={formRef} onSubmit={submit}>
      {kind === 'education' ? (
        <>
          <InsetGroup header={`Work out ${goal.name}`} footer={BLURBS[kind]}>
            <ReadOnlyRow label="Levels" value={education.levels.length === 0 ? 'None yet' : String(education.levels.length)} />
          </InsetGroup>
          <EducationEditor value={education} onChange={setEducation} currency={ws.baseCurrency} today={isoDate()} />
        </>
      ) : (
        <InsetGroup header={`Work out ${goal.name}`} footer={BLURBS[kind]}>
          {rows}
        </InsetGroup>
      )}
      <ErrorBox error={error} />
      {/* `requestSubmit` rather than calling `submit`: the browser still checks the required rows first. */}
      <InsetGroup>
        <InsetRow title="Use this amount" action disabled={busy} onClick={() => formRef.current?.requestSubmit()} />
        {/* Back to the goal's fields when the working was opened from them: the same page, one step up. */}
        <InsetRow title="Cancel" action onClick={onCancel ?? onDone} />
      </InsetGroup>
    </form>
  );
}

/**
 * An emergency fund's own Calculator: the standalone calculator's rows, in the same order, so nothing is learnt twice.
 * It waits for the goal's plan, because what goes out a month opens on the figure the goal already uses.
 */
function EmergencyWorking({ goal, saved, onDone, onCancel }: { goal: GoalRow; saved: GoalCalculatorRow | undefined; onDone: () => void; onCancel?: () => void }) {
  const plans = useGoalPlans(isoDate());
  if (!plans.isSuccess) return null;
  const plan = plans.data.plans.find((row) => row.goalId === goal.id);
  return <EmergencyWorkingForm goal={goal} saved={saved} targetMinor={plan?.totalTargetMinor ?? 0} onDone={onDone} onCancel={onCancel} />;
}

function EmergencyWorkingForm({
  goal,
  saved,
  targetMinor,
  onDone,
  onCancel,
}: {
  goal: GoalRow;
  saved: GoalCalculatorRow | undefined;
  targetMinor: number;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const working = saved?.kind === 'emergency' ? (saved.inputs as EmergencyInputs) : undefined;
  // The figure the goal reads today: what the working typed, else the goal's target spread over its months.
  const months = goal.stages.find((stage) => stage.targetMonths !== null)?.targetMonths ?? 0;
  const derived = months > 0 && targetMinor > 0 ? Math.round(targetMinor / months) : 0;
  const { fields, inputs, answer, targetRow } = useEmergencyFields({
    inputs: working,
    outgoing: working?.monthlyOutgoingMinor || derived === 0 ? undefined : groupedMajorString(derived, ws.baseCurrency),
    // A goal worked out before the horizon was asked fell due two years on.
    horizon: 24,
    returnPercent: goal.returnBps / 100,
  });

  async function save() {
    if (!inputs) return;
    setError(null);
    setBusy(true);
    try {
      await saveGoalCalculator(database, ws, { goalId: goal.id, kind: 'emergency', inputs, today: isoDate() });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {fields}
      <Answer answer={answer} testId="answer-emergency" />
      {answer && <InsetGroup>{targetRow}</InsetGroup>}
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Save goal" action disabled={busy || answer === null || inputs === null} onClick={() => void save()} />
        {/* Back to the goal's fields when the working was opened from them: the same page, one step up. */}
        <InsetRow title="Cancel" action onClick={onCancel ?? onDone} />
      </InsetGroup>
    </div>
  );
}
