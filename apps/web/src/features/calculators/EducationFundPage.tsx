import { isoDate } from '@expanses/core';
import { createGoalFromCalculator } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, InsetRow } from '../../ui/native';
import { EducationEditor } from '../goals/EducationEditor';
import { addLevel, educationDraftFrom } from '../goals/education-model';
import { EDUCATION_FUND } from './catalogue';
import { educationWorking } from './education-answer';
import { Answer, CalculatorPage, SaveRow } from './parts';

/** Each level at today's prices, raised once to the year it is paid — the goal's own editor, answered by its engine. */
export function EducationFundPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [education, setEducation] = useState(() => addLevel(educationDraftFrom(undefined, ws.baseCurrency)));

  // The working reads its own boxes and never throws: a half-typed figure refuses on its row, the page stays up.
  const educationAnswer = educationWorking(education, ws.baseCurrency, today);

  async function save() {
    if (!educationAnswer.inputs) return;
    setError(null);
    try {
      await createGoalFromCalculator(database, ws, { name: 'Education fund', kind: 'education', inputs: educationAnswer.inputs as never, today });
      await invalidate();
      setSaved('Saved Education fund as a goal.');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <CalculatorPage entry={EDUCATION_FUND} error={error} saved={saved}>
      <InsetGroup>
        <InsetRow title="Levels" value={String(education.levels.length)} chevron={false} />
      </InsetGroup>
      <EducationEditor value={education} onChange={setEducation} currency={ws.baseCurrency} today={today} />
      <Answer
        answer={educationAnswer.answer && { targetMinor: educationAnswer.answer.totalMinor, monthlyMinor: educationAnswer.answer.monthlyMinor, covered: false }}
        problem={educationAnswer.problem}
        testId="answer-education"
      />
      <SaveRow label="Save Education fund as a goal" ready={educationAnswer.answer !== null} onSave={() => void save()} />
    </CalculatorPage>
  );
}
