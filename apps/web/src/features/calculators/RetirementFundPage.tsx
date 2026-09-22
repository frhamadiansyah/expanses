import { isoDate } from '@expanses/core';
import { createGoalFromCalculator } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, TextRow } from '../../ui/native';
import { RETIREMENT_FUND } from './catalogue';
import { refusal, Answer, CalculatorPage, SaveRow } from './parts';
import { RETIREMENT_DEFAULTS, type RetirementDraft, retirementWorking } from './retirement-form';

/** What the pot must hold the day you stop, drawn down while it keeps earning. */
export function RetirementFundPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [retirement, setRetirement] = useState<RetirementDraft>(RETIREMENT_DEFAULTS);

  const retirementAnswer = retirementWorking(retirement, ws.baseCurrency);
  const setRetirementBox = (key: keyof RetirementDraft) => (event: { target: { value: string } }) => setRetirement((draft) => ({ ...draft, [key]: event.target.value }));
  const retirementHint = (key: keyof RetirementDraft, otherwise?: ReactNode) => refusal(retirementAnswer.problems[key], otherwise);

  async function save() {
    if (!retirementAnswer.inputs) return;
    setError(null);
    try {
      await createGoalFromCalculator(database, ws, { name: 'Retirement fund', kind: 'retirement', inputs: retirementAnswer.inputs as never, today });
      await invalidate();
      setSaved('Saved Retirement fund as a goal.');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <CalculatorPage entry={RETIREMENT_FUND} error={error} saved={saved}>
      <InsetGroup>
        <TextRow
          label={`Yearly spending in retirement (${ws.baseCurrency})`}
          hint={retirementHint('annualSpend', "At today's prices.")}
          value={retirement.annualSpend}
          onChange={setRetirementBox('annualSpend')}
          inputMode="numeric"
        />
        <TextRow label="Your age now" hint={retirementHint('ageNow')} value={retirement.ageNow} onChange={setRetirementBox('ageNow')} inputMode="numeric" />
        <TextRow label="Age you retire" hint={retirementHint('retireAge')} value={retirement.retireAge} onChange={setRetirementBox('retireAge')} inputMode="numeric" />
        <TextRow
          label="Years in retirement"
          hint={retirementHint('yearsInRetirement')}
          value={retirement.yearsInRetirement}
          onChange={setRetirementBox('yearsInRetirement')}
          inputMode="numeric"
        />
        <TextRow label="Inflation a year (%)" hint={retirementHint('inflation')} value={retirement.inflation} onChange={setRetirementBox('inflation')} inputMode="decimal" />
        <TextRow
          label="Return while saving (%)"
          hint={retirementHint('returnBefore', 'What the money earns until you stop. The monthly figure is saved at this.')}
          value={retirement.returnBefore}
          onChange={setRetirementBox('returnBefore')}
          inputMode="decimal"
        />
        <TextRow
          label="Return while retired (%)"
          hint={retirementHint('returnInRetirement', 'What the pot earns while you are spending it.')}
          value={retirement.returnInRetirement}
          onChange={setRetirementBox('returnInRetirement')}
          inputMode="decimal"
        />
        <TextRow
          label={`Already put aside (${ws.baseCurrency})`}
          hint={retirementHint('alreadySaved', 'What you hold for this today; it keeps earning until you stop.')}
          value={retirement.alreadySaved}
          onChange={setRetirementBox('alreadySaved')}
          inputMode="numeric"
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
      <SaveRow label="Save Retirement fund as a goal" ready={retirementAnswer.inputs !== null} onSave={() => void save()} />
    </CalculatorPage>
  );
}
