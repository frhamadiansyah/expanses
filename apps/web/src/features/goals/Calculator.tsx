import { type EmergencyBase, HOUSEHOLDS, type Household, INCOME_STABILITIES, type IncomeStability, isoDate, parseMajor } from '@expanses/core';
import { type CalculatorKind, type EmergencyInputs, type GoalRow, saveGoalCalculator } from '@expanses/db';
import { type FormEvent, type ReactElement, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { emergencyDraftFrom, emergencyInputsOf, HOUSEHOLD_LABELS, INCOME_LABELS, monthsNote, typedMonths, withAnswers } from './emergency-form';
import { useGoalCalculators } from './queries';

/** The kinds a calculator exists for. Everything else is typed in, because only you know the figure. */
export const CALCULABLE: CalculatorKind[] = ['emergency', 'education', 'retirement'];

export function calculatorKindOf(kind: string): CalculatorKind | null {
  return CALCULABLE.includes(kind as CalculatorKind) ? (kind as CalculatorKind) : null;
}

const percentToBps = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);

const BLURBS: Record<CalculatorKind, string> = {
  emergency: 'Months of what you spend, with loan principal added. The amount follows your spending, so it moves when your spending does.',
  education: 'Each year of study is worked out at the price it will cost in the year you pay it, not at today’s.',
  retirement: 'What the pot must hold on the day you stop, drawn down over your retirement while it keeps earning.',
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
  return <CalculatorForm key={goal.id} goal={goal} saved={saved?.kind === 'emergency' ? (saved.inputs as EmergencyInputs) : undefined} onDone={onDone} />;
}

function CalculatorForm({ goal, saved, onDone }: { goal: GoalRow; saved: EmergencyInputs | undefined; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const kind = calculatorKindOf(goal.kind)!;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Emergency
  const [emergency, setEmergency] = useState(() => emergencyDraftFrom(saved));
  // Education
  const [feeToday, setFeeToday] = useState('');
  const [startsIn, setStartsIn] = useState('10');
  const [yearsOfStudy, setYearsOfStudy] = useState('4');
  const [feeInflation, setFeeInflation] = useState('10');
  // Retirement
  const [annualSpend, setAnnualSpend] = useState('');
  const [yearsToRetirement, setYearsToRetirement] = useState('20');
  const [yearsInRetirement, setYearsInRetirement] = useState('20');
  const [inflation, setInflation] = useState('5');
  const [returnInRetirement, setReturnInRetirement] = useState('8');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const inputs =
        kind === 'emergency'
          ? emergencyInputsOf(emergency)
          : kind === 'education'
            ? {
                feeTodayMinor: parseMajor(feeToday, ws.baseCurrency),
                startsInYears: Number(startsIn),
                yearsOfStudy: Number(yearsOfStudy),
                feeInflationBps: percentToBps(feeInflation),
              }
            : {
                annualSpendTodayMinor: parseMajor(annualSpend, ws.baseCurrency),
                yearsToRetirement: Number(yearsToRetirement),
                yearsInRetirement: Number(yearsInRetirement),
                inflationBps: percentToBps(inflation),
                returnInRetirementBps: percentToBps(returnInRetirement),
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
        ? [
            <TextRow key="fee" label={`Fee a year today (${ws.baseCurrency})`} value={feeToday} onChange={(e) => setFeeToday(e.target.value)} inputMode="numeric" required />,
            <TextRow key="starts" label="Years until it starts" value={startsIn} onChange={(e) => setStartsIn(e.target.value)} inputMode="numeric" required />,
            <TextRow key="years" label="Years of study" value={yearsOfStudy} onChange={(e) => setYearsOfStudy(e.target.value)} inputMode="numeric" required />,
            <TextRow
              key="inflation"
              label="Fee inflation a year (%)"
              hint="School fees usually outrun everything else."
              value={feeInflation}
              onChange={(e) => setFeeInflation(e.target.value)}
              inputMode="decimal"
              required
            />,
          ]
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
      <InsetGroup header={`Work out ${goal.name}`} footer={BLURBS[kind]}>
        {rows}
      </InsetGroup>
      <ErrorBox error={error} />
      {/* `requestSubmit` rather than calling `submit`: the browser still checks the required rows first. */}
      <InsetGroup>
        <InsetRow title="Use this amount" chevron={false} disabled={busy} onClick={() => formRef.current?.requestSubmit()} />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </form>
  );
}
