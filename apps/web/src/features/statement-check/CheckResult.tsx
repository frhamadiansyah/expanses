import { formatMinor } from '@expanses/core';
import type { AccountRow, CheckDecisions, CheckDraftRow, PreparedCheck } from '@expanses/db';
import { Check } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ChoiceSheet } from '../transactions/ChoiceSheet';
import { Button, cx } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { Line } from '../cards/rows';
import { summaryOf, takenByOthers, unchosenTied } from './check-model';

/** A recorded transaction or pending draft as a row can name it. */
export interface CandidateInfo {
  on: string;
  description: string;
  amountMinor: number;
}

export type CheckList = 'matched' | 'differs' | 'missing' | 'flagged' | 'ask';

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * The check's top: the statement's new balance against the card's in cicis, then one count row per kind of answer.
 * Each count opens its list on the same screen.
 */
export function CheckResult({
  prepared,
  rows,
  ask,
  onOpen,
  footer,
}: {
  prepared: PreparedCheck;
  rows: CheckDraftRow[];
  ask: Readonly<Record<number, string>>;
  onOpen: (list: CheckList) => void;
  footer: ReactNode;
}) {
  const money = (minor: number) => formatMinor(minor, prepared.currency);
  const { counts, headline } = summaryOf({ ...prepared, rows });
  const notOn = counts.flagged + unchosenTied(rows, ask).length;
  return (
    <>
      <section data-testid="check-headline" className="mb-[18px] rounded-[11px] bg-[var(--ph-surface)] px-[16px] py-[14px]">
        {headline.kind === 'no-summary' ? (
          <>
            <p className="text-[13px] text-[var(--ph-ink-3)]">No new balance read</p>
            <p className="mt-[4px] text-[17px] font-semibold text-[var(--ph-warn)]">Add the summary to reconcile</p>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--ph-ink-3)]">New balance on the statement</p>
            <p className="tabular mt-[2px] text-[28px] leading-[34px] font-bold text-[var(--ph-ink)]">{money(prepared.closingMinor!)}</p>
            {headline.kind === 'reconciled' ? (
              <p className="mt-[4px] text-[15px] font-semibold text-[var(--ph-tint)]">✓ Reconciled</p>
            ) : (
              <>
                <p className="mt-[4px] text-[15px] font-semibold text-[var(--ph-alarm)]">Differs by {money(Math.abs(headline.differenceMinor))}</p>
                <p className="mt-[4px] text-[12.5px] text-[var(--ph-ink-3)]">Likely: {headline.likely}.</p>
              </>
            )}
          </>
        )}
      </section>

      {prepared.emptyImages.length > 0 && (
        <InsetGroup footer="Cropped or blurry, perhaps. Check again with it retaken to read its rows.">
          {prepared.emptyImages.map((image) => (
            <InsetRow key={image} title={`Nothing read from screenshot ${image + 1}`} chevron={false} valueTone="warn" />
          ))}
        </InsetGroup>
      )}

      <InsetGroup
        header="Rows"
        footer={prepared.alreadyChecked ? 'This statement was checked before. Recording again links what is there and posts nothing twice.' : undefined}
      >
        <InsetRow testId="count-matched" title="Matched" value={String(counts.matched)} onClick={() => onOpen('matched')} />
        {counts.ask > 0 && (
          <InsetRow
            testId="count-ask"
            title="Which one was it?"
            subtitle="Alike transactions: choose the recorded one for each row"
            value={String(counts.ask)}
            valueTone="warn"
            onClick={() => onOpen('ask')}
          />
        )}
        <InsetRow testId="count-differs" title="Amount differs" value={String(counts.differs)} onClick={() => onOpen('differs')} />
        <InsetRow testId="count-missing" title="Missing — record here" value={String(counts.missing)} onClick={() => onOpen('missing')} />
        {counts.payments > 0 && (
          <InsetRow
            testId="count-payments"
            title="Payments not tracked"
            subtitle={`One quiet line on the card · −${money(prepared.untrackedPaymentsMinor)}`}
            value={String(counts.payments)}
            chevron={false}
          />
        )}
        <InsetRow testId="count-flagged" title="Recorded, not on this statement" value={String(notOn)} onClick={() => onOpen('flagged')} />
      </InsetGroup>
      {footer}
    </>
  );
}

/** Matched rows, read-only: each says what it was linked to. */
export function MatchedList({ rows, currency, candidates }: { rows: CheckDraftRow[]; currency: string; candidates: ReadonlyMap<string, CandidateInfo> }) {
  const matched = rows.filter((r) => r.outcome.status === 'matched');
  return (
    <InsetGroup header="Matched" footer="Linked to what was already recorded. Nothing here changes.">
      {matched.length === 0 && <InsetRow title="No row matched" chevron={false} />}
      {matched.map((row) => {
        const ids = row.outcome.status === 'matched' ? row.outcome.candidateIds : [];
        const linked = ids.map((id) => candidates.get(id)?.description ?? 'a recorded transaction').join(' + ');
        return (
          <InsetRow
            key={row.index}
            testId="matched-row"
            title={row.description}
            subtitle={`${day(row.on)} · linked to ${linked}`}
            value={formatMinor(row.amountMinor, currency)}
            valueTone="ink"
            chevron={false}
          />
        );
      })}
    </InsetGroup>
  );
}

/** Near amounts: one tap takes the statement's figure or keeps the one recorded. Nothing changes without it. */
export function DiffersList({
  rows,
  currency,
  decisions,
  onDecide,
}: {
  rows: CheckDraftRow[];
  currency: string;
  decisions: CheckDecisions['differs'];
  onDecide: (index: number, answer: 'statement' | 'mine') => void;
}) {
  const differs = rows.filter((r) => r.outcome.status === 'differs');
  return (
    <InsetGroup header="Amount differs" footer="Unanswered keeps the amount recorded.">
      {differs.length === 0 && <InsetRow title="No amount differs" chevron={false} />}
      {differs.map((row) => {
        if (row.outcome.status !== 'differs') return null;
        const { statementMinor, recordedMinor } = row.outcome;
        const answer = decisions[row.index] ?? 'mine';
        return (
          <Line key={row.index} testId="differs-row">
            <p className="text-[15px] text-[var(--ph-ink)]">{row.description}</p>
            <p className="tabular text-[12.5px] text-[var(--ph-ink-3)]">
              {day(row.on)} · statement {formatMinor(statementMinor, currency)} · recorded {formatMinor(recordedMinor, currency)}
            </p>
            <div className="mt-[8px] flex flex-wrap gap-[8px]">
              <Choice pressed={answer === 'statement'} onClick={() => onDecide(row.index, 'statement')}>
                Use {formatMinor(statementMinor, currency)}
              </Choice>
              <Choice pressed={answer === 'mine'} onClick={() => onDecide(row.index, 'mine')}>
                Keep mine
              </Choice>
            </div>
          </Line>
        );
      })}
    </InsetGroup>
  );
}

/** Rows alike enough that the owner says which recorded transaction each is. One transaction answers one row. */
export function AskList({
  rows,
  currency,
  ask,
  candidates,
  onChoose,
}: {
  rows: CheckDraftRow[];
  currency: string;
  ask: Readonly<Record<number, string>>;
  candidates: ReadonlyMap<string, CandidateInfo>;
  onChoose: (index: number, candidateId: string) => void;
}) {
  const asks = rows.filter((r) => r.outcome.status === 'ask');
  return (
    <InsetGroup header="Which one was it?" footer="A recorded transaction no row takes is listed under Recorded, not on this statement.">
      {asks.map((row) => {
        if (row.outcome.status !== 'ask') return null;
        const taken = takenByOthers(rows, ask, row.index);
        return (
          <Line key={row.index} testId="ask-row">
            <p className="text-[15px] text-[var(--ph-ink)]">{row.description}</p>
            <p className="tabular text-[12.5px] text-[var(--ph-ink-3)]">
              {day(row.on)} · {formatMinor(row.amountMinor, currency)}
            </p>
            <div className="mt-[8px] flex flex-col gap-[6px]">
              {row.outcome.candidateIds.map((id) => {
                const info = candidates.get(id);
                return (
                  <Choice key={id} pressed={ask[row.index] === id} disabled={taken.has(id)} onClick={() => onChoose(row.index, id)}>
                    {info ? `${info.description} · ${day(info.on)} · ${formatMinor(info.amountMinor, currency)}` : 'A recorded transaction'}
                  </Choice>
                );
              })}
            </div>
          </Line>
        );
      })}
    </InsetGroup>
  );
}

/** What cicis holds on the card in the period that the statement does not show: Keep, Delete, or Move. */
export function FlaggedList({
  prepared,
  rows,
  ask,
  candidates,
  otherCards,
  decisions,
  onDecide,
}: {
  prepared: PreparedCheck;
  rows: CheckDraftRow[];
  ask: Readonly<Record<number, string>>;
  candidates: ReadonlyMap<string, CandidateInfo>;
  otherCards: readonly AccountRow[];
  decisions: CheckDecisions['flagged'];
  onDecide: (transactionId: string, answer: CheckDecisions['flagged'][string]) => void;
}) {
  const [moving, setMoving] = useState<string | null>(null);
  const items = [
    ...prepared.flagged,
    ...unchosenTied(rows, ask).map((id) => ({ transactionId: id, on: candidates.get(id)?.on ?? '', description: candidates.get(id)?.description ?? 'A recorded transaction', amountMinor: candidates.get(id)?.amountMinor ?? 0 })),
  ];
  const money = (minor: number) => formatMinor(minor, prepared.currency);
  return (
    <>
      <InsetGroup header="Recorded, not on this statement" footer="Unanswered keeps it.">
        {items.length === 0 && <InsetRow title="Everything recorded is on the statement" chevron={false} />}
        {items.map((item) => {
          const answer = decisions[item.transactionId] ?? 'keep';
          const movedTo = typeof answer === 'object' ? otherCards.find((c) => c.id === answer.moveTo)?.name : null;
          return (
            <Line key={item.transactionId} testId="flagged-row">
              <p className="text-[15px] text-[var(--ph-ink)]">{item.description}</p>
              <p className="tabular text-[12.5px] text-[var(--ph-ink-3)]">
                {item.on ? `${day(item.on)} · ` : ''}
                {money(item.amountMinor)}
                {movedTo ? ` · moves to ${movedTo}` : ' · on this card'}
              </p>
              <div className="mt-[8px] flex flex-wrap gap-[8px]">
                <Choice pressed={typeof answer === 'object'} disabled={otherCards.length === 0} onClick={() => setMoving(item.transactionId)}>
                  Move to another card
                </Choice>
                <Choice pressed={answer === 'keep'} onClick={() => onDecide(item.transactionId, 'keep')}>
                  Keep
                </Choice>
                <Choice pressed={answer === 'delete'} danger onClick={() => onDecide(item.transactionId, 'delete')}>
                  Delete
                </Choice>
              </div>
            </Line>
          );
        })}
      </InsetGroup>
      {moving && (
        <ChoiceSheet
          title="Move to another card"
          value={(() => {
            const a = decisions[moving];
            return typeof a === 'object' ? a.moveTo : '';
          })()}
          groups={[{ choices: otherCards.map((c) => ({ value: c.id, label: c.name, caption: c.currency ?? undefined, glyph: <Check size={15} aria-hidden className="invisible" /> })) }]}
          onPick={(id) => onDecide(moving, { moveTo: id })}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  );
}

/** One answer among a row's few: drawn pressed when it is the one standing. */
function Choice({ pressed, danger = false, disabled, onClick, children }: { pressed: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant={pressed ? (danger ? 'danger' : 'primary') : 'secondary'}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cx('min-h-11 text-left', danger && !pressed && 'text-[var(--ph-alarm)]')}
    >
      {children}
    </Button>
  );
}
