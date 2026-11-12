import { formatMinor } from '@expanses/core';
import type { AccountRow, CaptureSource, DraftRow } from '@expanses/db';
import { Card, cx } from '../../ui';
import { type SwipeAction, type SwipeHint, SwipeRow } from '../../ui/SwipeRow';
import { CategoryIcon, UnknownCategoryMark } from '../categories/CategoryIcon';
import { DayHeader } from '../transactions/DayHeader';
import { CaptureTypeMark } from './CaptureTypeMark';
import { captureRowView, draftDays, effectiveCategory } from './capture-view';
import { rowEventLead } from '../events/event-mode';
import { useEventName } from '../transactions/TransactionRow';

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
  discardActions,
  recordHint,
  guesses,
}: {
  drafts: readonly DraftRow[];
  accounts: readonly AccountRow[];
  sourceOf: (draft: DraftRow) => CaptureSource | null;
  /** The draft whose write is going out, drawn faded. */
  busy: string | null;
  onOpen: (draft: DraftRow) => void;
  onSwipeRight: (draft: DraftRow) => void;
  /** What stands behind the row once it is dragged left. */
  discardActions: (draft: DraftRow) => readonly SwipeAction[];
  /** What the ground under a right drag shows. */
  recordHint: SwipeHint;
  /** What the history of a merchant guesses for drafts with no category, by draft id: shown as if set. */
  guesses?: Readonly<Record<string, string | null>>;
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
                  rightHint={recordHint}
                  actions={discardActions(draft)}
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
                      <DraftFace draft={draft} accounts={accounts} source={sourceOf(draft)} categoryId={effectiveCategory(draft, guesses)} />
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
function DraftFace({ draft, accounts, source, categoryId }: { draft: DraftRow; accounts: readonly AccountRow[]; source: CaptureSource | null; categoryId: string | null }) {
  const view = captureRowView(draft, source);
  const transfer = draft.kind === 'transfer';
  const category = categoryId ? accounts.find((account) => account.id === categoryId) : undefined;
  const nameOf = (id: string | null) => (id ? (accounts.find((account) => account.id === id)?.name ?? null) : null);
  const from = nameOf(draft.accountId);
  const to = nameOf(draft.toAccountId);
  const warn = (text: string) => <span>{text}</span>;
  // Captured in event mode (screen 4): the event it will be recorded in leads the grey line, as on every list.
  const eventName = useEventName(draft.eventId ?? null);

  return (
    <span className="flex items-center gap-3 py-2">
      {transfer || category ? (
        <CategoryIcon categoryId={category?.id ?? null} accounts={accounts} transfer={transfer} />
      ) : (
        <UnknownCategoryMark />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {transfer ? 'Transfer' : category ? category.name : warn('Choose category')}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {eventName && <span data-testid="row-event">{`${rowEventLead(eventName)} · `}</span>}
          {view.type && <CaptureTypeMark type={view.type} />}
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
