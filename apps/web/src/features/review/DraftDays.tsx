import { formatMinor } from '@expanses/core';
import type { AccountRow, CaptureSource, DraftRow } from '@expanses/db';
import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, cx } from '../../ui';
import { SwipeRow } from '../../ui/SwipeRow';
import { CategoryIcon } from '../categories/CategoryIcon';
import { DayHeader } from '../transactions/DayHeader';
import { captureRowView, draftDays } from './capture-view';

/**
 * The phone's queue, drawn the way Cashflow draws what is already recorded: a card per day headed by the day and
 * what it came to, and in it one row per capture — the category's circle, the category as the title, where it
 * came from and which account underneath, the figure on the right.
 *
 * What a capture still has to be told is said in the warning tone where the answer would stand: a yellow "?" and
 * "Choose category" for the category, "Which account?" for the account. The gestures are the queue's own: right to
 * record, left for Discard, a tap into the Add-style screen.
 */
export function DraftDays({
  drafts,
  accounts,
  sourceOf,
  busy,
  onOpen,
  onSwipeRight,
  discardAction,
}: {
  drafts: readonly DraftRow[];
  accounts: readonly AccountRow[];
  sourceOf: (draft: DraftRow) => CaptureSource | null;
  /** The draft whose write is going out, drawn faded. */
  busy: string | null;
  onOpen: (draft: DraftRow) => void;
  onSwipeRight: (draft: DraftRow) => void;
  /** What stands behind the row once it is dragged left. */
  discardAction: (draft: DraftRow) => ReactNode;
}) {
  return (
    <>
      {draftDays(drafts).map((day) => (
        <Card key={day.date} className="mb-3">
          <DayHeader date={day.date} net={day.net} currency={day.currency} />
          <ul className="divide-y divide-slate-100">
            {day.drafts.map((draft) => (
              <li key={draft.id} className={cx('list-none', busy === draft.id && 'opacity-50')}>
                <SwipeRow
                  enabled
                  testId="draft-row"
                  onSwipeRight={() => onSwipeRight(draft)}
                  rightHint="Record"
                  leftAction={discardAction(draft)}
                >
                  {(suppressClick) => (
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressClick()) return;
                        onOpen(draft);
                      }}
                      className="block w-full bg-[var(--ph-surface)] text-left focus-visible:outline-2 focus-visible:outline-slate-900"
                    >
                      <DraftFace draft={draft} accounts={accounts} source={sourceOf(draft)} />
                    </button>
                  )}
                </SwipeRow>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}

/** One capture's face: `TransactionRow`'s layout, with the questions still open said where their answers go. */
function DraftFace({ draft, accounts, source }: { draft: DraftRow; accounts: readonly AccountRow[]; source: CaptureSource | null }) {
  const view = captureRowView(draft, source);
  const transfer = draft.kind === 'transfer';
  const category = draft.categoryAccountId ? accounts.find((account) => account.id === draft.categoryAccountId) : undefined;
  const nameOf = (id: string | null) => (id ? (accounts.find((account) => account.id === id)?.name ?? null) : null);
  const from = nameOf(draft.accountId);
  const to = nameOf(draft.toAccountId);
  const warn = (text: string) => <span className="font-medium text-[var(--ph-warn)]">{text}</span>;

  return (
    <span className="flex items-center gap-3 py-2">
      {transfer || category ? (
        <CategoryIcon categoryId={category?.id ?? null} accounts={accounts} transfer={transfer} />
      ) : (
        // No category yet: the unknown mark, in the warning tone, because it is a question still to answer.
        <span
          data-testid="category-mark"
          aria-hidden
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)]"
        >
          <CircleHelp size={18} strokeWidth={2.2} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {transfer ? 'Transfer' : category ? category.name : warn('Choose category')}
          {draft.confidence !== null && draft.confidence < 80 && <span className="ml-2 text-xs font-normal text-[var(--ph-warn)]">unsure</span>}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {view.icon && <span aria-hidden>{view.icon} </span>}
          {draft.description}
          {' · '}
          {from ?? warn('Which account?')}
          {transfer && (
            <>
              {' → '}
              {to ?? warn('To which account?')}
            </>
          )}
          {view.merged && ` · ${view.merged.toLowerCase()}`}
        </span>
      </span>
      <span
        className={cx(
          'tabular shrink-0 text-sm font-semibold whitespace-nowrap',
          draft.kind === 'expense' && 'text-red-700',
          draft.kind === 'income' && 'text-emerald-700',
        )}
      >
        {formatMinor(Math.abs(draft.amountMinor), draft.currency)}
      </span>
    </span>
  );
}
