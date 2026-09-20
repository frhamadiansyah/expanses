import { formatMinor } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Sheet } from '../../app/Sheet';
import { Button, Input, Select } from '../../ui';
import { CategoryOptions } from '../cards/options';
import { type FormDraft, type SplitRow, splitTotalMinor } from './tx-form';

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
  const splits = draft.splits;
  const setSplits = (next: SplitRow[]) => onChange({ ...draft, splits: next });
  return (
    <Sheet title="Split" onClose={onClose}>
      <div className="space-y-2">
        {splits.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
            <Select
              aria-label={`Split ${i + 1} category`}
              value={row.categoryId}
              onChange={(e) => setSplits(splits.map((r, j) => (j === i ? { ...r, categoryId: e.target.value } : r)))}
            >
              <CategoryOptions accounts={accounts as AccountRow[]} kind="expense" parentSuffix="(general)" />
            </Select>
            <Input
              aria-label={`Split ${i + 1} amount`}
              value={row.amount}
              inputMode="decimal"
              onChange={(e) => setSplits(splits.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
            />
            <Button variant="ghost" onClick={() => setSplits(splits.filter((_, j) => j !== i))} aria-label={`Remove split ${i + 1}`}>
              ✕
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              setSplits(
                splits.length ? [...splits, { categoryId: '', amount: '' }] : [{ categoryId: draft.categoryId, amount: draft.amount }, { categoryId: '', amount: '' }],
              )
            }
          >
            + Split
          </Button>
          {splits.length > 0 && (
            <span className="tabular text-sm text-slate-600">Total {formatMinor(splitTotalMinor(splits, currency), currency)}</span>
          )}
        </div>
      </div>
    </Sheet>
  );
}
