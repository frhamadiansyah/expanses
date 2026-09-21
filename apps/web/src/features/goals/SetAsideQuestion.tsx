import { checkOutflow, formatMinor, isoDate, type SetAsideCheck } from '@expanses/core';
import { type Database, type SetAsideChoice, type SetAsideIntent, setAsideView, type WorkspaceContext } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Button, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { useGoalWholeness, useSetAsideChoiceOf, useSetAsideView } from './queries';
import { choiceOf, type Door, readyOf, type SetAsideAnswer } from './set-aside-question';

const INTENT: Record<SetAsideIntent, { title: (to: string) => string; hint: (to: string) => string }> = {
  borrow: { title: () => 'No — borrowing from it', hint: () => 'The fund shows a shortfall until you top it back up' },
  spend: { title: () => 'Yes — this is what I saved for', hint: () => 'The goal counts as spent, not broken' },
  move: { title: (to) => `Move the promise to ${to}`, hint: (to) => `The goal keeps its money, now in ${to}` },
};

function SetAsideQuestion({ check, currency, accountName, door, answer, onAnswer, toName }: {
  check: Extract<SetAsideCheck, { kind: 'ask' }>;
  currency: string;
  accountName: string;
  door: Door;
  answer: SetAsideAnswer | null;
  onAnswer: (answer: SetAsideAnswer) => void;
  toName: string;
}) {
  return (
    <>
      <InsetGroup
        header={`${formatMinor(check.overMinor, currency)} more than is free`}
        footer={`${accountName} has ${formatMinor(check.freeMinor, currency)} free. The rest has to come out of something you set aside.`}
      >
        {check.goals.map((goal) => (
          <InsetRow
            key={goal.goalId}
            testId="set-aside-goal"
            title={goal.name}
            subtitle={`${formatMinor(goal.coveredMinor, currency)} set aside`}
            value={answer?.goalId === goal.goalId ? 'Taking it' : 'Take from here'}
            valueTone="tint"
            label={`Take from ${goal.name}`}
            chevron={false}
            onClick={() => onAnswer({ goalId: goal.goalId, intent: door.intents.length === 1 ? door.intents[0]! : null })}
          />
        ))}
      </InsetGroup>
      {answer && door.intents.length > 1 && (
        <InsetGroup header="Is this what the goal is for?">
          {door.intents.map((intent) => (
            <InsetRow
              key={intent}
              title={INTENT[intent].title(toName)}
              subtitle={INTENT[intent].hint(toName)}
              value={answer.intent === intent ? '✓' : undefined}
              valueTone="tint"
              label={INTENT[intent].title(toName)}
              chevron={false}
              onClick={() => onAnswer({ ...answer, intent })}
            />
          ))}
        </InsetGroup>
      )}
    </>
  );
}

export interface SetAsideState {
  check: SetAsideCheck;
  /** What Save sends: null when nothing was asked. */
  choice: SetAsideChoice | null;
  /** False while the question waits for an answer, or for the figures it asks about. */
  ready: boolean;
  /** The question, or nothing. */
  node: ReactNode;
}

/**
 * The E2 question for one door. The view is read once per account; the check is pure and runs on every keystroke.
 * An edit passes its own transaction as `excludeTransactionId`, so it asks about the account as if it were not there,
 * and `initial` so it opens on the answer it was saved with.
 */
export function useSetAside(door: Door | null, opts: { excludeTransactionId?: string | null; initial?: SetAsideChoice | null; toName?: string } = {}): SetAsideState {
  const view = useSetAsideView(door?.accountId || null, opts.excludeTransactionId ?? null);
  const wholeness = useGoalWholeness();
  const [touched, setTouched] = useState<SetAsideAnswer | undefined>(undefined);
  const initial = opts.initial ?? null;
  const check: SetAsideCheck = door && view.data ? checkOutflow(view.data, door.outflowMinor, door.ownGoalId) : { kind: 'silent' };
  const picked = touched ?? (initial ? { goalId: initial.goalId, intent: initial.intent } : null);
  // An answer naming a goal the question no longer offers is not an answer.
  const answer = check.kind === 'ask' && picked && check.goals.some((goal) => goal.goalId === picked.goalId) ? picked : null;
  const keepsInitial = !!initial && !!answer && answer.goalId === initial.goalId && answer.intent === initial.intent;
  const whole = keepsInitial ? { whole: initial!.wasWhole === true, since: initial!.wholeSince ?? null } : answer ? wholeness.data?.[answer.goalId] : undefined;
  const choice = door ? choiceOf(check, answer, door, whole) : null;
  const waiting = (!!door && view.isPending) || (choice?.intent === 'borrow' && !keepsInitial && wholeness.isPending);
  const ready = !waiting && (door ? readyOf(check, answer, door) : true);
  const node =
    door && view.data && check.kind === 'ask' ? (
      <SetAsideQuestion check={check} currency={view.data.currency} accountName={view.data.name} door={door} answer={answer} onAnswer={setTouched} toName={opts.toName ?? ''} />
    ) : null;
  return { check, choice, ready, node };
}

/** Whether a door would ask — for the desktop quick rows and the review queue, which save in place unless it does. */
export async function asksAboutSetAside(database: Database, ws: WorkspaceContext, door: Door | null, excludeTransactionId: string | null = null): Promise<boolean> {
  if (!door) return false;
  const view = await setAsideView(database, ws, door.accountId, { date: isoDate(), excludeTransactionId });
  return !!view && checkOutflow(view, door.outflowMinor, door.ownGoalId).kind === 'ask';
}

/** The question on its own, for a save that has nowhere else to ask it. Save stays off until it is answered. */
export function SetAsideSheet({ door, excludeTransactionId, onSave, onClose }: {
  door: Door;
  excludeTransactionId?: string | null;
  onSave: (choice: SetAsideChoice | null) => Promise<void>;
  onClose: () => void;
}) {
  // An edit from a quick row opens on the answer it was saved with, as the full forms do.
  const saved = useSetAsideChoiceOf(excludeTransactionId ?? null);
  const setAside = useSetAside(door, { excludeTransactionId, initial: saved.data ?? null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(setAside.choice);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Money set aside" onClose={onClose}>
      {setAside.node}
      <ErrorBox error={error} />
      <Button className="w-full justify-center" disabled={busy || !setAside.ready} onClick={() => void save()}>
        Save
      </Button>
    </Sheet>
  );
}
