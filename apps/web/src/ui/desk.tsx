import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { cx } from './index';

/*
 * The Mac look, v1 (owner approved 2026-11-23; docs/mockups/2026-11-21-mac-redesign-sidebar.html): the parts every Mac
 * page is drawn with. A 58px title bar with the page's name in grey on the left and pill buttons on the right; a large
 * title with a grey line under it; soft grey cards; stat tiles with a round coloured icon; pill switches and tags.
 * Colours are the `--mk-*` tokens (tokens.css), so the dark theme comes with them. A phone never draws any of this.
 */

/** A grey pill button of the title bar (Scan receipt, Edit plan). */
export const PILL =
  'inline-flex h-[34px] shrink-0 items-center justify-center gap-[6px] rounded-full bg-[var(--mk-pill)] px-[15px] text-[13.5px] font-semibold whitespace-nowrap text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mk-blue)] disabled:pointer-events-none disabled:opacity-40';
/** The bar's one blue button (＋ Add). */
export const PILL_BLUE =
  'inline-flex h-[34px] shrink-0 items-center justify-center gap-[5px] rounded-full bg-[var(--mk-blue)] px-[16px] text-[13.5px] font-semibold whitespace-nowrap text-white hover:bg-[var(--mk-blue-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mk-blue)] disabled:pointer-events-none disabled:opacity-40';
/** A round icon button of the bar (search, settings). */
export const PILL_ROUND =
  'inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--mk-pill)] text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mk-blue)] disabled:opacity-40';
/** The black pill inside a card's header (Record 2). */
export const PILL_BLACK =
  'inline-flex h-[30px] shrink-0 items-center justify-center gap-[4px] rounded-full bg-[var(--mk-black)] px-[14px] text-[13px] font-semibold whitespace-nowrap text-[var(--mk-black-ink)] hover:opacity-90 disabled:pointer-events-none disabled:opacity-40';
/** A small grey pill inside a card or a row (Pay, Discard, Link…). */
export const PILL_SMALL =
  'inline-flex h-[26px] shrink-0 items-center justify-center gap-[4px] rounded-full bg-[var(--mk-pill)] px-[11px] text-[12.5px] font-semibold whitespace-nowrap text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] disabled:pointer-events-none disabled:opacity-40';

/** A soft card: the page's every box. */
export const CARD = 'rounded-[18px] bg-[var(--mk-card)] shadow-[var(--mk-card-shadow)]';
/** A card's own heading: grey, bold, an icon before it, a blue link or a grey note at its right. */
export const CARD_HEAD = 'flex items-center gap-[9px] px-[20px] pt-[16px] pb-[10px] text-[15.5px] font-bold text-[var(--mk-ink-2)]';
/** A grey note at a card heading's right. */
export const CARD_NOTE = 'ml-auto min-w-0 truncate text-[12.5px] font-semibold text-[var(--mk-ink-2)]';
/** The page's body under its title: v1's 40px sides. */
export const PAGE_BODY = 'px-[32px] pb-[32px]';

/** The title bar: the page's name (or a breadcrumb, or ‹ back) in grey on the left, its controls on the right. */
export function DeskBar({
  crumb,
  back,
  barRef,
  children,
}: {
  /** The grey words on the left: the page's own name, or "Wallet › BCA KrisFlyer". */
  crumb: ReactNode;
  /** The page this one belongs to: ‹ and its name before the crumb. */
  back?: { label: string; to: LinkProps['to']; params?: LinkProps['params'] };
  barRef?: Ref<HTMLElement>;
  children?: ReactNode;
}) {
  return (
    <header
      ref={barRef}
      data-testid="desk-bar"
      className="desk-titlebar sticky top-0 z-10 flex h-[58px] items-center gap-[10px] bg-[var(--mk-page)] pr-[18px] pl-[24px]"
    >
      {back && (
        <Link
          to={back.to}
          params={back.params}
          aria-label={back.label}
          className="-ml-[6px] flex shrink-0 items-center gap-[1px] rounded-full px-[6px] py-[3px] text-[14px] font-semibold text-[var(--mk-blue)] hover:bg-[var(--mk-pill)]"
        >
          <ChevronLeft size={16} aria-hidden />
          <span className="max-w-[180px] truncate">{back.label}</span>
        </Link>
      )}
      <span data-testid="desk-crumb" className="min-w-0 shrink truncate text-[17px] font-semibold text-[var(--mk-ink-2)]">
        {crumb}
      </span>
      <span className="flex-1" />
      {children}
    </header>
  );
}

/** The page's large title and the grey line under it. */
export function DeskTitle({ title, line, aside, testId }: { title: ReactNode; line?: ReactNode; aside?: ReactNode; testId?: string }) {
  return (
    <div className="flex items-end gap-[16px] px-[32px] pt-[8px] pb-[18px]" data-testid={testId}>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[34px] leading-[41px] font-extrabold tracking-[-0.4px] text-[var(--mk-ink)]">{title}</h1>
        {line !== undefined && line !== null && line !== '' && (
          <p data-testid="desk-title-line" className="mt-[3px] truncate text-[14px] text-[var(--mk-ink-2)]">
            {line}
          </p>
        )}
      </div>
      {aside}
    </div>
  );
}

/** A soft card with its heading: an icon, the title, and a note or link on the right. */
export function Card({
  title,
  icon: Icon,
  note,
  testId,
  label,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  note?: ReactNode;
  testId?: string;
  label?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx(CARD, 'min-w-0', className)} data-testid={testId} aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      {title !== undefined && (
        <h2 className={CARD_HEAD}>
          {Icon && <Icon size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />}
          <span className="min-w-0 truncate">{title}</span>
          {note !== undefined && note !== null && <span className={CARD_NOTE}>{note}</span>}
        </h2>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export type Tone = 'blue' | 'green' | 'red' | 'orange' | 'grey' | 'purple';

/** A coloured tag or badge: a pale ground with its own ink. */
export function Tag({ tone, children, testId, className }: { tone: Tone; children: ReactNode; testId?: string; className?: string }) {
  return (
    <span
      data-testid={testId}
      className={cx('inline-flex shrink-0 items-center rounded-full px-[9px] py-[1px] text-[11.5px] leading-[17px] font-bold whitespace-nowrap', className)}
      style={{ background: `var(--mk-t-${tone}-bg)`, color: `var(--mk-t-${tone})` }}
    >
      {children}
    </span>
  );
}

export type IconColour = 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'teal' | 'pink' | 'indigo' | 'grey' | 'gold';

/** A round coloured icon with a white glyph: a stat tile's mark. */
export function RoundIcon({ icon: Icon, colour, size = 26 }: { icon: LucideIcon; colour: IconColour; size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: `var(--mk-c-${colour})` }}>
      <Icon size={Math.round(size * 0.54)} strokeWidth={2.4} />
    </span>
  );
}

/** One stat tile: a round icon (and a tag at its right), a large figure, what it is. */
export function StatTile({
  icon,
  colour,
  value,
  label,
  badge,
  testId,
  to,
  params,
  search,
  onClick,
  valueTestId,
}: {
  icon: LucideIcon;
  colour: IconColour;
  value: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  testId?: string;
  valueTestId?: string;
  to?: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="flex h-[26px] items-center justify-between gap-2">
        <RoundIcon icon={icon} colour={colour} />
        {badge}
      </span>
      <span data-testid={valueTestId} className="mt-[14px] mb-[3px] block truncate text-[26px] leading-[32px] font-extrabold tracking-[-0.3px] text-[var(--mk-ink)] tabular-nums">
        {value}
      </span>
      <span className="block truncate text-[13px] text-[var(--mk-ink-2)]">{label}</span>
    </>
  );
  const box = cx(CARD, 'block min-w-0 px-[20px] py-[18px] text-left');
  if (to)
    return (
      <Link to={to} params={params} search={search} data-testid={testId} className={cx(box, 'hover:bg-[var(--mk-pill)]')}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} data-testid={testId} className={cx(box, 'hover:bg-[var(--mk-pill)]')}>
        {inner}
      </button>
    );
  return (
    <div data-testid={testId} className={box}>
      {inner}
    </div>
  );
}

/** A row of tiles: four (or three) across, as v1 draws them. */
export function TileRow({ count = 4, children, testId }: { count?: 2 | 3 | 4; children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={cx('mb-[16px] grid gap-[16px]', count === 4 ? 'grid-cols-2 @min-[860px]:grid-cols-4' : count === 3 ? 'grid-cols-1 @min-[700px]:grid-cols-3' : 'grid-cols-2')}
    >
      {children}
    </div>
  );
}

/** A pill switch: the grey track with the chosen segment white. A real radio group for a keyboard and a screen reader. */
export function Seg<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode; testId?: string }[];
  value: T;
  onChange: (value: T) => void;
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className="flex shrink-0 rounded-full bg-[var(--mk-seg)] p-[3px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-testid={option.testId}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-full px-[13px] py-[4px] text-[13px] font-semibold whitespace-nowrap',
            value === option.value ? 'bg-[var(--mk-seg-on)] text-[var(--mk-seg-on-ink)] shadow-[var(--mk-seg-shadow)]' : 'text-[var(--mk-ink-2)] hover:text-[var(--mk-ink)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A thin progress bar on v1's grey track. */
export function Track({ share, colour, className }: { share: number; colour: string; className?: string }) {
  const width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return (
    <span aria-hidden className={cx('block h-[6px] overflow-hidden rounded-[3px] bg-[var(--mk-track)]', className)}>
      <span className="block h-full rounded-[3px]" style={{ width, background: colour }} />
    </span>
  );
}
