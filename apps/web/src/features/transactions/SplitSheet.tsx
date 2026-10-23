import { formatMinor } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { X } from 'lucide-react';
import { CategoryOptions } from '../cards/options';
import { categoryGroups, offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { useSharedBooks } from '../sharing/queries';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useBooks, useCategoryBooks } from '../workspaces/queries';
import { type FormDraft, splitCentsRefusal, type SplitRow, splitTotalMinor } from './tx-form';

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
  const others = otherWorkspaces(accounts, useBooks().data ?? [], ws.bookId, categoryBooks, membership, shared, readOnly);
  const workspaceOf = (categoryId: string) => others.find((other) => other.book.id === categoryBooks[categoryId])?.book ?? null;
  return (
    <Sheet grouped title="Split" onClose={onClose}>
      {/* B3a: one card, a row per split — category, figure, ✕ — and + Split with the running total as its last row. */}
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
        {splits.map((row, i) => (
          <div key={i} className="flex min-h-12 items-center gap-2 pl-[13px]">
            <select
              aria-label={`Split ${i + 1} category`}
              value={row.categoryId}
              onChange={(e) => setSplits(splits.map((r, j) => (j === i ? { ...r, categoryId: e.target.value } : r)))}
              className="ph-focus-inset min-w-0 flex-1 appearance-none truncate bg-transparent py-2 text-base text-[var(--ph-ink)] md:text-[15px]"
            >
              <CategoryOptions accounts={accounts as AccountRow[]} kind="expense" parentSuffix="(general)" />
              {others.map((other) => (
                <optgroup key={other.book.id} label={other.book.name}>
                  {other.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <WorkspaceBadge book={row.categoryId ? workspaceOf(row.categoryId) : null} />
            <input
              aria-label={`Split ${i + 1} amount`}
              value={row.amount}
              inputMode="decimal"
              placeholder="Amount"
              onChange={(e) => setSplits(splits.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
              className="ph-focus-inset tabular w-28 shrink-0 bg-transparent py-2 text-right text-base text-[var(--ph-ink-3)] placeholder:text-[var(--ph-ink-3)] focus:text-[var(--ph-ink)] md:text-[15px]"
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
        ))}
        <div className="flex min-h-12 items-center gap-3 pr-[13px]">
          <button
            type="button"
            onClick={() =>
              setSplits(
                splits.length ? [...splits, { categoryId: '', amount: '' }] : [{ categoryId: draft.categoryId, amount: draft.amount }, { categoryId: '', amount: '' }],
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
    </Sheet>
  );
}
