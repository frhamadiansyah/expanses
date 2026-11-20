import { formatMinor } from '@expanses/core';
import { type AccountRow, type CaptureSource, type CardRow, type DraftEdit, type DraftRow, typedInCashflow } from '@expanses/db';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { cx, ErrorBox } from '../../ui';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { CategoryIcon } from '../categories/CategoryIcon';
import { bareFigure } from '../networth/debt-rows';
import { captureTypeOf } from './capture-type';
import { captureRowView, messageOnce, minorFromTyped } from './capture-view';
import type { Correction } from './draft-form';
import { type DeskDraftState, fromPhrase, paidWithOf, whenText } from './review-desk-model';

/** Which picker a field opens: the category, the account that paid (or received), a transfer's destination. */
export type PeekPick = 'category' | 'money' | 'to';

const WARN = 'text-[var(--ph-warn)]';
const FIELD = 'w-full min-w-0 rounded-[5px] border border-transparent bg-transparent px-[4px] py-[1px] text-[13px] text-[var(--ph-ink)] hover:border-[var(--ph-hair)] focus:border-[var(--mac-accent)] focus:outline-none';
const PICK = 'flex w-full min-w-0 items-center gap-[6px] rounded-[5px] px-[4px] py-[1px] text-left text-[13px] hover:bg-[var(--ph-fill)]';

/**
 * One capture in Mac Review's side peek: its figure, when and how it came in, the thing itself — a message's words as
 * they arrived, in a grey box, or its picture (the phone's plain view) — and the fields the phone's draft sheet asks
 * for, each changed in place: Description, Amount, Category (a transfer's To), Paid with, Date. Workspace is said, not
 * asked, as the draft sheet does. Record, Discard and Open form (the phone's whole draft sheet) at the foot; ⌃ ⌄ step.
 *
 * A capture already recorded or discarded is shown the same way, read only.
 */
export function DraftPeek({
  draft,
  state,
  source,
  accounts,
  cards,
  categoryId,
  bookName,
  eventName,
  top,
  first,
  last,
  busy,
  error,
  onStep,
  onClose,
  onRecord,
  onDiscard,
  onOpenForm,
  onView,
  onEdit,
  onPick,
  onOpenTransaction,
}: {
  draft: DraftRow;
  /** Where it stands in the queue; null for one recorded or discarded, which is read only. */
  state: DeskDraftState | null;
  source: CaptureSource | null;
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  /** Its category, or the one the merchant's history guesses (as the row shows it). */
  categoryId: string | null;
  bookName: string;
  /** The shared event it was captured for, when it is recorded on its form. */
  eventName: string | null;
  top: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  error: unknown;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onRecord: () => void;
  onDiscard: () => void;
  onOpenForm: () => void;
  onView: () => void;
  /** Writes a field onto the draft; each correction against what was read is shown to its source first. */
  onEdit: (patch: DraftEdit, learn: Correction[]) => void;
  onPick: (pick: PeekPick) => void;
  /** A recorded capture: its transaction, a click away. */
  onOpenTransaction?: () => void;
}) {
  const type = captureTypeOf(draft, source);
  const view = captureRowView(draft, source);
  const transfer = draft.kind === 'transfer';
  const open = state !== null;
  const category = categoryId ? accounts.find((a) => a.id === categoryId) : undefined;
  const paid = paidWithOf(draft.accountId, draft.cardId, accounts, cards);
  const to = paidWithOf(draft.toAccountId, null, accounts, cards);
  const words = draft.rawPayload ? messageOnce(draft.rawPayload) : '';

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: 'Description',
      value: open ? (
        <TextField
          key={`d:${draft.description}`}
          label="Description"
          initial={draft.description}
          onCommit={(text) => {
            const name = text.trim();
            if (name && name !== draft.description) onEdit({ description: name }, [{ field: 'name', value: name }]);
          }}
        />
      ) : (
        draft.description
      ),
    },
    {
      label: 'Amount',
      value: open ? (
        <TextField
          key={`a:${draft.amountMinor}`}
          label="Amount"
          initial={draft.amountMinor === 0 ? '' : bareFigure(Math.abs(draft.amountMinor), draft.currency)}
          placeholder="Amount"
          warn={state.checkAmount}
          suffix={draft.currency}
          onCommit={(text) => {
            const minor = minorFromTyped(text, draft.currency);
            if (minor === null || minor <= 0 || minor === Math.abs(draft.amountMinor)) return;
            onEdit({ amountMinor: draft.kind === 'income' ? -minor : minor }, [{ field: 'amount', value: text.trim() }]);
          }}
        />
      ) : (
        formatMinor(Math.abs(draft.amountMinor), draft.currency)
      ),
    },
    transfer
      ? {
          label: 'To',
          value: (
            <PickField label="Change where it went" disabled={!open} onClick={() => onPick('to')}>
              {to ? to.name : <span className={WARN}>To which account?</span>}
            </PickField>
          ),
        }
      : {
          label: 'Category',
          value: (
            <PickField label="Change category" disabled={!open} onClick={() => onPick('category')}>
              {category ? (
                <>
                  <CategoryIcon categoryId={category.id} accounts={accounts} size="xs" />
                  <span className="truncate">{category.name}</span>
                </>
              ) : (
                <span className={WARN}>Choose…</span>
              )}
            </PickField>
          ),
        },
    {
      label: transfer ? 'From' : draft.kind === 'income' ? 'Received into' : 'Paid with',
      value: (
        <PickField label="Change account" disabled={!open} onClick={() => onPick('money')}>
          {paid ? (
            <span className="truncate">
              {paid.name}
              {paid.last4 && <span className="ml-1 text-[11px] text-[var(--ph-ink-3)] tabular-nums">{paid.last4}</span>}
            </span>
          ) : (
            <span className={WARN}>Which account?</span>
          )}
        </PickField>
      ),
    },
    {
      label: 'Date',
      value: open ? (
        <input
          key={`o:${draft.occurredOn}`}
          type="date"
          aria-label="Date"
          defaultValue={draft.occurredOn}
          onBlur={(event) => {
            const date = event.target.value;
            if (date && date !== draft.occurredOn) onEdit({ occurredOn: date }, [{ field: 'date', value: date }]);
          }}
          className={FIELD}
        />
      ) : (
        draft.occurredOn
      ),
    },
    { label: 'Workspace', value: <span className="px-[4px]">{bookName}</span> },
  ];

  return (
    <SidePeek
      top={top}
      label="Capture details"
      testId="review-peek"
      titleTestId="peek-title"
      noun="capture"
      title={
        <span className="inline-flex items-center gap-[7px]">
          {!transfer && category && <CategoryIcon categoryId={category.id} accounts={accounts} size="xs" />}
          {draft.description}
        </span>
      }
      first={first}
      last={last}
      onStep={onStep}
      onClose={onClose}
    >
      <div className="px-[14px] pb-[10px]">
        <div data-testid="peek-amount" className={cx('text-[22px] font-semibold tabular-nums', draft.kind === 'income' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]')}>
          {draft.amountMinor === 0 ? <span className={WARN}>{typedInCashflow(draft) ? 'No amount yet' : 'No amount read'}</span> : formatMinor(Math.abs(draft.amountMinor), draft.currency)}
        </div>
        <div data-testid="peek-when" className="mt-[2px] text-[12px] text-[var(--ph-ink-3)]">
          {whenText(draft, type !== null)} · {fromPhrase(draft, type)}
          {source && type !== 'screenshot' && type !== 'photo' ? ` · ${source.label}` : ''}
          {view.merged ? ` · ${view.merged.toLowerCase()}` : ''}
        </div>
      </div>

      {words && (
        <pre
          data-testid="peek-captured"
          aria-label="What was captured"
          className="mx-[14px] mb-[12px] rounded-[8px] bg-[var(--ov-ground)] px-[12px] py-[10px] font-mono text-[12px] leading-[1.45] break-words whitespace-pre-wrap text-[var(--ph-ink-2)]"
        >
          {words}
        </pre>
      )}
      {draft.imageFile && (
        <div className="mx-[14px] mb-[12px]">
          <button type="button" onClick={onView} className={PEEK_BUTTON}>
            Show the picture
          </button>
        </div>
      )}
      {!words && !draft.imageFile && type !== null && <p className="mx-[14px] mb-[12px] text-[12px] text-[var(--ph-ink-3)]">The words it came with are no longer kept.</p>}

      <dl className="border-t border-[var(--ph-hair)]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center border-t border-[var(--ph-hair)] px-3 py-[6px] text-[13px] first:border-t-0">
            <dt className="w-[92px] shrink-0 text-[var(--ph-ink-3)]">{row.label}</dt>
            <dd className="min-w-0 flex-1 break-words text-[var(--ph-ink)]">{row.value}</dd>
          </div>
        ))}
      </dl>

      {state?.onForm && (
        <p className="border-t border-[var(--ph-hair)] px-[14px] pt-[10px] text-[12px] text-[var(--ph-ink-3)]">
          Captured for {eventName ?? 'a shared event'}: recorded on its form, where the move into the event is seen.
        </p>
      )}
      <div className="px-[14px] pt-[10px]">
        <ErrorBox error={error} />
      </div>
      {onOpenTransaction && (
        <div className="px-[14px] pt-[4px] pb-3">
          <button type="button" onClick={onOpenTransaction} className={PEEK_BUTTON}>
            Open transaction
          </button>
        </div>
      )}
      {open && (
        <div className="flex flex-wrap gap-2 px-[14px] pt-[4px] pb-3">
          <button
            type="button"
            disabled={busy || !state.complete}
            onClick={onRecord}
            className="rounded-[6px] bg-[var(--ph-ink)] px-3 py-[4px] text-[13px] font-medium text-[var(--ph-surface)] disabled:opacity-40"
          >
            Record
          </button>
          <button type="button" disabled={busy} onClick={onDiscard} className={PEEK_BUTTON}>
            Discard
          </button>
          <button type="button" disabled={busy} onClick={onOpenForm} className={PEEK_BUTTON}>
            Open form
          </button>
        </div>
      )}
    </SidePeek>
  );
}

/** A field written when it is left (or on Return): the draft changes once, when the typing is done. */
function TextField({
  label,
  initial,
  placeholder,
  warn = false,
  suffix,
  onCommit,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  warn?: boolean;
  suffix?: string;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      setText(initial);
      event.currentTarget.blur();
    }
  };
  return (
    <span className="flex items-center gap-[4px]">
      <input
        aria-label={label}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onCommit(text)}
        onKeyDown={keys}
        className={cx(FIELD, warn && 'border-[var(--ph-warn)] text-[var(--ph-warn)]', suffix && 'tabular-nums')}
      />
      {suffix && <span className="shrink-0 text-[11px] text-[var(--ph-ink-3)]">{suffix}</span>}
    </span>
  );
}

function PickField({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  if (disabled) return <span className="flex min-w-0 items-center gap-[6px] px-[4px]">{children}</span>;
  return (
    <button type="button" aria-label={label} onClick={onClick} className={PICK}>
      {children}
    </button>
  );
}
