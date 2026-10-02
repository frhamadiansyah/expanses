import { BUDGET_FREQUENCIES, type BudgetFrequency, type BudgetLine, formatMinor, groupTypedAmount, parseMajor } from '@expanses/core';
import { type BudgetRow, clearBudgetOverride, removeBudget, saveBudget, setBudgetOverride } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { bareFigure } from '../networth/debt-rows';
import { FREQUENCY_WORDS, perMonthPreview } from './frequency-form';
import { FigureRow } from './budget-rows';

export interface CategoryOption {
  id: string;
  label: string;
}

/** What is typed into the Cap row to begin with: this month's own figure when it has one, else the plan as it was typed. */
function startingFigure(row: BudgetRow | undefined, thisMonthOnly: boolean, currency: string): string {
  if (!row) return '';
  return bareFigure(thisMonthOnly ? row.amountMinor : row.amountAsSetMinor, currency);
}

/**
 * The cap of one category: ✕ · its name · ✓. The cap, the unit it was typed in, and whether it is this month's alone;
 * then what the month has spent against it, and a way to take it off.
 *
 * Opened from a row it knows its category; opened from ⋯ Add a budget it asks for one first.
 */
export function CapSheet({
  categoryId: given,
  options,
  month,
  currency,
  ready,
  lineOf,
  rowOf,
  committed,
  onClose,
}: {
  /** Null when the sheet was opened to add a budget and the category is still to be chosen. */
  categoryId: string | null;
  options: readonly CategoryOption[];
  month: string;
  /** The open workspace's own currency, which a cap is typed and parsed in. */
  currency: string;
  /** False until the workspace's currency is known: nothing is parsed in a guess. */
  ready: boolean;
  lineOf: (id: string) => BudgetLine | undefined;
  rowOf: (id: string) => BudgetRow | undefined;
  committed: Readonly<Record<string, number>>;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [picked, setPicked] = useState(given ?? '');
  const categoryId = given ?? picked;
  const row = categoryId ? rowOf(categoryId) : undefined;
  const line = categoryId ? lineOf(categoryId) : undefined;
  const [thisMonthOnly, setThisMonthOnly] = useState(Boolean(row?.overridden));
  const [frequency, setFrequency] = useState<BudgetFrequency>(row?.frequency ?? 'monthly');
  const [amount, setAmount] = useState(() => startingFigure(row, Boolean(row?.overridden), currency));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // An override is always a month's figure; only the plan is typed in the unit it is thought of in.
  const unit: BudgetFrequency = thisMonthOnly ? 'monthly' : frequency;
  const preview = perMonthPreview(amount, unit, currency);
  const name = options.find((option) => option.id === categoryId)?.label.replace(/^— /, '') ?? line?.name ?? 'New budget';

  const choose = (id: string) => {
    setPicked(id);
    const next = id ? rowOf(id) : undefined;
    setThisMonthOnly(Boolean(next?.overridden));
    setFrequency(next?.frequency ?? 'monthly');
    if (!touched) setAmount(startingFigure(next, Boolean(next?.overridden), currency));
  };

  const switchMonth = (on: boolean) => {
    setThisMonthOnly(on);
    if (!touched) setAmount(startingFigure(row, on, currency));
  };

  async function save() {
    setError(null);
    if (!ready || busy) return;
    try {
      if (!categoryId) throw new Error(options.length === 0 ? 'There are no categories to budget for yet' : 'Choose a category');
      // The empty box is the one refusal `parseMajor` has no words for, so it is worded here.
      if (!amount.trim()) throw new Error('The cap is empty — type a figure');
      const minor = parseMajor(amount, currency);
      setBusy(true);
      if (thisMonthOnly) await setBudgetOverride(database, ws, { categoryAccountId: categoryId, month, amountMinor: minor });
      else await saveBudget(database, ws, { categoryAccountId: categoryId, amountMinor: minor, frequency: unit });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  async function remove() {
    if (!categoryId || busy) return;
    setError(null);
    try {
      setBusy(true);
      // With Just this month on, only this month's own figure goes, and the plan stands.
      if (thisMonthOnly && row?.overridden) await clearBudgetOverride(database, ws, categoryId, month);
      else await removeBudget(database, ws, categoryId);
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title={name} onClose={onClose} confirm={{ label: 'Save budget', disabled: !ready || busy, run: () => void save() }}>
      {given === null && (
        <InsetGroup>
          {/* The empty choice stays first and selected until one is made: nothing is capped that nobody picked. */}
          <SelectRow label="Category" value={picked} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>
      )}

      <InsetGroup>
        <TextRow
          label="Cap"
          value={amount}
          placeholder="Amount"
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          onChange={(e) => {
            setTouched(true);
            setAmount(groupTypedAmount(e.target.value, currency));
          }}
        />
        {!thisMonthOnly && (
          <SelectRow label="Every" value={frequency} onChange={(e) => setFrequency(e.target.value as BudgetFrequency)}>
            {BUDGET_FREQUENCIES.map((key) => (
              <option key={key} value={key}>
                {FREQUENCY_WORDS[key].every}
              </option>
            ))}
          </SelectRow>
        )}
        {unit !== 'monthly' && <ReadOnlyRow label="Per month" value={preview === null ? null : formatMinor(preview, currency)} />}
        {/* Only a cap that exists can be changed for one month: there is nothing to override before it. */}
        {row && <SwitchRow label="Just this month" checked={thisMonthOnly} onChange={switchMonth} />}
      </InsetGroup>

      {line && (
        <InsetGroup>
          <FigureRow label="Spent so far" value={formatMinor(line.totalMinor, currency)} dim testId="cap-spent" />
          {committed[line.id] !== undefined && <FigureRow label="Of it, bills" value={formatMinor(committed[line.id]!, currency)} dim testId="cap-bills" />}
        </InsetGroup>
      )}

      <ErrorBox error={error} />

      {row && (
        <InsetGroup>
          <InsetRow title={<span className="font-normal">Remove budget</span>} chevron={false} onClick={() => void remove()} label="Remove budget" />
        </InsetGroup>
      )}
    </Sheet>
  );
}
