import { type CategoryNeed, type ResolvedNeed } from '@expanses/core';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { type GroupChild, ROW_PAD_X, ROW_PAD_Y, TAP } from '../../ui/native';

const NEED_EXPLAINED =
  'Essential or lifestyle decides what an emergency fund covers and how the Budget splits what you spent. A category with no mark follows its parent, and counts as essential at the top.';

/**
 * "Counts as", answered by the native pop-up menu: the answer is always one of two, and the row shows which even when
 * it is inherited. Choosing either makes the mark the category's own.
 */
export function NeedRow({ name, need, caption, onChoose, position }: GroupChild & { name: string; need: ResolvedNeed; caption?: string; onChoose: (need: CategoryNeed) => void }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ minHeight: TAP, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-[6px]">
            <span className="text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">Counts as</span>
            {/* The why of the answer, the way a form row's ⓘ opens its own: under the row, until tapped again. */}
            <button
              type="button"
              aria-label="About Counts as"
              aria-expanded={explained}
              onClick={() => setExplained((was) => !was)}
              className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
            >
              <Info size={16} aria-hidden />
            </button>
          </span>
          {caption && (
            <span data-testid="need-source" className="mt-[2px] block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              {caption}
            </span>
          )}
        </span>
        {/* The answer and ›, drawn as every other row's, over a real select so the phone opens its own native menu. */}
        <span className="ph-focus-within relative flex shrink-0 items-center gap-[4px] text-[16px] leading-[20px] text-[var(--ph-ink-2)] md:text-[15px]">
          <span aria-hidden>{need.need === 'lifestyle' ? 'Lifestyle' : 'Essential'}</span>
          <span aria-hidden className="text-[17px] leading-none text-[var(--ph-chevron)]">{'›'}</span>
          <select
            aria-label={`What ${name} counts as`}
            value={need.need}
            onChange={(e) => {
              const key = e.target.value as CategoryNeed;
              if (key !== need.need || need.source !== 'yours') onChoose(key);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          >
            <option value="essential">Essential</option>
            <option value="lifestyle">Lifestyle</option>
          </select>
        </span>
      </div>
      {explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{NEED_EXPLAINED}</p>}
    </div>
  );
}
