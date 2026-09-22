import { EMERGENCY_RETURN_BPS, emergencyTargetMinor, HOUSEHOLDS, type Household, INCOME_STABILITIES, type IncomeStability, isoDate, parseMajor, savingPlanFor } from '@expanses/core';
import { createGoalFromCalculator, type EmergencyInputs } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { emergencyDraftFrom, emergencyInputsOf, HOUSEHOLD_LABELS, INCOME_LABELS, monthsNote, typedMonths, withAnswers } from '../goals/emergency-form';
import { EMERGENCY_FUND } from './catalogue';
import { readPercent, readWhole } from './fields';
import { Answer, CalculatorPage, SaveRow } from './parts';

/** Months of what goes out, loan principal included — and the monthly saving that gets there over a horizon and a rate you set. */
export function EmergencyFundPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [emergency, setEmergency] = useState(() => emergencyDraftFrom());
  const [monthlyOutgoing, setMonthlyOutgoing] = useState('');
  // The two assumptions the answer used to bury, written into the boxes they were made in: a year, and `EMERGENCY_RETURN_BPS`.
  const [horizon, setHorizon] = useState('12');
  const [returnPercent, setReturnPercent] = useState(String(EMERGENCY_RETURN_BPS / 100));

  const money = (value: string) => {
    try {
      return value.trim() === '' ? 0 : parseMajor(value, ws.baseCurrency);
    } catch {
      return 0;
    }
  };

  // The plan's two boxes, read the way every other box on the page is: a figure they refuse says so on its own row.
  const readMonths = readWhole(horizon);
  const horizonProblem = readMonths.ok
    ? readMonths.value >= 1
      ? undefined
      : 'Not below one month'
    : readMonths.problem.replace('Whole years', 'Whole months').replace('like 10', 'like 12');
  const readReturn = readPercent(returnPercent);
  const returnProblem = readReturn.ok ? (readReturn.value >= 0 ? undefined : 'Not below nothing') : readReturn.problem;

  // The months are read by the one reader the goal's own working uses, which takes "9,5"; a figure it refuses shows no answer.
  let emergencyInputs: EmergencyInputs | null = null;
  let emergencyAnswer: { targetMinor: number; monthlyMinor: number; covered: boolean } | null = null;
  try {
    emergencyInputs = emergencyInputsOf(emergency);
    if (readMonths.ok && readMonths.value >= 1 && readReturn.ok && readReturn.value >= 0 && money(monthlyOutgoing) > 0) {
      const targetMinor = emergencyTargetMinor(emergencyInputs.months, money(monthlyOutgoing));
      const plan = savingPlanFor({ targetMinor, alreadySavedMinor: 0, returnBps: readReturn.value, months: readMonths.value });
      emergencyAnswer = { targetMinor, monthlyMinor: plan.monthlyMinor, covered: plan.gapMinor === 0 };
    }
  } catch {
    emergencyInputs = null;
    emergencyAnswer = null;
  }

  async function save() {
    if (!emergencyInputs) return;
    setError(null);
    try {
      await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs: emergencyInputs as never, today });
      await invalidate();
      setSaved('Saved Emergency fund as a goal.');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <CalculatorPage entry={EMERGENCY_FUND} error={error} saved={saved}>
      <InsetGroup>
        <SelectRow
          label="Household"
          value={emergency.household}
          onChange={(e) => setEmergency((d) => withAnswers(d, { household: e.target.value as Household }))}
        >
          {HOUSEHOLDS.map((key) => (
            <option key={key} value={key}>
              {HOUSEHOLD_LABELS[key]}
            </option>
          ))}
        </SelectRow>
        <SelectRow
          label="Income"
          value={emergency.income}
          onChange={(e) => setEmergency((d) => withAnswers(d, { income: e.target.value as IncomeStability }))}
        >
          {INCOME_STABILITIES.map((key) => (
            <option key={key} value={key}>
              {INCOME_LABELS[key]}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label="Months of outgoings"
          hint={monthsNote(emergency)}
          value={emergency.months}
          onChange={(e) => setEmergency((d) => typedMonths(d, e.target.value))}
          inputMode="decimal"
        />
        <TextRow
          label={`What goes out a month (${ws.baseCurrency})`}
          value={monthlyOutgoing}
          onChange={(e) => setMonthlyOutgoing(e.target.value)}
          inputMode="numeric"
        />
      </InsetGroup>

      {/* How long you give yourself, and what the money earns while it waits — the two figures that used to be assumptions. */}
      <InsetGroup header="The plan" footer="Yours to set: the answer only ever shows what these two say.">
        <TextRow
          label="Save it over (months)"
          hint={horizonProblem}
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          inputMode="numeric"
        />
        <TextRow
          label="Est. return a year (%)"
          hint={returnProblem}
          value={returnPercent}
          onChange={(e) => setReturnPercent(e.target.value)}
          inputMode="decimal"
        />
      </InsetGroup>

      <Answer answer={emergencyAnswer} testId="answer-emergency" />
      <SaveRow label="Save Emergency fund as a goal" ready={emergencyAnswer !== null && emergencyInputs !== null} onSave={() => void save()} />
    </CalculatorPage>
  );
}
