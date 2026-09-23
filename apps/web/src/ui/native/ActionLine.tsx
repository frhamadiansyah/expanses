import { type LinkProps, Link } from '@tanstack/react-router';
import { type CSSProperties, type ReactNode } from 'react';
import { cx } from '../index';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight, tapReach } from './metrics';

/**
 * A line of a list whose row carries more than one action, and the actions it carries.
 *
 * The kit's `InsetRow` is one tap target and forbids a button inside itself, which is right for a list of places
 * to go and wrong for a list of things to manage: a category carries four to six actions, an account carries its
 * tax code, the door to its points and Rename/Archive. So those lists are lines on a `Panel` drawn on the kit's
 * own padding, height, hairline and inks — the same shape to the eye, with the actions wrapping under the name
 * on a phone instead of scrolling sideways, which is what the tables they replaced did.
 *
 * There is one of these, and it is a primitive for the same reason the row is: the second copy of a shape is
 * where the first one stops being true.
 */

/** How tall an action is drawn. Its picture is a word, so this is a line of the 13 px text it is set in. */
const ACTION_HEIGHT = 20;

/**
 * One action on a line: the kit's tint, at the kit's reach, without the box the kit exists to remove.
 *
 * Drawn small because there are four to six of these on every line; hit at 44 pt because `ph-tap` grows the
 * target around the picture rather than the picture itself, exactly as the segmented control does. It is a real
 * link when it goes somewhere and a real button when it does something, so a keyboard and a spec can tell them
 * apart by role.
 */
export function LineAction({
  label,
  onClick,
  to,
  params,
  search,
  children,
}: {
  /** The action's accessible name, when its words alone do not read as one. */
  label?: string;
  onClick?: () => void;
  to?: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  children: ReactNode;
}) {
  const className = 'ph-focus ph-tap shrink-0 rounded text-[13px] leading-[20px] font-medium whitespace-nowrap text-[var(--ph-tint)]';
  const style = { '--ph-tap-y': `${tapReach(ACTION_HEIGHT)}px` } as CSSProperties;
  if (to !== undefined) {
    return (
      <Link to={to} params={params} search={search} className={className} style={style} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} className={className} style={style}>
      {children}
    </button>
  );
}

/**
 * One line: what it is called, whatever else it says, and everything you can do to it.
 *
 * Two shapes, because there are two kinds of line. A tree node has notes of its own — a card code, a need — and
 * puts its name on a line of its own with the notes and then the actions wrapping after it (`meta`). A line that
 * is about a figure keeps the name and the figure together on one line, right-aligned as a row's value is, and
 * wraps only its actions underneath (`figure`). What the two share — the padding, the hairline, the inks, the
 * 44 pt floor under every action — is what makes them the same primitive.
 */
export function ActionLine({
  name,
  subtitle,
  depth = 0,
  separator,
  meta,
  figure,
  children,
}: {
  name: ReactNode;
  /** A quieter line under the name: what kind of thing this is, what else is true of it. */
  subtitle?: ReactNode;
  /** How far the line is indented, for a tree. */
  depth?: number;
  /** Draw the hairline above the line. The first line of a group never has one. */
  separator: boolean;
  /** Notes that wrap beside the name and its actions — a code, a mark. */
  meta?: ReactNode;
  /** The figure the line is about: kept on the name's own line, on the right. */
  figure?: ReactNode;
  children?: ReactNode;
}) {
  const words = (
    <>
      {name}
      {subtitle && <span className="mt-[2px] block text-[12.5px] leading-[16px] font-normal text-[var(--ph-ink-3)]">{subtitle}</span>}
    </>
  );
  const nameClass = cx('min-w-0 flex-1 text-[15px] leading-[20px] text-[var(--ph-ink)]', depth === 0 && 'font-medium');
  return (
    <div className="relative" style={{ paddingLeft: depth * 20 }}>
      {separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />
      )}
      <div style={{ minHeight: rowHeight(Boolean(subtitle)), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        {figure === undefined ? (
          /* The tree's shape: the name takes a line of its own before the notes and actions wrap after it. */
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[2px]">
            <span className={cx(nameClass, 'basis-full sm:basis-auto')}>{words}</span>
            {meta}
            {children}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-x-[12px]">
              <span className={nameClass}>{words}</span>
              {figure}
            </div>
            {children && <div className="mt-[2px] flex flex-wrap items-center gap-x-[12px] gap-y-[2px]">{children}</div>}
          </>
        )}
      </div>
    </div>
  );
}
