import { Check } from 'lucide-react';
import { type InputHTMLAttributes, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { InsetGroup, InsetRow, ROW_PAD_X, ROW_PAD_Y } from '../../ui/native';

export interface PocketChoice {
  id: string;
  name: string;
  available: string;
}

/**
 * One row of the Move page: the pocket on the left (its name, and what it holds under it), the figure on the right.
 * The left part is a button that opens a small sheet to pick another pocket; the right part is the figure typed in place.
 * The two are siblings, never one inside the other.
 */
export function MovePocketRow({
  word,
  current,
  choices,
  onPick,
  figure,
}: {
  /** "From" or "To": names the picker for a screen reader. */
  word: 'From' | 'To';
  current: PocketChoice;
  choices: readonly PocketChoice[];
  onPick: (id: string) => void;
  /** The figure on the right, or null when there is none to type (the same currency on both sides). */
  figure: (InputHTMLAttributes<HTMLInputElement> & { 'aria-label': string }) | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3" style={{ minHeight: 60, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <button type="button" aria-label={`${word}, ${current.name}`} aria-haspopup="dialog" onClick={() => setOpen(true)} className="ph-focus-inset min-w-0 flex-1 text-left">
          <span className="block truncate text-[17px] leading-[22px] font-medium text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{current.name}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{current.available} available</span>
        </button>
        {figure ? (
          <input
            {...figure}
            inputMode="decimal"
            className="ph-focus tabular min-w-0 basis-[42%] rounded bg-transparent text-right text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]"
          />
        ) : (
          <span aria-hidden className="text-[17px] leading-[22px] text-[var(--ph-ink-3)]">
            {'—'}
          </span>
        )}
      </div>
      {open && (
        <Sheet grouped title="Choose pocket" onClose={() => setOpen(false)}>
          <InsetGroup>
            {choices.map((c) => (
              <InsetRow
                key={c.id}
                title={c.name}
                subtitle={`${c.available} available`}
                value={c.id === current.id ? <Check size={18} aria-hidden /> : undefined}
                chevron={false}
                label={`${c.name}, ${c.available} available`}
                onClick={() => {
                  setOpen(false);
                  onPick(c.id);
                }}
              />
            ))}
          </InsetGroup>
        </Sheet>
      )}
    </>
  );
}
