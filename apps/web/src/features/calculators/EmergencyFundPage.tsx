import { formatMinor, isoDate } from '@expanses/core';
import { createGoalFromCalculator, saveGoalCalculator } from '@expanses/db';
import { useState } from 'react';
import { InsetGroup } from '../../ui/native';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { useGoals } from '../goals/queries';
import { EMERGENCY_FUND } from './catalogue';
import { useEmergencyFields } from './emergency-fields';
import { Answer, CalculatorPage, type GoalAdded, GoalAddedAlert, SaveRow } from './parts';

/** Months of what goes out, loan principal included — and the monthly saving that gets there over a horizon and a rate you set. */
export function EmergencyFundPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<GoalAdded | null>(null);
  const { fields, inputs, answer, targetRow } = useEmergencyFields();
  // One emergency fund is the goal: a second working updates it rather than starting another.
  const existing = (useGoals().data ?? []).find((goal) => goal.kind === 'emergency');

  async function save() {
    if (!inputs) return;
    setError(null);
    try {
      let goalId: string;
      if (existing) {
        goalId = existing.id;
        await saveGoalCalculator(database, ws, { goalId, kind: 'emergency', inputs, today });
      } else {
        goalId = await createGoalFromCalculator(database, ws, { name: 'Emergency fund', kind: 'emergency', inputs, today });
      }
      await invalidate();
      const target = answer ? `${formatMinor(inputs.targetMinor ?? answer.targetMinor, ws.baseCurrency)} for ${inputs.months} months of spending` : null;
      setAdded({ goalId, updated: Boolean(existing), detail: target ? `${existing?.name ?? 'Emergency fund'} · ${target}` : (existing?.name ?? 'Emergency fund') });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <CalculatorPage entry={EMERGENCY_FUND} error={error} quiet>
      {added && <GoalAddedAlert added={added} onClose={() => setAdded(null)} />}
      {fields}
      <Answer answer={answer} testId="answer-emergency" />
      {answer && <InsetGroup>{targetRow}</InsetGroup>}
      <SaveRow label={existing ? 'Update goal' : 'Set a goal'} ready={answer !== null && inputs !== null} onSave={() => void save()} />
    </CalculatorPage>
  );
}
