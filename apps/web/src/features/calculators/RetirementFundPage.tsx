import { formatMinor, groupTypedAmount, isoDate } from '@expanses/core';
import { createGoalFromCalculator } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, TextRow } from '../../ui/native';
import { RETIREMENT_FUND } from './catalogue';
import { refusal, Answer, CalculatorPage, GoalAddedAlert, SaveRow } from './parts';
import { RETIREMENT_DEFAULTS, type RetirementDraft, retirementWorking, yearsNote } from './retirement-form';
import { SpendBar, useSpendSuggestions } from './SpendBar';

/** What the pot must hold the day you stop, drawn down while it keeps earning. */
export function RetirementFundPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<{ goalId: string; detail: string } | null>(null);
  const [retirement, setRetirement] = useState<RetirementDraft>(RETIREMENT_DEFAULTS);

  const [spendFocused, setSpendFocused] = useState(false);
  const spend = useSpendSuggestions('retirement');
  const retirementAnswer = retirementWorking(retirement, ws.baseCurrency);
  const setRetirementBox = (key: keyof RetirementDraft) => (event: { target: { value: string } }) => setRetirement((draft) => ({ ...draft, [key]: event.target.value }));
  const setMoneyBox = (key: 'annualSpend' | 'alreadySaved') => (event: { target: { value: string } }) =>
    setRetirement((draft) => ({ ...draft, [key]: groupTypedAmount(event.target.value, ws.baseCurrency) }));
  const retirementHint = (key: keyof RetirementDraft) => refusal(retirementAnswer.problems[key]);

  async function save() {
    if (!retirementAnswer.inputs) return;
    setError(null);
    try {
      const goalId = await createGoalFromCalculator(database, ws, { name: 'Retirement fund', kind: 'retirement', inputs: retirementAnswer.inputs as never, today });
      await invalidate();
      const target = retirementAnswer.answer ? ` · ${formatMinor(retirementAnswer.answer.targetMinor, ws.baseCurrency)}` : '';
      setAdded({ goalId, detail: `Retirement fund${target}` });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <CalculatorPage entry={RETIREMENT_FUND} error={error} quiet>
      {added && <GoalAddedAlert goalId={added.goalId} detail={added.detail} onClose={() => setAdded(null)} />}
      <InsetGroup>
        <TextRow
          label="Yearly spending in retirement"
          wrapLabel
          prefix={ws.baseCurrency}
          hint={retirementHint('annualSpend')}
          value={retirement.annualSpend}
          onChange={setMoneyBox('annualSpend')}
          onFocus={() => setSpendFocused(true)}
          onBlur={() => setSpendFocused(false)}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow label="Age now" hint={retirementHint('ageNow')} value={retirement.ageNow} onChange={setRetirementBox('ageNow')} inputMode="numeric" />
        <TextRow label="Retirement age" hint={retirementHint('retireAge')} value={retirement.retireAge} onChange={setRetirementBox('retireAge')} inputMode="numeric" />
        <TextRow
          label="Years in retirement"
          info={yearsNote(retirement)}
          hint={retirementHint('yearsInRetirement')}
          value={retirement.yearsInRetirement}
          onChange={setRetirementBox('yearsInRetirement')}
          inputMode="numeric"
        />
      </InsetGroup>
      <SpendBar open={spendFocused} suggestions={spend} onPick={(typed) => setRetirement((draft) => ({ ...draft, annualSpend: typed }))} />

      <InsetGroup header="The plan">
        <TextRow label="Inflation a year (%)" hint={retirementHint('inflation')} value={retirement.inflation} onChange={setRetirementBox('inflation')} inputMode="decimal" />
        <TextRow
          label="Return while saving (%)"
          info="What the money earns until saving stops. The monthly figure is saved at this."
          hint={retirementHint('returnBefore')}
          value={retirement.returnBefore}
          onChange={setRetirementBox('returnBefore')}
          inputMode="decimal"
        />
        <TextRow
          label="Return while retired (%)"
          info="What the pot earns while it is being spent."
          hint={retirementHint('returnInRetirement')}
          value={retirement.returnInRetirement}
          onChange={setRetirementBox('returnInRetirement')}
          inputMode="decimal"
        />
      </InsetGroup>

      <Answer
        answer={
          retirementAnswer.answer && {
            targetMinor: retirementAnswer.answer.targetMinor,
            monthlyMinor: retirementAnswer.answer.monthlyMinor,
            covered: retirementAnswer.answer.gapMinor === 0,
          }
        }
        testId="answer-retirement"
      />
      <SaveRow label="Set a goal" ready={retirementAnswer.inputs !== null} onSave={() => void save()} />
    </CalculatorPage>
  );
}
