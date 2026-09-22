import {
  DEFAULT_INFLATION_BPS,
  DRAWDOWN_RETURN_BPS,
  type EducationInputs,
  educationFromV1,
  type EducationPlanInputs,
  type EmergencyBase,
  HOUSEHOLDS,
  type Household,
  INCOME_STABILITIES,
  type IncomeStability,
  isoDate,
  minorToMajorString,
  parseMajor,
  RETIREMENT_RETURN_BPS,
  type RetirementInputs,
} from '@expanses/core';
import { type CalculatorKind, type EmergencyInputs, type GoalCalculatorRow, type GoalRow, saveGoalCalculator } from '@expanses/db';
import { type FormEvent, type ReactElement, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { EducationEditor } from './EducationEditor';
import { educationDraftFrom, educationInputsOf } from './education-model';
import { emergencyDraftFrom, emergencyInputsOf, HOUSEHOLD_LABELS, INCOME_LABELS, monthsNote, typedMonths, withAnswers } from './emergency-form';
import { useGoalCalculators } from './queries';

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
  emergency: 'Months of what you spend, with loan principal added. The amount follows your spending, so it moves when your spending does.',
  education: 'Each year at today’s prices; the goal raises each one to the year it is paid.',
  retirement: 'What the pot must hold the day you stop, drawn down while it keeps earning.',
};

/** The goal's own base, said beside the switch: the ratio card on Net worth has a switch of its own, and the two can differ. */
const BASE_HINTS: Record<EmergencyBase, string> = {
  essential: 'Leaves out categories marked lifestyle. For this goal only; the emergency ratio on Net worth has its own switch.',
  all: 'Every category, lifestyle included. For this goal only; the emergency ratio on Net worth has its own switch.',
};

/**
 * Waits for the saved workings before the form opens, so a working saved earlier reopens as it was saved rather
 * than on the defaults the form would otherwise start from.
 */
export function Calculator({ goal, onDone }: { goal: GoalRow; onDone: () => void }) {
  const calculators = useGoalCalculators();
  if (!calculators.isSuccess) return null;
  const saved = calculators.data.find((row) => row.goalId === goal.id);
  return <CalculatorForm key={goal.id} goal={goal} saved={saved} onDone={onDone} />;
}

/** A saved education working as levels: one from before levels existed is read as the one course it described. */
function savedEducation(saved: GoalCalculatorRow | undefined): EducationPlanInputs | undefined {
  if (saved?.kind !== 'education') return undefined;
  return 'feeTodayMinor' in saved.inputs ? educationFromV1(saved.inputs as EducationInputs, saved.computedAt.slice(0, 10)) : (saved.inputs as EducationPlanInputs);
}

function CalculatorForm({ goal, saved, onDone }: { goal: GoalRow; saved: GoalCalculatorRow | undefined; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const kind = calculatorKindOf(goal.kind)!;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Emergency
  const [emergency, setEmergency] = useState(() => emergencyDraftFrom(saved?.kind === 'emergency' ? (saved.inputs as EmergencyInputs) : undefined));
  // Education: the saved levels come back as they were saved, ids and typed returns included.
  const [education, setEducation] = useState(() => educationDraftFrom(savedEducation(saved), ws.baseCurrency));
  // Retirement: the saved working, or the agreed prefills — 3.5% inflation, 10% while saving, 5% while retired.
  const retirement = saved?.kind === 'retirement' ? (saved.inputs as RetirementInputs) : undefined;
  const [annualSpend, setAnnualSpend] = useState(() => (retirement ? minorToMajorString(retirement.annualSpendTodayMinor, ws.baseCurrency) : ''));
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
        kind === 'emergency'
          ? emergencyInputsOf(emergency)
          : kind === 'education'
            ? educationInputsOf(education, ws.baseCurrency)
            : {
                version: 2 as const,
                annualSpendTodayMinor: parseMajor(annualSpend, ws.baseCurrency),
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
    kind === 'emergency'
      ? [
          <SelectRow
            key="household"
            label="Household"
            value={emergency.household}
            onChange={(e) => setEmergency((d) => withAnswers(d, { household: e.target.value as Household }))}
          >
            {HOUSEHOLDS.map((key) => (
              <option key={key} value={key}>
                {HOUSEHOLD_LABELS[key]}
              </option>
            ))}
          </SelectRow>,
          <SelectRow
            key="income"
            label="Income"
            value={emergency.income}
            onChange={(e) => setEmergency((d) => withAnswers(d, { income: e.target.value as IncomeStability }))}
          >
            {INCOME_STABILITIES.map((key) => (
              <option key={key} value={key}>
                {INCOME_LABELS[key]}
              </option>
            ))}
          </SelectRow>,
          <TextRow
            key="months"
            label="Months of outgoings"
            hint={monthsNote(emergency)}
            value={emergency.months}
            onChange={(e) => setEmergency((d) => typedMonths(d, e.target.value))}
            inputMode="decimal"
            required
          />,
          <SelectRow
            key="base"
            label="Counts"
            hint={BASE_HINTS[emergency.base]}
            value={emergency.base}
            onChange={(e) => setEmergency((d) => ({ ...d, base: e.target.value as EmergencyBase }))}
          >
            <option value="essential">Essential spending</option>
            <option value="all">All spending</option>
          </SelectRow>,
        ]
      : kind === 'education'
        ? []
        : [
            <TextRow
              key="spend"
              label={`Yearly spending in retirement (${ws.baseCurrency})`}
              hint="At today's prices. Inflation is applied for you."
              value={annualSpend}
              onChange={(e) => setAnnualSpend(e.target.value)}
              inputMode="numeric"
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
              hint="What the money earns until you stop. Written as the goal's return."
              value={returnBefore}
              onChange={(e) => setReturnBefore(e.target.value)}
              inputMode="decimal"
              required
            />,
            <TextRow
              key="return"
              label="Return while retired (%)"
              hint="What the pot earns while you are spending it."
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
        <InsetRow title="Use this amount" chevron={false} disabled={busy} onClick={() => formRef.current?.requestSubmit()} />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </form>
  );
}
