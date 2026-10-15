import { BUDGET_FREQUENCIES, type BudgetFrequency, type BudgetLine, formatMinor, groupTypedAmount, parseMajor, roundUpToMajor } from '@expanses/core';
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
import type { SpendHistory } from './budget-view';

/** What is typed into the Cap row to begin with: this month's own figure when it has one, else the plan as it was typed. */
function startingFigure(row: BudgetRow | undefined, thisMonthOnly: boolean, currency: string): string {
  if (!row) return '';
  return bareFigure(thisMonthOnly ? row.amountMinor : row.amountAsSetMinor, currency);
}

/**
 * The cap of one category: ✕ · its name · ✓. The cap, the unit it was typed in, and whether it is this month's alone;
 * then what the month has spent against it, and a way to take it off.
 *
 * Always opened for a known category, from its row. The Cap row has focus with its figure selected, so typing replaces
 * it; figures to start from — last month, the average, the month so far — are a tap each.
 */
export function CapSheet({
  categoryId,
  name,
  history,
  month,
  currency,
  ready,
  lineOf,
  rowOf,
  committed,
  onClose,
}: {
  categoryId: string;
  /** The category's name, for the sheet's title. */
  name: string;
  /** What it spent in the months before; null while those are still being read. */
  history: SpendHistory | null;
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
  const row = rowOf(categoryId);
  const line = lineOf(categoryId);
  const [thisMonthOnly, setThisMonthOnly] = useState(Boolean(row?.overridden));
  const [frequency, setFrequency] = useState<BudgetFrequency>(row?.frequency ?? 'monthly');
  const [amount, setAmount] = useState(() => startingFigure(row, Boolean(row?.overridden), currency));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // An override is always a month's figure; only the plan is typed in the unit it is thought of in.
  const unit: BudgetFrequency = thisMonthOnly ? 'monthly' : frequency;
  const preview = perMonthPreview(amount, unit, currency);

  const switchMonth = (on: boolean) => {
    setThisMonthOnly(on);
    if (!touched) setAmount(startingFigure(row, on, currency));
  };

  // Figures to start from, each rounded up to a whole unit; one that comes to nothing is not offered.
  const chips = [
    { key: 'last', label: 'Last month', minor: roundUpToMajor(history?.lastMinor ?? 0, currency) },
    { key: 'average', label: '3-month average', minor: history?.averageMinor ?? 0 },
    { key: 'spent', label: 'Spent so far', minor: roundUpToMajor(line?.totalMinor ?? 0, currency) },
  ].filter((chip) => chip.minor > 0);

  /** A chip's figure into the Cap row. The figures are a month's, so the unit becomes Month. Nothing is saved yet. */
  const takeFigure = (minor: number) => {
    setTouched(true);
    setFrequency('monthly');
    setAmount(bareFigure(minor, currency));
  };

  async function save() {
    setError(null);
    if (!ready || busy) return;
    try {
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
    if (busy) return;
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
      <InsetGroup>
        <TextRow
          label="Cap"
          value={amount}
          placeholder="Amount"
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
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

      {chips.length > 0 && (
        <section className="mb-[18px] w-full" data-testid="cap-chips">
          <p className="mb-[6px] px-[16px] text-[13px] leading-[18px] text-[var(--ph-ink-3)] uppercase">Use a figure</p>
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => takeFigure(chip.minor)}
                aria-label={`${chip.label}, ${bareFigure(chip.minor, currency)}`}
                className="ph-focus ph-tap flex min-h-[44px] flex-col items-start justify-center rounded-[12px] bg-[var(--ph-surface)] px-[14px] py-[4px] text-left ring-1 ring-[var(--ph-hair)] ring-inset"
              >
                <span className="text-[12px] leading-[16px] text-[var(--ph-ink-3)]">{chip.label}</span>
                <span className="tabular text-[15px] leading-[20px] font-semibold text-[var(--ph-tint)]">{bareFigure(chip.minor, currency)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

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
