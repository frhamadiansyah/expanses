import { MoreHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { useEscape } from '../../app/use-escape';
import { cx } from '../index';
import { PHONE_MAX, type Segment, fitSegments } from './segments';

/**
 * Primitive 4: the segmented control. It replaces every underline tab row in the app.
 *
 * The thing an underline tab row does that this must never do is wrap — `/net-worth` wraps five tabs onto two
 * lines at 390 px today, and `/cards/$cardId` wraps four. `fitSegments` decides what gives: a label shortens
 * first, and only a label nobody can shorten pushes a segment behind the `…`.
 *
 * Keyboard: one tab stop for the whole control, arrows between the segments — a radio group, which is what a
 * segmented control is. Tabbing through four look-alike buttons is not navigation, it is an obstacle.
 */
export function SegmentedControl({
  segments,
  value,
  onChange,
  width,
  max = PHONE_MAX,
  label,
  className,
}: {
  segments: readonly Segment[];
  value: string;
  onChange: (key: string) => void;
  /** The track's width in px, which decides how many labels fit. Defaults to a phone's. */
  width?: number;
  /** How many segments this width may hold. A wide screen passes more; the phone's four is the default. */
  max?: number;
  label: string;
  className?: string;
}) {
  const plan = fitSegments(segments, width, max);
  const [open, setOpen] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);

  // Arrows walk the segments and take the selection with them, as a radio group does.
  const move = (from: number, step: number) => {
    const next = plan.shown[(from + step + plan.shown.length) % plan.shown.length];
    if (!next) return;
    onChange(next.key);
    track.current?.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(next.key)}"]`)?.focus();
  };

  return (
    <div className={cx('flex items-center gap-[8px]', className)}>
      <div
        ref={track}
        role="radiogroup"
        aria-label={label}
        className="flex min-w-0 flex-1 items-stretch bg-[var(--ph-track)] p-[2px]"
        style={{ borderRadius: 9 }}
      >
        {plan.shown.map((segment, index) => {
          const selected = segment.key === value;
          return (
            <button
              key={segment.key}
              type="button"
              role="radio"
              data-key={segment.key}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(segment.key)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(index, -1);
                }
              }}
              /* flex-1 + basis-0 + min-w-0 is what makes the segments equal width and stops any of them wrapping. */
              className={cx(
                'ph-focus-inset min-w-0 flex-1 basis-0 truncate px-[9px] text-[12.5px] leading-[28px] font-semibold whitespace-nowrap',
                selected ? 'bg-[var(--ph-selected)] text-[var(--ph-ink)] shadow-[0_1px_3px_rgb(0_0_0/0.14)]' : 'text-[var(--ph-ink-2)]',
              )}
              style={{ borderRadius: 7, minHeight: 28 }}
            >
              {segment.label}
            </button>
          );
        })}
      </div>
      {plan.overflow.length > 0 && (
        <span className="relative shrink-0">
          <button
            type="button"
            aria-label={`More ${label}`}
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="ph-focus flex items-center justify-center rounded-full bg-[var(--ph-track)] text-[var(--ph-ink-2)]"
            style={{ width: 32, height: 32 }}
          >
            <MoreHorizontal size={18} aria-hidden />
          </button>
          {open && (
            <>
              <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} role="presentation" />
              <span
                role="menu"
                aria-label={`More ${label}`}
                className="absolute right-0 z-20 mt-[6px] block min-w-[180px] overflow-hidden bg-[var(--ph-surface)] shadow-[0_10px_30px_-8px_rgb(0_0_0/0.35)]"
                style={{ borderRadius: 11 }}
              >
                {plan.overflow.map((segment, index) => (
                  <button
                    key={segment.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onChange(segment.key);
                    }}
                    className={cx(
                      'ph-focus-inset block w-full px-[13px] py-[11px] text-left text-[15px] leading-[20px] text-[var(--ph-ink)]',
                      index > 0 && 'border-t-[0.5px] border-[var(--ph-hair)]',
                    )}
                  >
                    {segment.label}
                  </button>
                ))}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
