import type { ReactNode } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
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
  if (!answer) return <Waiting problem={problem} />;
  return (
    <Panel wide testId={testId}>
      {/* Two figures, side by side where there is room: the desktop keeps both columns. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Figure caption="You need" minor={answer.targetMinor} />
        <Figure
          caption="Save each month"
          minor={answer.monthlyMinor}
          note={answer.covered ? <p className="text-[12.5px] leading-[16px] text-[var(--ph-tint)]">What you hold already covers it.</p> : undefined}
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
export function SaveRow({ label, ready, onSave }: { label: string; ready: boolean; onSave: () => void }) {
  return (
    <InsetGroup>
      <InsetRow title={label} chevron={false} onClick={() => ready && onSave()} className={ready ? undefined : 'opacity-40'} />
    </InsetGroup>
  );
}

/** The receipt for a kept answer, in the tint the kit uses for a thing that went well. */
export function SavedLine({ text }: { text: string | null }) {
  return text ? <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]">{text}</p> : null;
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
  saved,
  children,
}: {
  entry: CalculatorEntry;
  error: unknown;
  saved: string | null;
  children: ReactNode;
}) {
  return (
    <div className={SCREEN}>
      <LargeTitle title={entry.label} subtitle={entry.blurb} back="Calculators" backTo="/calculators" />
      <ErrorBox error={error} />
      <SavedLine text={saved} />
      {children}
    </div>
  );
}
