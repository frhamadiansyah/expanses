import { EMERGENCY_RETURN_BPS, emergencyTargetMinor, HOUSEHOLDS, type Household, INCOME_STABILITIES, type IncomeStability, isoDate, parseMajor, savingPlanFor } from '@expanses/core';
import { createGoalFromCalculator, type EmergencyInputs } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, TextRow } from '../../ui/native';
import { emergencyDraftFrom, emergencyInputsOf, HOUSEHOLD_LABELS, INCOME_LABELS, monthsNote, typedMonths, withAnswers } from '../goals/emergency-form';
import { ChoiceRow } from '../goals/ChoiceRow';
import { EMERGENCY_FUND } from './catalogue';
import { Answer, CalculatorPage, SaveRow } from './parts';

/** Months of what goes out, loan principal included — and the monthly saving that gets there. */
export function EmergencyFundPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [emergency, setEmergency] = useState(() => emergencyDraftFrom());
  const [monthlyOutgoing, setMonthlyOutgoing] = useState('');

  const money = (value: string) => {
    try {
      return value.trim() === '' ? 0 : parseMajor(value, ws.baseCurrency);
    } catch {
      return 0;
    }
  };

  // The months are read by the one reader the goal's own working uses, which takes "9,5"; a figure it refuses shows no answer.
  let emergencyInputs: EmergencyInputs | null = null;
  let emergencyAnswer: { targetMinor: number; monthlyMinor: number; covered: boolean } | null = null;
  try {
    emergencyInputs = emergencyInputsOf(emergency);
    if (money(monthlyOutgoing) > 0) {
      const targetMinor = emergencyTargetMinor(emergencyInputs.months, money(monthlyOutgoing));
      const plan = savingPlanFor({ targetMinor, alreadySavedMinor: 0, returnBps: EMERGENCY_RETURN_BPS, months: 12 });
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
        {/* Two or three answers each: the app's own sheet, not the platform's panel. */}
        <ChoiceRow
          label="Household"
          value={emergency.household}
          options={HOUSEHOLDS.map((key) => ({ value: key, label: HOUSEHOLD_LABELS[key] }))}
          onChoose={(value) => setEmergency((d) => withAnswers(d, { household: value as Household }))}
        />
        <ChoiceRow
          label="Income"
          value={emergency.income}
          options={INCOME_STABILITIES.map((key) => ({ value: key, label: INCOME_LABELS[key] }))}
          onChoose={(value) => setEmergency((d) => withAnswers(d, { income: value as IncomeStability }))}
        />
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

      <Answer answer={emergencyAnswer} testId="answer-emergency" />
      <SaveRow label="Save Emergency fund as a goal" ready={emergencyAnswer !== null && emergencyInputs !== null} onSave={() => void save()} />
    </CalculatorPage>
  );
}
