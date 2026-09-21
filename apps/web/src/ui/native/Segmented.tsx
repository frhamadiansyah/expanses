import { Link } from '@tanstack/react-router';
import { MoreHorizontal } from 'lucide-react';
import { type CSSProperties, type KeyboardEvent, useRef, useState } from 'react';
import { useEscape } from '../../app/use-escape';
import { cx } from '../index';
import { tapReach } from './metrics';
import { PHONE_MAX, SEGMENT_HEIGHT, SEGMENT_MORE, type Segment, fitSegments, segmentRoute } from './segments';

/**
 * Primitive 4: the segmented control. It replaces every underline tab row in the app.
 *
 * The thing an underline tab row does that this must never do is wrap — `/net-worth` wraps five tabs onto two
 * lines at 390 px today, and `/cards/$cardId` wraps four. `fitSegments` decides what gives: a label shortens
 * first, and only a label nobody can shorten pushes a segment behind the `…`.
 *
 * Keyboard: one tab stop for the whole control, arrows between the segments — a radio group, which is what a
 * segmented control is. Tabbing through four look-alike buttons is not navigation, it is an obstacle.
 *
 * A segment that names a route is drawn as a real `<a>` and still behaves as a segment: same shape, same
 * selection, same arrows, plus the three things only a link can do — middle click, ⌘-click, and "open link in
 * new tab". The app's main section navigation is on a desktop that pays for it, and a radio button calling
 * `navigate` takes all three away without anything on screen saying so.
 *
 * Reach: iOS draws this control about 32 tall and still gives each segment a 44 pt target, so the drawn heights
 * below stay iOS's and `ph-tap` grows the target around them. Nothing here is 44 to the eye; everything is to a
 * thumb.
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

  // Arrows walk the segments and take the selection with them, as a radio group does — link or button alike.
  const move = (from: number, step: number) => {
    const next = plan.shown[(from + step + plan.shown.length) % plan.shown.length];
    if (!next) return;
    onChange(next.key);
    track.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.key)}"]`)?.focus();
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
          const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              move(index, 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(index, -1);
            } else if (event.key === ' ' && segment.route) {
              // A button takes Space for free; a link would scroll the page instead, and a radio must not.
              event.preventDefault();
              onChange(segment.key);
            }
          };
          const shared = {
            'data-key': segment.key,
            role: 'radio' as const,
            'aria-checked': selected,
            tabIndex: selected ? 0 : -1,
            onKeyDown,
            /* flex-1 + basis-0 + min-w-0 is what makes the segments equal width and stops any of them wrapping. */
            className: cx(
              'ph-focus-inset ph-tap block min-w-0 flex-1 basis-0 px-[9px] text-center text-[12.5px] leading-[28px] font-semibold whitespace-nowrap',
              selected ? 'bg-[var(--ph-selected)] text-[var(--ph-ink)] shadow-[0_1px_3px_rgb(0_0_0/0.14)]' : 'text-[var(--ph-ink-2)]',
            ),
            /* A segment is as wide as its share of the track, so only its height is short of the floor. */
            style: { borderRadius: 7, minHeight: SEGMENT_HEIGHT, '--ph-tap-y': `${tapReach(SEGMENT_HEIGHT)}px` } as CSSProperties,
            /*
             * The clipping lives on the label rather than on the segment: `overflow: hidden` on the segment
             * would cut `ph-tap`'s reach back to the drawn box, which is the whole of what it is for.
             */
            children: <span className="block truncate">{segment.label}</span>,
          };
          // The link navigates by itself — calling `onChange` as well would be the same journey made twice.
          return segment.route ? (
            <Link key={segment.key} to={segment.route.to} params={segment.route.params} search={segment.route.search} {...shared} />
          ) : (
            <button key={segment.key} type="button" onClick={() => onChange(segment.key)} {...shared} />
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
            className="ph-focus ph-tap flex items-center justify-center rounded-full bg-[var(--ph-track)] text-[var(--ph-ink-2)]"
            /* The … is 32 square, so it is under the floor in both directions and reaches in both. */
            style={
              {
                width: SEGMENT_MORE,
                height: SEGMENT_MORE,
                '--ph-tap-y': `${tapReach(SEGMENT_MORE)}px`,
                '--ph-tap-x': `${tapReach(SEGMENT_MORE)}px`,
              } as CSSProperties
            }
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
                {plan.overflow.map((segment, index) => {
                  /*
                   * The `…` is where a phone keeps the segments that did not fit — on `/net-worth` that is
                   * Loans. A menu item for a route is a link for the same reason a segment is: it is the only
                   * way to the section that a new tab understands.
                   */
                  const route = segmentRoute(segment);
                  const shared = {
                    role: 'menuitem' as const,
                    className: cx(
                      'ph-focus-inset block w-full px-[13px] py-[11px] text-left text-[15px] leading-[20px] text-[var(--ph-ink)]',
                      index > 0 && 'border-t-[0.5px] border-[var(--ph-hair)]',
                    ),
                    children: segment.label,
                  };
                  return route ? (
                    <Link key={segment.key} to={route.to} params={route.params} search={route.search} onClick={() => setOpen(false)} {...shared} />
                  ) : (
                    <button
                      key={segment.key}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onChange(segment.key);
                      }}
                      {...shared}
                    />
                  );
                })}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
