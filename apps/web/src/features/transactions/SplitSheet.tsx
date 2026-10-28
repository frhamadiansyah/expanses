import { evaluateAmount, formatMinor, groupTypedAmount } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { Check, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DestructiveRow, InsetGroup, InsetRow, PickerRow, ReadOnlyRow, SwitchRow, TextRow } from '../../ui/native';
import { categoryMark, useCategoryMarkColour } from '../categories/CategoryIcon';
import { useCategoryColours } from '../../lib/queries';
import { OTHER_COLOUR } from './category-colours';
import { addPart, assignment, assignmentLine, barShares, editAmount, removePart, restIndex, settleRest, splitTotal } from './split-rest';
import { CategoryPicker } from './CategoryPicker';
import { categoryGroups, offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { useSharedBooks } from '../sharing/queries';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useBooks, useCategoryBooks } from '../workspaces/queries';
import { excludedWhole, type FormDraft, isNotCountedRow, NOT_COUNTED, splitCentsRefusal, type SplitRow, splitTotalMinor, typedCurrency, withPartExcluded, withSplitCategory } from './tx-form';

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
  workspaceFirst = false,
  onPick,
  onClose,
}: {
  value: string;
  choices: readonly WorkspaceChoice[];
  /** The key of the workspace the list opens on. */
  initial: string;
  /** Open on the Workspace list (the part's Workspace row), not on the categories. */
  workspaceFirst?: boolean;
  onPick: (categoryId: string) => void;
  onClose: () => void;
}) {
  const { ws } = useApp();
  const [from, setFrom] = useState(initial);
  const [choosing, setChoosing] = useState(workspaceFirst);
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
 * One bill across several categories — B3a, §4's Split row, drawn as a total with a proportion bar over one compact row
 * per part. A part opens on a sheet of its own (category, workspace, amount, Exclude from report, Remove).
 *
 * The rows are read in the paying account's own currency, because that is what posts: `formToPost` refuses a split typed in
 * any other, so the total here is read in the same currency the save will read it in. The first **Add a part** carries the
 * category and figure already on the card into part one, so splitting a bill that has been filled in does not start by
 * throwing that away.
 *
 * With an amount on the card the last part is the **Rest** (`split-rest.ts`): the total less the others, worked out again
 * whenever another part, the number of parts or the total changes. Without an amount the parts are typed by hand and the
 * total is their sum, as it always was.
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
  // The purchase amount, when it is in the paying account's own currency and reads: what the Rest is worked out against.
  const typed = typedCurrency(draft, accounts);
  const total = !typed || typed === currency ? splitTotal(draft.amount, currency) : null;
  // Excluded whole (More details' switch): a part added now is excluded with the rest.
  const whole = excludedWhole(draft);
  /*
   * A line's category may come from another workspace: the purchase is then split across workspaces, each counting its
   * own part, while the card keeps the one charge. Offered after the open workspace's own, under each workspace's name.
   */
  const membership = useCategorySetMembership().data ?? {};
  const categoryBooks = useCategoryBooks().data ?? {};
  const sharedBooks = useSharedBooks().data ?? [];
  const shared = new Set(sharedBooks.map((book) => book.bookId));
  const readOnly = new Set(sharedBooks.filter((book) => book.state === 'unshared').map((book) => book.bookId));
  const books = useBooks().data ?? [];
  const others = otherWorkspaces(accounts, books, ws.bookId, categoryBooks, membership, shared, readOnly);
  const bookOf = (categoryId: string) => categoryBooks[categoryId] ?? null;
  /*
   * A part in no workspace — "Not counted" — is in no report at all, the card keeping the whole charge. Not offered from
   * a shared workspace: its purchases keep every part in a workspace (the ledger refuses it the same way).
   */
  const notCountedOffered = !(ws.bookId && shared.has(ws.bookId));
  const [part, setPart] = useState<number | null>(null);
  const [picking, setPicking] = useState<{ index: number; workspaceFirst: boolean } | null>(null);
  // Why the last typed figure was not taken ("Over by …"): the field keeps its last good value meanwhile.
  const [over, setOver] = useState<string | null>(null);
  const openBook = books.find((book) => book.id === ws.bookId) ?? null;
  const partName = (categoryId: string) => books.find((book) => book.id === bookOf(categoryId))?.name ?? null;
  const colourOf = useCategoryMarkColour();

  // The Rest follows the amount: if it moved while this was shut, the parts are put right as the sheet opens.
  useEffect(() => {
    if (total === null || splits.length === 0) return;
    const next = settleRest(splits, total, currency);
    if (JSON.stringify(next) !== JSON.stringify(splits)) setSplits(next);
    // Once, as the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const at = total !== null && splits.length > 1 ? restIndex(splits) : -1;
  const status = assignmentLine(assignment(splits, total, currency), currency);
  const shares = barShares(splits, total, currency);
  const shown = total ?? splitTotalMinor(splits, currency);
  const amountOf = (row: SplitRow) => (row.amount.trim() ? (evaluateAmount(row.amount, currency) ?? 0) : null);

  const chosenColours = useCategoryColours().data;
  const markOf = (row: SplitRow) => {
    if (isNotCountedRow(row)) return { icon: <EyeOff size={15} strokeWidth={2.2} />, colour: OTHER_COLOUR };
    const { Glyph, colour } = categoryMark(row.categoryId || null, accounts, chosenColours);
    return { icon: <Glyph size={15} strokeWidth={2.2} />, colour };
  };
  const nameOf = (row: SplitRow) => (isNotCountedRow(row) ? 'Not counted' : row.categoryId ? (accounts.find((a) => a.id === row.categoryId)?.name ?? 'Category') : 'Choose a category');
  const noteOf = (row: SplitRow, i: number) => {
    const notes: string[] = [];
    if (isNotCountedRow(row)) notes.push('Not counted');
    else if (row.categoryId) {
      const book = bookOf(row.categoryId);
      if (book && book !== ws.bookId) notes.push(partName(row.categoryId) ?? '');
    }
    if (i === at) notes.push('Rest');
    return notes.filter(Boolean).join(' · ') || undefined;
  };

  const current = part !== null ? splits[part] : undefined;
  return (
    <Sheet grouped title="Split" onClose={onClose} confirm={{ label: 'Done', disabled: !!refusal, run: onClose }}>
      <div className="mb-[14px] rounded-[11px] bg-[var(--ph-surface)] px-[16px] py-[12px]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] text-[var(--ph-ink-3)]">Total</span>
          <span data-testid="split-total" className="tabular text-[22px] font-semibold leading-[28px] text-[var(--ph-ink)]">
            {formatMinor(shown, currency)}
          </span>
        </div>
        <div aria-hidden data-testid="split-bar" className="mt-[10px] flex h-[8px] gap-[2px] overflow-hidden rounded-full bg-[var(--ph-fill)]">
          {splits.map((row, i) => (
            <i key={i} style={{ width: `${(shares[i] ?? 0) * 100}%`, background: isNotCountedRow(row) ? OTHER_COLOUR : colourOf(row.categoryId || null) }} />
          ))}
        </div>
        {status && (
          <p data-testid="split-status" className={`mt-[8px] text-[12.5px] leading-[16px] ${status.startsWith('Over') ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink-3)]'}`}>
            {status}
          </p>
        )}
      </div>
      {splits.length > 0 && (
        <InsetGroup>
          {splits.map((row, i) => {
            const minor = amountOf(row);
            return (
              <InsetRow
                key={i}
                testId="split-row"
                icon={markOf(row).icon}
                iconColour={markOf(row).colour}
                title={nameOf(row)}
                subtitle={noteOf(row, i)}
                value={minor === null ? '—' : formatMinor(minor, currency)}
                valueTone={i === at ? 'ink-3' : 'ink'}
                onClick={() => {
                  setOver(null);
                  setPart(i);
                }}
              />
            );
          })}
        </InsetGroup>
      )}
      <InsetGroup footer={splits.length > 0 ? 'A part opens to change its category, amount or Exclude from report.' : undefined}>
        <InsetRow
          action
          title="＋ Add a part"
          onClick={() => {
            setOver(null);
            setSplits(addPart(splits, { categoryId: draft.categoryId, amount: draft.amount }, whole, total, currency));
          }}
        />
      </InsetGroup>
      {refusal && (
        <p role="alert" className="px-[13px] pt-2 text-[12.5px] leading-4 text-[var(--ph-warn)]">
          {refusal}
        </p>
      )}
      {current && part !== null && (
        <Sheet grouped title={`Part ${part + 1}`} onClose={() => setPart(null)} confirm={{ label: 'Done', run: () => setPart(null) }}>
          <InsetGroup>
            <PickerRow
              label="Category"
              testId="split-part-category"
              value={isNotCountedRow(current) ? 'Not counted' : current.categoryId ? (accounts.find((a) => a.id === current.categoryId)?.name ?? null) : null}
              placeholder="Select"
              onOpen={() => setPicking({ index: part, workspaceFirst: false })}
            />
            {workspaceChoices(openBook, others, notCountedOffered, isNotCountedRow(current)).length > 1 && (
              <PickerRow
                label="Workspace"
                value={isNotCountedRow(current) ? 'Not counted' : ((current.categoryId ? partName(current.categoryId) : null) ?? openBook?.name ?? null)}
                onOpen={() => setPicking({ index: part, workspaceFirst: true })}
              />
            )}
            {total !== null && splits.length === 1 ? (
              <ReadOnlyRow label="Amount" value={formatMinor(total, currency)} />
            ) : (
              <TextRow
                label="Amount"
                prefix={currency}
                value={current.amount}
                inputMode="decimal"
                placeholder="Amount"
                hint={part === at ? 'Works out from the other parts. Typing an amount here fixes it, and the part before it becomes the Rest.' : undefined}
                onChange={(e) => {
                  const edit = editAmount(splits, part, groupTypedAmount(e.target.value, currency), total, currency);
                  if ('refusal' in edit) return setOver(edit.refusal);
                  setOver(null);
                  setSplits(edit.splits);
                }}
              />
            )}
          </InsetGroup>
          {over && (
            <p role="alert" className="-mt-[8px] mb-[14px] px-[13px] text-[12.5px] leading-4 text-[var(--ph-warn)]">
              {over}
            </p>
          )}
          {current.categoryId && !isNotCountedRow(current) && (
            <InsetGroup>
              <SwitchRow
                label="Exclude from report"
                info={`Out of ${partName(current.categoryId) ?? 'the workspace'}’s chart and budgets. Still counted in the card’s balance, statement and points.`}
                checked={current.excluded ?? false}
                onChange={(excluded) => setSplits(withPartExcluded(splits, part, excluded))}
              />
            </InsetGroup>
          )}
          {isNotCountedRow(current) && (
            <p className="mb-[14px] px-[13px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              In no workspace and no report. Still counted in the card’s balance, statement and points.
            </p>
          )}
          <InsetGroup>
            <DestructiveRow
              label="Remove part"
              onClick={() => {
                setPart(null);
                setOver(null);
                setSplits(removePart(splits, part, total, currency));
              }}
            />
          </InsetGroup>
        </Sheet>
      )}
      {picking !== null && splits[picking.index] && (
        <PartCategorySheet
          value={splits[picking.index]!.categoryId}
          choices={workspaceChoices(openBook, others, notCountedOffered, isNotCountedRow(splits[picking.index]!))}
          initial={isNotCountedRow(splits[picking.index]!) ? '' : (bookOf(splits[picking.index]!.categoryId) ?? ws.bookId ?? '')}
          workspaceFirst={picking.workspaceFirst}
          onPick={(categoryId) => setSplits(withSplitCategory(splits, picking.index, categoryId))}
          onClose={() => setPicking(null)}
        />
      )}
    </Sheet>
  );
}
