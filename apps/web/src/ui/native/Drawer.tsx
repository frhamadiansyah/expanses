import { type ReactNode, useState } from 'react';
import { cx } from '../index';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight } from './metrics';

/**
 * Primitive 11: the drawer — a line that folds the rows of one kind away, and says how many there are and what they
 * come to.
 *
 * A list of everything you own is as long as the accounts you have opened, and the answer to "what do I have" is
 * usually a handful of types rather than a page of names. So a list folds itself by what each thing *is* — current
 * accounts with current accounts — and the drawer carries the arithmetic that type comes to, so nothing has to be
 * opened to read the shape of it.
 *
 * Drawn on the kit's own padding, height, hairline and inks: the same shape to the eye as the rows it hides, and the
 * whole line is the target, because a drawer that opens only when its words are hit is a drawer a thumb misses.
 *
 * The chevron is the kit's own, turned over — along when the drawer is shut, down when it is open — because a drawer
 * whose state is only in its contents is a drawer nobody can tell the state of.
 */

/**
 * Which drawers are open, by key, and shut to begin with.
 *
 * The point of folding a list away is that the answer to "what have I got" is a handful of kinds, and a drawer that
 * opens itself is that answer hidden again. The key is the caller's, because a page with two columns of drawers needs
 * one that is unique across both — `group:kind` rather than `kind`.
 */
export function useDrawers() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { open, toggle };
}

export function Drawer({
  label,
  under,
  figure,
  open,
  separator = false,
  testId,
  onToggle,
}: {
  /** The kind of thing inside: "Current account", "Credit card", "Time deposit". */
  label: string;
  /** What is inside, counted: "3 accounts". Left off where the count says nothing — two credit cards, one card. */
  under?: ReactNode;
  /** What the rows inside come to. The figure's own shape, drawn by the caller who knows what it is made of. */
  figure?: ReactNode;
  open: boolean;
  /** Whether a hairline belongs above this line, which only a caller with siblings knows. */
  separator?: boolean;
  testId?: string;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      {separator && <span aria-hidden className="pointer-events-none absolute top-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={testId}
        className="ph-focus-inset flex w-full items-center gap-[10px] text-left"
        style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{label}</span>
          {under !== undefined && <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{under}</span>}
        </span>
        {figure}
        <span aria-hidden className={cx('shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]', open && 'rotate-90')}>
          {'›'}
        </span>
      </button>
    </div>
  );
}
