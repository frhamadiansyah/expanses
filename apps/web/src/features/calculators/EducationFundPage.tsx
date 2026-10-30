import { formatMinor, isoDate, uuidv7 } from '@expanses/core';
import { createGoalFromCalculator } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, InsetRow } from '../../ui/native';
import { EducationEditor } from '../goals/EducationEditor';
import { addLevel, type EducationDraft, educationDraftFrom } from '../goals/education-model';
import { EDUCATION_FUND } from './catalogue';
import { childLabel, educationGoalName } from './education-children';
import { educationWorking } from './education-answer';
import { Answer, CalculatorPage, GoalAddedAlert, SaveRow } from './parts';

interface Child {
  id: string;
  name: string;
  draft: EducationDraft;
}

/**
 * Each level at today's prices, raised once to the year it is paid — the goal's own editor, answered by its engine.
 *
 * The page holds its children in its own state, one editor's draft each; none is a record until "Set a goal" saves
 * the one on show as a goal of its own, so a second child never overwrites the first.
 */
export function EducationFundPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<{ goalId: string; detail: string } | null>(null);
  const freshChild = (): Child => ({ id: uuidv7(), name: '', draft: addLevel(educationDraftFrom(undefined, ws.baseCurrency)) });
  const [children, setChildren] = useState<Child[]>(() => [freshChild()]);
  const [currentId, setCurrentId] = useState(() => children[0]!.id);
  const [choosing, setChoosing] = useState(false);
  // Once "Set a goal" has been tried, a start or end still blank is named.
  const [attempted, setAttempted] = useState(false);

  const index = Math.max(0, children.findIndex((child) => child.id === currentId));
  const current = children[index]!;
  const patch = (next: Partial<Omit<Child, 'id'>>) => setChildren((all) => all.map((child) => (child.id === current.id ? { ...child, ...next } : child)));

  // The working reads its own boxes and never throws: a half-typed figure refuses on its row, the page stays up.
  const educationAnswer = educationWorking(current.draft, ws.baseCurrency, today);

  async function save() {
    if (!educationAnswer.inputs) return;
    setError(null);
    const name = educationGoalName(current.name);
    try {
      const goalId = await createGoalFromCalculator(database, ws, { name, kind: 'education', inputs: educationAnswer.inputs as never, today });
      await invalidate();
      setAdded({ goalId, detail: educationAnswer.answer ? `${name} · ${formatMinor(educationAnswer.answer.totalMinor, ws.baseCurrency)}` : name });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <CalculatorPage entry={EDUCATION_FUND} error={error} quiet>
      {added && <GoalAddedAlert goalId={added.goalId} detail={added.detail} onClose={() => setAdded(null)} />}
      <InsetGroup>
        <InsetRow title="Child" value={childLabel(current.name, index)} onClick={() => setChoosing(true)} />
        <InsetRow title="Levels" value={String(current.draft.levels.length)} chevron={false} />
      </InsetGroup>
      <EducationEditor
        key={current.id}
        value={current.draft}
        onChange={(draft) => patch({ draft })}
        name={current.name}
        onName={(name) => patch({ name })}
        currency={ws.baseCurrency}
        today={today}
        attempted={attempted}
      />
      <Answer
        answer={educationAnswer.answer && { targetMinor: educationAnswer.answer.totalMinor, monthlyMinor: educationAnswer.answer.monthlyMinor, covered: false }}
        problem={educationAnswer.problem}
        testId="answer-education"
      />
      <SaveRow label="Set a goal" ready={educationAnswer.answer !== null} onSave={() => void save()} onRefused={() => setAttempted(true)} />

      {choosing && (
        <Sheet grouped title="Child" onClose={() => setChoosing(false)}>
          <InsetGroup>
            {children.map((child, at) => (
              <InsetRow
                key={child.id}
                title={childLabel(child.name, at)}
                value={child.id === current.id ? '✓' : undefined}
                chevron={false}
                onClick={() => {
                  setCurrentId(child.id);
                  setChoosing(false);
                }}
              />
            ))}
            <InsetRow
              title="＋ Add a child"
              label="Add a child"
              chevron={false}
              onClick={() => {
                const next = freshChild();
                setChildren((all) => [...all, next]);
                setCurrentId(next.id);
                setChoosing(false);
              }}
            />
          </InsetGroup>
        </Sheet>
      )}
    </CalculatorPage>
  );
}
