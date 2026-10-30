import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import type { CalculatorEntry } from './catalogue';

/** A refusal, said on the row whose box caused it, in the alarm ink. */
export function refusal(problem: string | undefined, otherwise?: ReactNode): ReactNode {
  return problem ? <span className="text-[var(--ph-alarm)]">{problem}</span> : otherwise;
}

/** A figure the calculator worked out. Tabular, so the answers line up down the page. */
export function Figure({ caption, minor, note }: { caption: string; minor: number; note?: ReactNode }) {
  const { ws } = useApp();
  return (
    <div>
      <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{caption}</p>
      <p className="tabular text-[22px] leading-[28px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">
        <Money minor={minor} currency={ws.baseCurrency} />
      </p>
      {note}
    </div>
  );
}

/** Nothing to answer yet: the line the page keeps where the panel will be. */
export function Waiting({ problem }: { problem?: string | null }) {
  return (
    <p className="mb-[18px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
      {problem ? refusal(problem) : 'Fill the figures in and the answer appears here.'}
    </p>
  );
}

/** Nothing is stored until you ask: a calculator is for the question you may not want to keep. */
export function Answer({
  answer,
  testId,
  problem,
}: {
  answer: { targetMinor: number; monthlyMinor: number; covered: boolean } | null;
  testId: string;
  problem?: string | null;
}) {
  // No answer yet: nothing, unless a refusal has something to say. No "fill the figures in" line outside the boxes.
  if (!answer) return problem ? <Waiting problem={problem} /> : null;
  return (
    <Panel wide testId={testId}>
      {/* Two figures, side by side where there is room: the desktop keeps both columns. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Figure caption="Needed" minor={answer.targetMinor} />
        <Figure
          caption="Save each month"
          minor={answer.monthlyMinor}
          note={answer.covered ? <p className="text-[12.5px] leading-[16px] text-[var(--ph-up)]">What is held already covers it.</p> : undefined}
        />
      </div>
    </Panel>
  );
}

/**
 * The one row that turns an answer into something kept.
 *
 * A row of its own group rather than an outlined button under the fields — the same shape every adopted form on
 * this branch uses, dimmed and refusing the tap while there is no answer to keep.
 */
export function SaveRow({ label, ready, onSave, onRefused }: { label: string; ready: boolean; onSave: () => void; onRefused?: () => void }) {
  return (
    <InsetGroup>
      <InsetRow title={label} action onClick={() => (ready ? onSave() : onRefused?.())} className={ready ? undefined : 'opacity-40'} />
    </InsetGroup>
  );
}

/** What the receipt says: the goal's id, its name and figure, and whether it was updated rather than made. */
export interface GoalAdded {
  goalId: string;
  detail: string;
  updated?: boolean;
}

/**
 * The receipt for a goal made from a calculator: a centred pop-up, not a line in the page, with the way into the goal
 * it made. The detail is the goal's name and the figure it was saved with.
 */
export function GoalAddedAlert({ added: { goalId, detail, updated }, onClose }: { added: GoalAdded; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <NoticeAlert
      title={updated ? 'Goal updated' : 'Added to Goals'}
      text={detail}
      closeLabel="Done"
      onClose={onClose}
      actions={
        <button type="button" onClick={() => void navigate({ to: '/goals/$goalId', params: { goalId } })} className={`${ALERT_ROW} font-semibold`}>
          Open goal
        </button>
      }
    />
  );
}

/**
 * One calculator's page: the kit's large title and a way back to the list it was chosen from, then the groups, the
 * answer and the save row that calculator has always had.
 *
 * The title and the subtitle come from the catalogue's own entry, so what a person read on the row is what the page
 * repeats — and the back button names the list rather than "Back", because a calculator has one way in.
 */
export function CalculatorPage({
  entry,
  error,
  quiet = false,
  children,
}: {
  entry: CalculatorEntry;
  error: unknown;
  /** No subtitle under the title: the page says nothing outside its boxes. */
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={SCREEN}>
      <LargeTitle title={entry.label} subtitle={quiet ? undefined : entry.blurb} back="Calculators" backTo="/calculators" />
      <ErrorBox error={error} />
      {children}
    </div>
  );
}
