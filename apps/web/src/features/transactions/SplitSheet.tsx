import { formatMinor } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { PickerRow } from '../../ui/native';
import { SwitchRow } from './FormRow';
import { CategoryPicker } from './CategoryPicker';
import { categoryGroups, offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { useSharedBooks } from '../sharing/queries';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useBooks, useCategoryBooks } from '../workspaces/queries';
import { excludedWhole, type FormDraft, isNotCountedRow, NOT_COUNTED, splitCentsRefusal, type SplitRow, splitTotalMinor, withPartExcluded, withSplitCategory } from './tx-form';

/**
 * "None", or "2 splits · Total Rp 85.000" — what the Split row says without being opened.
 *
 * `formatMinor`, never `minorToMajorString`: that one writes a figure the way a **form input** takes it back, so
 * USD 8500 comes out "85.00" — which under this app's own number formatting reads as eighty-five thousand. A
 * display figure has to carry its currency and its exponent with it, or the row is a 100× error waiting for a
 * reader.
 */
export function splitSummary(splits: readonly SplitRow[], currency: string): string {
  if (splits.length === 0) return 'None';
  // One row is reachable — **+ Split** makes two and ✕ takes one away — and "1 splits" is what it used to say,
  // where both of its siblings count in words a person would use.
  return `${splits.length} ${splits.length === 1 ? 'split' : 'splits'} · Total ${formatMinor(splitTotalMinor(splits, currency), currency)}`;
}

/** A workspace a split's line may take its category from, and that workspace's categories as one flat list. */
export interface OtherWorkspace {
  book: { id: string; name: string; kind: string };
  /** "Office supplies", or "Food and beverage › Restaurants" for one under a parent. */
  options: { id: string; label: string }[];
}

/**
 * The other workspaces a split's line can be filed in (one purchase split across workspaces, 0084), each with its
 * categories, roots first and each root's children after it. A split may have a part in one workspace shared with a
 * household, where that part alone reaches the other members: from a shared workspace only workspaces that are not
 * shared are offered, and from any other every workspace but one whose sharing ended (kept read-only). Picking parts in
 * two shared workspaces is refused by the ledger, in words.
 */
export function otherWorkspaces(
  accounts: readonly AccountRow[],
  books: readonly { id: string; name: string; kind: string }[],
  openBookId: string | undefined,
  categoryBooks: Readonly<Record<string, string>>,
  membership: Record<string, unknown>,
  shared: ReadonlySet<string>,
  readOnly: ReadonlySet<string> = new Set(),
): OtherWorkspace[] {
  if (!openBookId || readOnly.has(openBookId)) return [];
  const fromShared = shared.has(openBookId);
  return books
    .filter((book) => book.id !== openBookId && !readOnly.has(book.id) && !(fromShared && shared.has(book.id)))
    .map((book) => ({
      book,
      options: categoryGroups(offeredCategories(accounts, 'expense', membership, (a) => categoryBooks[a.id] === book.id)).flatMap(({ root, children }) => [
        { id: root.id, label: root.name },
        ...children.map((child) => ({ id: child.id, label: `${root.name} › ${child.name}` })),
      ]),
    }))
    .filter((other) => other.options.length > 0);
}

/** One choice in a part's Workspace list: a workspace, or "No workspace" (Not counted) for `book: null`. */
export interface WorkspaceChoice {
  key: string;
  name: string;
  book: { id: string; name: string; kind: string } | null;
}

/**
 * What a part's Workspace chooser lists: the open workspace first, then the others `otherWorkspaces` allows (already
 * ruled by shared / read-only), and "No workspace" last — only where Not counted is offered, or the part already is it.
 */
export function workspaceChoices(
  open: { id: string; name: string; kind: string } | null,
  others: readonly OtherWorkspace[],
  notCountedOffered: boolean,
  partIsNotCounted = false,
): WorkspaceChoice[] {
  return [
    ...(open ? [{ key: open.id, name: open.name, book: open }] : []),
    ...others.map((other) => ({ key: other.book.id, name: other.book.name, book: other.book })),
    ...(notCountedOffered || partIsNotCounted ? [{ key: '', name: 'No workspace', book: null }] : []),
  ];
}

/** A part's category chosen in a searchable sheet, with the workspace it is chosen from changed at its top. */
function PartCategorySheet({
  value,
  choices,
  initial,
  onPick,
  onClose,
}: {
  value: string;
  choices: readonly WorkspaceChoice[];
  /** The key of the workspace the list opens on. */
  initial: string;
  onPick: (categoryId: string) => void;
  onClose: () => void;
}) {
  const { ws } = useApp();
  const [from, setFrom] = useState(initial);
  const [choosing, setChoosing] = useState(false);
  const current = choices.find((choice) => choice.key === from && choice.book) ?? choices.find((choice) => choice.book);
  if (choosing) {
    return (
      <Sheet grouped title="Workspace" onClose={() => setChoosing(false)}>
        <div className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
          {choices.map((choice) => (
            <button
              key={choice.key || 'none'}
              type="button"
              aria-current={choice.key === current?.key ? 'true' : undefined}
              onClick={() => {
                if (!choice.book) {
                  // In no workspace there is no list to choose from: the part is Not counted, and the sheet is done.
                  onPick(NOT_COUNTED);
                  onClose();
                  return;
                }
                setFrom(choice.key);
                setChoosing(false);
              }}
              className="ph-focus-inset flex min-h-[46px] w-full items-center gap-2 px-[14px] text-left text-[15px] text-[var(--ph-ink)] active:bg-[var(--ph-fill)]"
            >
              <span className="min-w-0 flex-1 truncate">{choice.name}</span>
              <WorkspaceBadge book={choice.book} />
              {choice.key === current?.key && <Check size={18} aria-hidden className="shrink-0 text-[var(--ph-tint)]" />}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  return (
    <CategoryPicker
      kind="expense"
      lockKind
      value={value}
      onPick={onPick}
      onClose={onClose}
      bookId={current?.book && current.book.id !== ws.bookId ? current.book.id : undefined}
      header={
        choices.length > 1 ? (
          <div className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)]">
            <PickerRow label="Workspace" value={current?.name} onOpen={() => setChoosing(true)} />
          </div>
        ) : undefined
      }
    />
  );
}

/**
 * One bill across several categories — B3a, §4's Split row.
 *
 * The rows are read in the paying account's own currency, because that is what posts: `formToPost` refuses a split
 * typed in any other, so the total here is read in the same currency the save will read it in. The first **+ Split**
 * carries the category and figure already on the card into row one, so splitting a bill that has been filled in does
 * not start by throwing that away.
 */
export function SplitSheet({
  draft,
  onChange,
  accounts,
  currency,
  onClose,
}: {
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  accounts: readonly AccountRow[];
  currency: string;
  onClose: () => void;
}) {
  const { ws } = useApp();
  const splits = draft.splits;
  const refusal = splitCentsRefusal(splits, currency);
  const setSplits = (next: SplitRow[]) => onChange({ ...draft, splits: next });
  // Excluded whole (More details' switch): a part added now is excluded with the rest.
  const whole = excludedWhole(draft);
  /*
   * A line's category may come from another workspace: the purchase is then split across workspaces, each counting its
   * own part, while the card keeps the one charge. Offered after the open workspace's own, under each workspace's name,
   * and the line then wears that workspace's letter, as the receipt draws it.
   */
  const membership = useCategorySetMembership().data ?? {};
  const categoryBooks = useCategoryBooks().data ?? {};
  const sharedBooks = useSharedBooks().data ?? [];
  const shared = new Set(sharedBooks.map((book) => book.bookId));
  const readOnly = new Set(sharedBooks.filter((book) => book.state === 'unshared').map((book) => book.bookId));
  const books = useBooks().data ?? [];
  const others = otherWorkspaces(accounts, books, ws.bookId, categoryBooks, membership, shared, readOnly);
  const workspaceOf = (categoryId: string) => others.find((other) => other.book.id === categoryBooks[categoryId])?.book ?? null;
  const bookOf = (categoryId: string) => categoryBooks[categoryId] ?? null;
  /*
   * A part in no workspace — "Not counted" — is in no report at all, the card keeping the whole charge. Not offered from
   * a shared workspace: its purchases keep every part in a workspace (the ledger refuses it the same way).
   */
  const notCountedOffered = !(ws.bookId && shared.has(ws.bookId));
  // The workspace a row's part is counted in, by name, for its switch: the open one's own categories included.
  const [picking, setPicking] = useState<number | null>(null);
  const openBook = books.find((book) => book.id === ws.bookId) ?? null;
  const partName = (categoryId: string) => books.find((book) => book.id === bookOf(categoryId))?.name ?? null;
  return (
    <Sheet grouped title="Split" onClose={onClose}>
      {/* B3a: one card, a row per split — category, figure, ✕ — and + Split with the running total as its last row. */}
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
        {splits.map((row, i) => (
          <div key={i} data-testid="split-row">
            <PickerRow
              label="Category"
              testId="split-part-category"
              value={isNotCountedRow(row) ? 'Not counted' : row.categoryId ? (accounts.find((a) => a.id === row.categoryId)?.name ?? null) : null}
              placeholder="Select"
              detail={
                isNotCountedRow(row) ? (
                  'No workspace'
                ) : row.categoryId ? (
                  <span>
                    {partName(row.categoryId)}
                    <WorkspaceBadge book={books.find((book) => book.id === bookOf(row.categoryId)) ?? null} />
                  </span>
                ) : undefined
              }
              onOpen={() => setPicking(i)}
            />
            <div className="flex min-h-12 items-center gap-2 pl-[13px]">
              <input
                aria-label={`Split ${i + 1} amount`}
                value={row.amount}
                inputMode="decimal"
                placeholder="Amount"
                onChange={(e) => setSplits(splits.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                className="ph-focus-inset tabular min-w-0 flex-1 bg-transparent py-2 text-right text-base text-[var(--ph-ink-3)] placeholder:text-[var(--ph-ink-3)] focus:text-[var(--ph-ink)] md:text-[15px]"
              />
              <button
                type="button"
                onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                aria-label={`Remove split ${i + 1}`}
                className="ph-focus-inset flex h-12 w-11 shrink-0 items-center justify-center text-[var(--ph-ink-3)]"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            {/* The part's own Exclude from report (0090), under the row it belongs to: a workspace's part only — a part Not
                counted is in no report to leave. Rows in one workspace are one part, and switch together. */}
            {row.categoryId && !isNotCountedRow(row) && (
              <SwitchRow
                label="Exclude from report"
                info={`Out of ${partName(row.categoryId) ?? 'the workspace'}’s chart and budgets. Still counted in the card’s balance, statement and points.`}
                checked={row.excluded ?? false}
                onChange={(excluded) => setSplits(withPartExcluded(splits, i, excluded, bookOf))}
              />
            )}
            {isNotCountedRow(row) && (
              <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                In no workspace and no report. Still counted in the card’s balance, statement and points.
              </p>
            )}
          </div>
        ))}
        <div className="flex min-h-12 items-center gap-3 pr-[13px]">
          <button
            type="button"
            onClick={() =>
              setSplits(
                splits.length
                  ? [...splits, { categoryId: '', amount: '', ...(whole ? { excluded: true } : {}) }]
                  : // A purchase excluded whole stays so as it is split: each part says it now.
                    [
                      { categoryId: draft.categoryId, amount: draft.amount, ...(whole ? { excluded: true } : {}) },
                      { categoryId: '', amount: '', ...(whole ? { excluded: true } : {}) },
                    ],
              )
            }
            className="ph-focus-inset min-h-12 px-[13px] text-[15px] font-medium text-[var(--ph-tint)]"
          >
            + Split
          </button>
          {splits.length > 0 && (
            <span className="tabular ml-auto text-[12.5px] text-[var(--ph-ink-3)]">Total {formatMinor(splitTotalMinor(splits, currency), currency)}</span>
          )}
        </div>
      </div>
      {refusal && (
        <p role="alert" className="px-[13px] pt-2 text-[12.5px] leading-4 text-[var(--ph-warn)]">
          {refusal}
        </p>
      )}
      {picking !== null && splits[picking] && (
        <PartCategorySheet
          value={splits[picking].categoryId}
          choices={workspaceChoices(openBook, others, notCountedOffered, isNotCountedRow(splits[picking]))}
          initial={isNotCountedRow(splits[picking]) ? '' : (bookOf(splits[picking].categoryId) ?? ws.bookId ?? '')}
          onPick={(categoryId) => setSplits(withSplitCategory(splits, picking, categoryId, bookOf))}
          onClose={() => setPicking(null)}
        />
      )}
    </Sheet>
  );
}
