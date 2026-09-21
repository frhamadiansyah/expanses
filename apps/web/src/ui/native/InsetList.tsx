import { Link, type LinkProps } from '@tanstack/react-router';
import { Children, cloneElement, createContext, isValidElement, type ReactElement, type ReactNode, useContext } from 'react';
import { cx } from '../index';
import { groupHeader, type HeaderProgress, type RowPosition, rowPositions } from './group';
import { GROUP_GAP, GROUP_RADIUS, ROW_PAD_X, ROW_PAD_Y, rowHeight, TAP } from './metrics';
import { iconTint, planRow, type Tone } from './row';

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

/**
 * The header above a group: 11.5px / 600 / 0.06em / uppercase, outside the group, with an optional figure.
 *
 * The uppercase is a drawing, applied by CSS, so what a screen reader announces is the sentence that was
 * written rather than a string of shouted letters.
 */
function GroupHeader({ title, progress, trailing }: { title: string; progress?: HeaderProgress; trailing?: ReactNode }) {
  const header = groupHeader(title, progress);
  return (
    <div className="flex items-baseline justify-between gap-3 px-[4px] pb-[6px]">
      <h2 className="text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{header.label}</h2>
      {(header.trailing ?? trailing) && (
        <span className="tabular shrink-0 text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
          {header.trailing ?? trailing}
        </span>
      )}
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
  wide = false,
  className,
  children,
}: {
  header?: string;
  progress?: HeaderProgress;
  trailing?: ReactNode;
  /** The sentence under a group. It belongs to the group, not to one row. */
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<GroupChild>[];
  const positions = rowPositions(items.length);
  const full = useWide(wide);
  return (
    <section className={cx('w-full', full ? '' : 'md:max-w-2xl', className)} style={{ marginBottom: GROUP_GAP }}>
      {header && <GroupHeader title={header} progress={progress} trailing={trailing} />}
      <div className="overflow-hidden bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
        {items.map((child, index) => cloneElement(child, { position: positions[index] }))}
      </div>
      {footer && <p className="px-[4px] pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p>}
    </section>
  );
}

export interface InsetRowProps extends GroupChild {
  /** A tinted circular icon: a 12 % wash of `colour`, with the glyph in `colour` itself. */
  icon?: ReactNode;
  iconColour?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** The trailing figure. Set in tabular numerals and never truncated — it is what the row is for. */
  value?: ReactNode;
  valueTone?: Tone;
  chevron?: boolean;
  onClick?: () => void;
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
 */
export function InsetRow({
  icon,
  iconColour,
  title,
  subtitle,
  value,
  valueTone = 'ink-3',
  chevron,
  onClick,
  to,
  params,
  search,
  destructive = false,
  disabled = false,
  label,
  testId,
  position,
  className,
}: InsetRowProps) {
  const points = chevron ?? Boolean(onClick ?? to);
  const plan = planRow({ icon: Boolean(icon), title: String(title ?? ''), chevron: points });
  const tint = iconColour ? iconTint(iconColour) : null;

  const body = destructive ? (
    <span className="w-full text-center text-[15px] leading-[20px] font-normal text-[var(--ph-alarm)]">{title}</span>
  ) : (
    <>
      {icon && (
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{ width: 28, height: 28, background: tint?.background ?? 'var(--ph-fill)', color: tint?.foreground ?? 'var(--ph-ink-2)' }}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{title}</span>
        {subtitle && <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{subtitle}</span>}
      </span>
      {value !== undefined && value !== null && (
        <span className={cx('tabular shrink-0 text-[15px] leading-[20px] whitespace-nowrap', TONE[valueTone])}>{value}</span>
      )}
      {points && <Chevron />}
    </>
  );

  const inner = (
    <span
      className="flex w-full items-center"
      style={{
        gap: icon ? 10 : 8,
        minHeight: rowHeight(Boolean(subtitle)),
        padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px`,
      }}
    >
      {body}
    </span>
  );

  const shell = cx('relative block w-full bg-transparent', disabled && 'opacity-40', className);
  const separator = position?.separator ? (
    <span
      aria-hidden
      className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]"
      style={{ height: 0.5, left: destructive ? 0 : plan.separatorInset }}
    />
  ) : null;

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
        data-testid={testId}
        className={cx(shell, 'ph-focus-inset')}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
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
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
        className={cx(shell, 'ph-focus-inset text-left')}
      >
        {separator}
        {inner}
      </button>
    );
  }
  return (
    <div className={shell} data-testid={testId} style={{ minHeight: TAP }}>
      {separator}
      {inner}
    </div>
  );
}
