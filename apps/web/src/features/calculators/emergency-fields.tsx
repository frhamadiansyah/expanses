import { EMERGENCY_RETURN_BPS, emergencyTargetMinor, groupedMajorString, groupTypedAmount, HOUSEHOLDS, type Household, INCOME_STABILITIES, type IncomeStability, parseGroupedMajor, savingPlanFor } from '@expanses/core';
import type { EmergencyInputs } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { emergencyDraftFrom, emergencyInputsOf, HOUSEHOLD_LABELS, INCOME_LABELS, monthsNote, typedMonths, withAnswers } from '../goals/emergency-form';
import { readPercent, readWhole } from './fields';
import { SpendBar, useSpendSuggestions } from './SpendBar';

/** What the emergency calculator opens on: the standalone page starts a year out, a goal's working on what it already says. */
export interface EmergencyStart {
  inputs?: EmergencyInputs;
  /** What goes out a month, typed ("1.000.000"); empty for none yet. */
  outgoing?: string;
  /** Months to save over when the working names none. */
  horizon?: number;
  /** The return in percent when the working names none. */
  returnPercent?: number;
}

/**
 * The emergency calculator's boxes and the answer they give: household, income, months, what goes out a month, then
 * the plan's horizon and return. One definition for the calculators page and a goal's own Calculator, so the two read
 * the same and cannot drift apart.
 */
export function useEmergencyFields(start: EmergencyStart = {}) {
  const { ws } = useApp();
  const [emergency, setEmergency] = useState(() => emergencyDraftFrom(start.inputs));
  const [monthlyOutgoing, setMonthlyOutgoing] = useState(
    () => start.outgoing ?? (start.inputs?.monthlyOutgoingMinor ? groupedMajorString(start.inputs.monthlyOutgoingMinor, ws.baseCurrency) : ''),
  );
  const [outgoingFocused, setOutgoingFocused] = useState(false);
  const spend = useSpendSuggestions('emergency', emergency.base);
  // The two assumptions the answer used to bury, written into the boxes they were made in: a year, and `EMERGENCY_RETURN_BPS`.
  const [horizon, setHorizon] = useState(String(start.inputs?.horizonMonths ?? start.horizon ?? 12));
  const [returnPercent, setReturnPercent] = useState(String((start.inputs?.returnBps ?? (start.returnPercent === undefined ? EMERGENCY_RETURN_BPS : start.returnPercent * 100)) / 100));

  const money = (value: string) => {
    try {
      return value.trim() === '' ? 0 : parseGroupedMajor(value, ws.baseCurrency);
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
  let inputs: EmergencyInputs | null = null;
  let answer: { targetMinor: number; monthlyMinor: number; covered: boolean } | null = null;
  try {
    const base = emergencyInputsOf(emergency);
    if (readMonths.ok && readMonths.value >= 1 && readReturn.ok && readReturn.value >= 0 && money(monthlyOutgoing) > 0) {
      const targetMinor = emergencyTargetMinor(base.months, money(monthlyOutgoing));
      const plan = savingPlanFor({ targetMinor, alreadySavedMinor: 0, returnBps: readReturn.value, months: readMonths.value });
      answer = { targetMinor, monthlyMinor: plan.monthlyMinor, covered: plan.gapMinor === 0 };
      inputs = { ...base, monthlyOutgoingMinor: money(monthlyOutgoing), horizonMonths: readMonths.value, returnBps: readReturn.value };
    }
  } catch {
    inputs = null;
    answer = null;
  }

  const fields = (
    <>
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
          label="What goes out a month"
          prefix={ws.baseCurrency}
          value={monthlyOutgoing}
          onChange={(e) => setMonthlyOutgoing(groupTypedAmount(e.target.value, ws.baseCurrency))}
          onFocus={() => setOutgoingFocused(true)}
          onBlur={() => setOutgoingFocused(false)}
          inputMode="decimal"
          placeholder="Amount"
        />
      </InsetGroup>
      <SpendBar open={outgoingFocused} suggestions={spend} onPick={setMonthlyOutgoing} />

      {/* How long to give it, and what the money earns while it waits. */}
      <InsetGroup header="The plan">
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
    </>
  );

  return { fields, inputs, answer };
}
