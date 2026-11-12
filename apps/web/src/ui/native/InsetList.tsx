import { Link, type LinkProps } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { Children, cloneElement, createContext, Fragment, isValidElement, type ReactElement, type ReactNode, useContext, useState } from 'react';
import { cx } from '../index';
import { type SwipeAction, type SwipeHint, SwipeRow } from '../SwipeRow';
import { groupHeader, type HeaderProgress, type RowPosition, rowPositions } from './group';
import { GROUP_GAP, GROUP_RADIUS, NESTED_ICON, nestedPad, ROW_ICON, ROW_ICON_GAP, ROW_PAD_X, ROW_PAD_Y, rowHeight, TAP } from './metrics';
import { iconTint, planRow, type Tone } from './row';
import { type TreePlace, TreeLines } from './TreeLines';

/**
 * Primitives 1 and 2: the grouped inset list, and the row.
 *
 * A group is a flat white shape on grey with its header **outside and above** it. That is the single most
 * recognisable difference from the app today, where a section title sits inside a ringed card — so it is the
 * one thing in this file that is not negotiable by a caller.
 */

/** Tokens, as the class strings that reach for them. Colours only ever arrive from `tokens.css`. */
const TONE: Record<Tone, string> = {
  ink: 'text-[var(--ph-ink)]',
  'ink-2': 'text-[var(--ph-ink-2)]',
  'ink-3': 'text-[var(--ph-ink-3)]',
  alarm: 'text-[var(--ph-alarm)]',
  warn: 'text-[var(--ph-warn)]',
  tint: 'text-[var(--ph-tint)]',
  gain: 'text-[var(--ph-up)]',
};

export function toneClass(tone: Tone): string {
  return TONE[tone];
}

/** The chevron. Drawn as a glyph rather than an icon so it sits on the text's own baseline, as iOS's does. */
function Chevron() {
  return (
    <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
      {'›'}
    </span>
  );
}

export interface GroupChild {
  /** Filled in by `InsetGroup`. A row rendered outside a group draws no separator, which is correct. */
  position?: RowPosition;
}

/** The small grey caps of a group's header; anything drawn as one outside a group takes this too. */
export const GROUP_HEADER_CLASS = 'text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase';

/**
 * The header above a group: 11.5px / 600 / 0.06em / uppercase, outside the group, with an optional figure.
 *
 * The uppercase is a drawing, applied by CSS, so what a screen reader announces is the sentence that was
 * written rather than a string of shouted letters.
 */
function GroupHeader({ title, progress, trailing, info }: { title: string; progress?: HeaderProgress; trailing?: ReactNode; info?: ReactNode }) {
  const header = groupHeader(title, progress);
  const [explained, setExplained] = useState(false);
  return (
    <div className="px-[4px] pb-[6px]">
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-center gap-[6px]">
        <h2 className={GROUP_HEADER_CLASS}>{header.label}</h2>
        {info && (
          <button
            type="button"
            aria-label={`About ${title}`}
            aria-expanded={explained}
            onClick={() => setExplained((was) => !was)}
            className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
          >
            <Info size={16} aria-hidden />
          </button>
        )}
      </span>
      {(header.trailing ?? trailing) && (
        <span className="tabular shrink-0 text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
          {header.trailing ?? trailing}
        </span>
      )}
    </div>
    {info && explained && <div className="pt-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</div>}
    </div>
  );
}

const Wide = createContext(false);

/**
 * A column whose groups all take its full width on a wide screen — a desktop tab body laid out in columns of its
 * own, where each group already sits in a grid cell or is meant to span the page.
 *
 * Saying `wide` on every group of a screen is the same decision written thirty times, and the one that is
 * forgotten is the group that sits narrower than its neighbours. The phone is untouched: there, every group is
 * already the column.
 */
export function WideColumn({ children }: { children: ReactNode }) {
  return <Wide.Provider value={true}>{children}</Wide.Provider>;
}

/** Whether the groups here take the full column: asked for, or inside a `WideColumn`. */
export function useWide(wide: boolean): boolean {
  return useContext(Wide) || wide;
}

/**
 * The rows of a group, a fragment's rows counted as the group's own: a `<>` round two rows would otherwise be one
 * child, and neither would get a position, so no hairline would be drawn between them.
 */
function rowsOf(children: ReactNode, prefix = ''): ReactElement<GroupChild>[] {
  return Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement(child)) return [];
    const key = `${prefix}${child.key ?? index}`;
    if (child.type === Fragment) return rowsOf((child.props as { children?: ReactNode }).children, `${key}/`);
    return [cloneElement(child as ReactElement<GroupChild>, { key })];
  });
}

/**
 * A grouped inset list.
 *
 * The group hands each child its place — first, last, and whether a hairline is drawn above it — so a row never
 * has to be told where it is, and a group can never draw a separator below its last row.
 *
 * On a wide screen the group stops growing rather than stretching: a 1440 px window filled edge to edge with a
 * two-line row is a phone layout wearing a desktop's clothes. `wide` lets a caller that genuinely wants the
 * full column say so.
 */
export function InsetGroup({
  header,
  progress,
  trailing,
  footer,
  info,
  wide = false,
  className,
  children,
}: {
  header?: string;
  /** What the group is for, behind an ⓘ beside the header and shown under it only when asked — instead of a footer. */
  info?: ReactNode;
  progress?: HeaderProgress;
  trailing?: ReactNode;
  /** The sentence under a group. It belongs to the group, not to one row. */
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const items = rowsOf(children);
  const positions = rowPositions(items.length);
  const full = useWide(wide);
  return (
    <section className={cx('w-full', full ? '' : 'md:max-w-2xl', className)} style={{ marginBottom: GROUP_GAP }}>
      {header && <GroupHeader title={header} progress={progress} trailing={trailing} info={info} />}
      <div className="overflow-hidden bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
        {items.map((child, index) => cloneElement(child, { position: positions[index] }))}
      </div>
      {footer && <p className="px-[4px] pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p>}
    </section>
  );
}

export interface InsetRowProps extends GroupChild {
  /** Drawn as a child of the open drawer above it, on the tree line (`TreeLines`), so the indent reads as whose row it is. */
  tree?: TreePlace;
  /** A tinted circular icon: a 12 % wash of `colour`, with the glyph in `colour` itself. */
  icon?: ReactNode;
  iconColour?: string;
  /**
   * Laid on the icon circle's bottom-right corner: whose the row is, in a household's Net worth (joint-net-worth §8.2)
   * — the member's initial (`MemberBadge`). The glyph stays the kind's; only the mark says the owner, so the row stays
   * one line. Drawn only with `icon`.
   */
  iconMark?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** The title in the regular weight a form row's label has, for a row set among form rows (a Settings page); lists keep medium. */
  plain?: boolean;
  /** How many levels down a tree the row sits: its start and its hairline move in, and its circle is smaller. */
  depth?: number;
  /** The trailing figure. Set in tabular numerals and never truncated — it is what the row is for. */
  value?: ReactNode;
  valueTone?: Tone;
  chevron?: boolean;
  onClick?: () => void;
  /**
   * The row's gestures, for a list that has them: a right drag past the threshold calls this, and a left drag
   * reveals `leftActions` behind the row's left edge — the same `SwipeRow` the bills list pays a bill with. A tap
   * stays a tap: the drag that ends on a row never also opens it.
   */
  onSwipeRight?: () => void;
  /** What the ground under a right swipe shows while the drag is under way — "Record", "Pay" — round, as every swipe is. */
  rightHint?: SwipeHint;
  /** The round actions behind the left edge, revealed by a left drag. */
  leftActions?: readonly SwipeAction[];
  to?: LinkProps['to'];
  /**
   * The route's own parameters and search, handed to the link.
   *
   * A row that points at `/events/$eventId/plan/$itemId` cannot say where it goes with a path alone, and a screen
   * that answered that by building its own `<Link>` beside a row would be the tenth local copy of a primitive.
   */
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  /** A destructive action in a group of its own: centred, in alarm, no icon. */
  destructive?: boolean;
  /** A row that DOES something (Save, Add, Cancel, Share): title centred in ink, no chevron, no icon. Rows that open a page or show a value stay left. */
  action?: boolean;
  /**
   * A row that cannot be taken *yet*.
   *
   * A real `disabled` button: out of the tab order, dimmed, and refused by the platform rather than by a guard
   * inside `onClick` — which is what a caller needs when the refusal has to be visible to a test and to a screen
   * reader alike. `CornerAction` took the same flag for the same reason in `16a3c47`.
   */
  disabled?: boolean;
  /** The row's accessible name, when its title alone does not read as one. */
  label?: string;
  /** What a test names this row by, so a locator survives the row changing shape. `Panel` already takes one. */
  testId?: string;
  className?: string;
}

/**
 * A row. One component, everywhere.
 *
 * **A row never contains a button.** The row *is* the tap target — with `onClick` it is a real `<button>`, with
 * `to` a real link, and either way it answers Enter and Space and draws focus where it lands. A second control
 * inside it would put two targets inside one 44 pt box and leave a keyboard with no way to say which it meant.
 * A row that slides is not an exception: its action sits *behind* the row, never inside the tap target.
 */
/** A row's leading glyph, in the kit's own 28 px circle: the neutral fill, or the caller's tint when it gave one. */
export function RowIcon({ tint, size = 28, children }: { tint?: { background: string; foreground: string } | null; size?: number; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: tint?.background ?? 'var(--ph-fill)',
        color: tint?.foreground ?? 'var(--ph-ink-2)',
      }}
    >
      {children}
    </span>
  );
}

export function InsetRow({
  icon,
  iconColour,
  iconMark,
  title,
  subtitle,
  plain = false,
  depth = 0,
  value,
  valueTone = 'ink-3',
  chevron,
  onClick,
  onSwipeRight,
  rightHint,
  leftActions,
  to,
  params,
  search,
  destructive = false,
  action = false,
  disabled = false,
  label,
  testId,
  position,
  className,
  tree,
}: InsetRowProps) {
  const points = action ? false : (chevron ?? Boolean(onClick ?? to));
  const plan = planRow({ icon: Boolean(icon), title: String(title ?? ''), chevron: points });
  const tint = iconColour ? iconTint(iconColour) : null;

  const body = destructive ? (
    <span className="w-full text-center text-[17px] leading-[22px] md:text-[15px] md:leading-[20px] font-normal text-[var(--ph-alarm)]">{title}</span>
  ) : action ? (
    <span className="w-full text-center text-[17px] leading-[22px] md:text-[15px] md:leading-[20px] font-normal text-[var(--ph-ink)]">{title}</span>
  ) : (
    <>
      {icon &&
        (iconMark ? (
          // The mark hangs off the circle's corner, so the row is exactly as tall and as wide as one without it.
          <span className="relative inline-flex shrink-0">
            <RowIcon tint={tint} size={depth > 0 ? NESTED_ICON : undefined}>
              {icon}
            </RowIcon>
            {iconMark}
          </span>
        ) : (
          <RowIcon tint={tint} size={depth > 0 ? NESTED_ICON : undefined}>
            {icon}
          </RowIcon>
        ))}
      <span className="min-w-0 flex-1 text-left">
        {/* A row down a tree is a size smaller than a row at the top, as a drawer's kinds are: a long name still fits. */}
        <span className={cx('block truncate text-[var(--ph-ink)]', depth > 0 ? 'text-[15px] leading-[20px] font-normal' : 'text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]', plain ? 'font-normal' : 'font-medium')}>{title}</span>
        {subtitle && <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{subtitle}</span>}
      </span>
      {value !== undefined && value !== null && (
        <span className={cx('tabular shrink-0 whitespace-nowrap', depth > 0 ? 'text-[15px] leading-[20px]' : 'text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]', TONE[valueTone])}>{value}</span>
      )}
      {points && <Chevron />}
    </>
  );

  const treeLine = tree && depth > 0 ? <TreeLines depth={depth} tree={tree} /> : null;
  const inner = (
    <span
      className="flex w-full items-center"
      style={{
        gap: icon ? 10 : 8,
        minHeight: rowHeight(Boolean(subtitle)),
        padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px ${ROW_PAD_Y}px ${nestedPad(depth)}px`,
      }}
    >
      {treeLine}
      {body}
    </span>
  );

  const shell = cx('relative block w-full bg-transparent', disabled && 'opacity-40', className);
  const separator = position?.separator ? (
    <span
      aria-hidden
      className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]"
      style={{ height: 0.5, left: destructive || action ? 0 : depth === 0 ? plan.separatorInset : nestedPad(depth) + (icon ? NESTED_ICON + ROW_ICON_GAP : 0), right: ROW_PAD_X }}
    />
  ) : null;
  const slides = !disabled && (onSwipeRight !== undefined || (leftActions?.length ?? 0) > 0);

  /** The row itself. `suppress` answers true when the gesture that just ended was a drag and not a tap. */
  const row = (suppress: () => boolean = () => false, named: string | null = testId ?? null) => {
    const name = named ?? undefined;
    if (to) {
      return (
        /*
         * A link has no `disabled` of its own. `aria-disabled` says so out loud, `tabIndex={-1}` takes it out of the
         * tab order, and the click is refused — the three things `disabled` does to a button, done by hand.
         */
        <Link
          to={to}
          params={params}
          search={search}
          aria-label={label}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : undefined}
          data-testid={name}
          className={cx(shell, 'ph-focus-inset')}
          onClick={(event) => {
            if (disabled || suppress()) event.preventDefault();
          }}
        >
          {separator}
          {inner}
        </Link>
      );
    }
    if (onClick) {
      return (
        <button
          type="button"
          onClick={() => {
            if (suppress()) return;
            onClick();
          }}
          disabled={disabled}
          aria-label={label}
          data-testid={name}
          className={cx(shell, 'ph-focus-inset text-left')}
        >
          {separator}
          {inner}
        </button>
      );
    }
    return (
      <div className={shell} data-testid={name} style={{ minHeight: TAP }}>
        {separator}
        {inner}
      </div>
    );
  };

  if (!slides) return row();
  return (
    /*
     * The test id moves out here with the gestures, so a locator scoped to the row reaches the action behind it as
     * well as what is written on the row's face — which is `SwipeRow`'s own reason for carrying one.
     */
    <SwipeRow enabled testId={testId} onSwipeRight={onSwipeRight} rightHint={rightHint} actions={leftActions}>
      {(suppressClick) => row(suppressClick, null)}
    </SwipeRow>
  );
}
