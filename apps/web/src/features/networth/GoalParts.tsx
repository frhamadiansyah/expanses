import { formatMinor, formatUnits } from '@expanses/core';
import { Plus, X } from 'lucide-react';
import { cx } from '../../ui';
import { type PartDraft, placed } from './goal-parts-form';

/**
 * A trade split between goals: a line per goal with its units (or, a fund tracked by money, its amount), "Add a goal",
 * and what is placed of the whole — red, and saving refused, when the parts take more than the trade. What no goal takes
 * stays the trade's own, with no goal.
 */
export function GoalParts({
  parts,
  onChange,
  goals,
  whole,
  byMoney,
  currency,
  unitLabel,
}: {
  parts: PartDraft[];
  onChange: (parts: PartDraft[]) => void;
  goals: readonly { id: string; name: string }[];
  /** The trade's own units (or gross), as typed in the form. */
  whole: string;
  byMoney: boolean;
  currency: string;
  unitLabel: string;
}) {
  const { placedValue, wholeValue, over } = placed(parts, whole, byMoney, currency);
  const say = (value: number) => (byMoney ? formatMinor(value, currency) : `${formatUnits(value)} ${unitLabel}`);
  const set = (index: number, change: Partial<PartDraft>) => onChange(parts.map((part, at) => (at === index ? { ...part, ...change } : part)));
  const free = goals.filter((goal) => !parts.some((part) => part.goalId === goal.id));
  return (
    <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)]" data-testid="goal-parts">
      {parts.map((part, index) => (
        <div key={index} className="flex min-h-11 items-center gap-2 border-b-[0.5px] border-[var(--ph-hair)] px-4 py-1.5">
          <select
            aria-label={`Goal ${index + 1}`}
            value={part.goalId}
            onChange={(e) => set(index, { goalId: e.target.value })}
            className="ph-focus min-w-0 flex-1 truncate bg-transparent py-1 text-[15px] text-[var(--ph-ink)]"
          >
            <option value="">Choose a goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id} disabled={goal.id !== part.goalId && parts.some((other) => other.goalId === goal.id)}>
                {goal.name}
              </option>
            ))}
          </select>
          <input
            aria-label={`${byMoney ? 'Amount' : 'Units'} for goal ${index + 1}`}
            value={part.amount}
            onChange={(e) => set(index, { amount: e.target.value })}
            inputMode="decimal"
            placeholder={byMoney ? 'Amount' : 'Units'}
            className="ph-focus tabular w-28 shrink-0 bg-transparent py-1 text-right text-[15px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)]"
          />
          <button
            type="button"
            aria-label={`Remove goal ${index + 1}`}
            onClick={() => onChange(parts.filter((_, at) => at !== index))}
            className="ph-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
          >
            <X size={15} aria-hidden />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...parts, { goalId: free[0]!.id, amount: '' }])}
          className="ph-focus-inset flex min-h-11 w-full items-center gap-2 border-b-[0.5px] border-[var(--ph-hair)] px-4 text-left text-[15px] text-[var(--ph-tint)]"
        >
          <Plus size={16} aria-hidden /> Add a goal
        </button>
      )}
      <div className="flex items-center justify-between px-4 py-2.5 text-[13px]" data-testid="goal-parts-placed">
        <span className="text-[var(--ph-ink-3)]">
          {wholeValue !== null && !over && wholeValue > placedValue ? `Not for a goal: ${say(wholeValue - placedValue)}` : 'Placed'}
        </span>
        <span className={cx('tabular font-semibold', over ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
          {wholeValue === null ? say(placedValue) : `${say(placedValue)} of ${say(wholeValue)}`}
        </span>
      </div>
    </div>
  );
}
