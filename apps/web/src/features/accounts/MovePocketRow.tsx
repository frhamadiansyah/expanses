import { Check } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { type GroupChild, InsetGroup, InsetRow, ROW_PAD_X } from '../../ui/native';

/**
 * Layout B (owner, 17 Nov 2026): both pockets in one box. A row is tall enough that the ⇅ on the hairline (32pt, half
 * of it in each row) clears the grey line above it: at 58pt it covered the end of "From · £1.500,00 available". The
 * mockup draws its rows at 78pt.
 */
const ROW_MIN = 72;
const ROW_PAD_Y = 16;

export interface PocketChoice {
  id: string;
  name: string;
  available: string;
}

/**
 * One row of the Move page's box: the pocket on the left (its name, and under it in grey "From · £1.500,00 available"),
 * the figure on the right. The left part is a button that opens a small sheet to pick another pocket; the right part is
 * the figure typed in place. The two are siblings, never one inside the other. The second row draws the box's hairline
 * above it, and `onLine` — the ⇅ — sits on that hairline, centred.
 */
export function MovePocketRow({
  word,
  current,
  choices,
  onPick,
  figure,
  onLine,
  position,
}: GroupChild & {
  /** "From" or "To": names the picker for a screen reader. */
  word: 'From' | 'To';
  current: PocketChoice;
  choices: readonly PocketChoice[];
  onPick: (id: string) => void;
  /** The figure on the right, or null when there is none to type (the same currency on both sides). */
  figure: (InputHTMLAttributes<HTMLInputElement> & { 'aria-label': string }) | null;
  /** Drawn centred on the hairline above this row. */
  onLine?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative flex items-center gap-3" style={{ minHeight: ROW_MIN, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        {position?.separator && (
          <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />
        )}
        {/* Before the row's own parts, so a screen reader meets it between the two pockets, where it is drawn. */}
        {onLine && <div className="absolute top-0 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2">{onLine}</div>}
        <button type="button" aria-label={`${word}, ${current.name}`} aria-haspopup="dialog" onClick={() => setOpen(true)} className="ph-focus-inset min-w-0 flex-1 text-left">
          <span className="block truncate text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{current.name}</span>
          <span className="mt-[2px] block truncate text-[13px] leading-[16px] text-[var(--ph-ink-3)]">
            {word} · {current.available} available
          </span>
        </button>
        {figure ? (
          <input
            {...figure}
            inputMode="decimal"
            className="ph-focus tabular min-w-0 basis-[42%] rounded bg-transparent text-right text-[19px] leading-[24px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]"
          />
        ) : (
          <span aria-hidden className="text-[19px] leading-[24px] text-[var(--ph-ink-3)] md:text-[15px] md:leading-[20px]">
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
