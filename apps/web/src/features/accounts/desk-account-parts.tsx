import { formatMinor, monthName } from '@expanses/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, type LucideIcon, Settings } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { CARD_W, cardHeightFor, type WalletCard, WalletFace } from '../../ui/native';
import { CARD, CARD_HEAD, CARD_NOTE, DeskBar, DeskTitle, PILL, PILL_BLUE, PILL_ROUND } from '../../ui/desk';

/*
 * The parts the Mac account pages share (a bank, cash or e-wallet account's, and a credit card's), in the v1 look (owner
 * 2026-11-23; docs/mockups/2026-11-21-mac-redesign-sidebar.html, screen 12): the title bar's pills and its ‹ › stepper, a
 * soft card with its heading, a figure row, the big face as Wallet draws it, the six months' line, and the table's cells.
 */

/** A plain button of the title bar, as Mac Wallet's. */
export const GBTN = PILL;
/** The title bar's one blue button. */
export const PBTN = PILL_BLUE;
const GEAR = PILL_ROUND;

/** The page's own title bar (`desk-titlebar`, so the Mac app's title strip never covers it): the name and its line, then the controls. */
export function DeskTitleBar({
  title,
  line,
  barRef,
  back,
  children,
}: {
  title: string;
  line?: string;
  barRef?: (node: HTMLElement | null) => void;
  /** The page this one belongs to (a pocket's account): ‹ and its name, before the title. */
  back?: { label: string; to: LinkProps['to']; params: LinkProps['params'] };
  children: ReactNode;
}) {
  return (
    <DeskBar crumb={title} back={back} barRef={barRef}>
      {children}
    </DeskBar>
  );
}

/** The account's or card's large title, with its line ("Credit card · ···· 4417") under it, below the notices. */
export function DeskPageTitle({ title, line }: { title: string; line?: string }) {
  return <DeskTitle title={title} line={line} />;
}

/**
 * The ⚙: a real link to the settings page (a new tab, a middle-click), which a plain click opens in the side peek
 * instead when `onPeek` is given.
 */
export function GearLink({ to, params, onPeek, pressed }: { to: LinkProps['to']; params: LinkProps['params']; onPeek?: () => void; pressed?: boolean }) {
  return (
    <Link
      to={to}
      params={params}
      aria-label="Settings"
      title="Settings"
      aria-expanded={onPeek ? pressed : undefined}
      className={cx(GEAR, pressed && 'bg-[var(--mk-pill-hover)]')}
      onClick={(event: MouseEvent) => {
        if (!onPeek || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onPeek();
      }}
    >
      <Settings size={15} aria-hidden />
    </Link>
  );
}

/** A soft card of the page: an icon, its heading, and a grey note (or a link) on the right. */
export function DeskBox({ title, icon: Icon, note, testId, className, children }: { title: ReactNode; icon?: LucideIcon; note?: ReactNode; testId?: string; className?: string; children: ReactNode }) {
  return (
    <section className={cx(CARD, 'min-w-0 overflow-hidden pb-[12px]', className)} data-testid={testId} aria-label={typeof title === 'string' ? title : undefined}>
      <h2 className={CARD_HEAD}>
        {Icon && <Icon size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />}
        <span className="min-w-0 truncate">{title}</span>
        {note !== undefined && note !== null && <span className={cx(CARD_NOTE, 'shrink-0')}>{note}</span>}
      </h2>
      {children}
    </section>
  );
}

/** One figure of a card: what it is in grey on the left, the figure on the right, a hairline between rows (v1's). */
export function FigureRow({ label, value, tone, testId, strong }: { label: ReactNode; value: ReactNode; tone?: 'up' | 'grey' | 'warn' | 'alarm'; testId?: string; strong?: boolean }) {
  return (
    <div data-testid={testId} className="mx-[20px] flex items-baseline justify-between gap-3 border-t border-[var(--mk-line)] py-[7px] text-[13.5px] first-of-type:border-t-0">
      <span className="min-w-0 truncate text-[var(--mk-ink-2)]">{label}</span>
      <span
        className={cx(
          'shrink-0 text-right whitespace-nowrap tabular-nums',
          strong ? 'font-extrabold' : 'font-semibold',
          tone === undefined && 'text-[var(--mk-ink)]',
          tone === 'up' && 'text-[var(--mk-t-green)]',
          tone === 'grey' && 'text-[var(--mk-ink-2)]',
          tone === 'warn' && 'text-[var(--mk-t-orange)]',
          tone === 'alarm' && 'text-[var(--mk-t-red)]',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** How wide the face is drawn: v1's 300px column. */
export const FACE_W = 300;

/** The account's or the card's own face, as Wallet draws it (the iPhone's art), at the column's size. */
export function DeskFace({ card, width = FACE_W }: { card: WalletCard; width?: number }) {
  const scale = width / CARD_W;
  return (
    <div
      data-testid="desk-face"
      aria-hidden
      className="relative shrink-0 overflow-hidden"
      style={{
        width,
        height: cardHeightFor(width),
        borderRadius: Math.round(14.4 * scale),
        boxShadow: '0 1px 3px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.12)',
      }}
    >
      <WalletFace card={card} band={false} scale={scale} figure={false} />
    </div>
  );
}

/**
 * v1's "‹ 29 Oct – 28 Nov ›" or "‹ November 2026 ›" in the title bar: one grey pill, what is on show between its two
 * arrows. Each arrow is a real button with its own name, and the later one rests while the newest is on show.
 */
export function StepPill({
  label,
  earlier,
  later,
  onStep,
  laterOff,
  testId,
}: {
  label: ReactNode;
  /** The arrows' names: "Earlier month", "Later month". */
  earlier: string;
  later: string;
  onStep: (by: -1 | 1) => void;
  laterOff?: boolean;
  testId?: string;
}) {
  const arrow =
    'flex h-[28px] w-[24px] items-center justify-center rounded-full text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--mk-blue)] disabled:pointer-events-none disabled:opacity-30';
  return (
    <div className="inline-flex h-[34px] shrink-0 items-center rounded-full bg-[var(--mk-pill)] px-[4px] text-[13.5px] font-semibold text-[var(--mk-ink)]">
      <button type="button" aria-label={earlier} title={earlier} onClick={() => onStep(-1)} className={arrow}>
        <ChevronLeft size={15} strokeWidth={2.4} aria-hidden />
      </button>
      <span data-testid={testId} className="min-w-[96px] px-[2px] text-center whitespace-nowrap tabular-nums">
        {label}
      </span>
      <button type="button" aria-label={later} title={later} disabled={laterOff} onClick={() => onStep(1)} className={arrow}>
        <ChevronRight size={15} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}

/** `+Rp 1.000` for money in, `−Rp 1.000` for money out, as Mac tables write a signed figure. */
export function signedMoney(minor: number, currency: string): string {
  return minor > 0 ? `+${formatMinor(minor, currency)}` : minor < 0 ? `−${formatMinor(-minor, currency)}` : formatMinor(0, currency);
}

/** A box's own width, followed as it changes (the peek opening, the window resized). */
function useWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = (node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.current.observe(node);
  };
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}

/**
 * The balance at the end of each of the last six months, as one ink line with a dot on each month and the month's
 * initials under it; a hover names the month and its balance. A line under nothing dips below the dashed zero.
 */
export function MonthsLine({ points, currency, plot = 70 }: { points: readonly { month: string; minor: number }[]; currency: string; plot?: number }) {
  const [box, width] = useWidth();
  const height = plot + 22;
  const pad = { x: 18, top: 8 };
  const values = points.map((point) => point.minor);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const step = points.length > 1 ? (width - pad.x * 2) / (points.length - 1) : 0;
  const x = (index: number) => pad.x + step * index;
  // A flat line (nothing moved in six months) sits in the middle rather than on the floor.
  const y = (minor: number) => (high === low ? pad.top + (plot - pad.top) / 2 : pad.top + (1 - (minor - low) / span) * (plot - pad.top));
  const label = points.map((point) => `${monthName(point.month, 'short')} ${formatMinor(point.minor, currency)}`).join(', ');
  return (
    <div ref={box} className="pb-[8px]" data-testid="balance-months">
      {width > 0 && points.length > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Balance at each month's end: ${label}`} className="block">
          {low < 0 && high > 0 && <line x1={pad.x} x2={width - pad.x} y1={y(0)} y2={y(0)} stroke="var(--ph-chevron)" strokeDasharray="3 3" />}
          <polyline points={points.map((point, index) => `${x(index)},${y(point.minor)}`).join(' ')} fill="none" stroke="var(--ph-ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((point, index) => {
            const last = index === points.length - 1;
            return (
              <g key={point.month}>
                <circle cx={x(index)} cy={y(point.minor)} r={last ? 3.5 : 2.5} fill={last ? 'var(--ph-ink)' : 'var(--ph-surface)'} stroke="var(--ph-ink)" strokeWidth={1.5}>
                  <title>{`${monthName(point.month, 'long')}: ${formatMinor(point.minor, currency)}`}</title>
                </circle>
                <text x={x(index)} y={height - 5} textAnchor="middle" fontSize={10.5} fill="var(--ph-ink-3)">
                  {monthName(point.month, 'short')}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/**
 * v1's top row: the face's 300px column and two cards (300px + 1fr + 1fr) across a Mac window; two columns on a narrower
 * page (the side peek open), the third card across both; one column below that.
 */
export const TOP_GRID = 'grid grid-cols-1 items-stretch gap-[16px] @min-[660px]:grid-cols-2 @min-[1000px]:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)]';
/** The top row's third card: across both columns while there are two. */
export const THIRD_CARD = '@min-[660px]:col-span-2 @min-[1000px]:col-span-1';

/** The figures under the face (Outstanding, Balance). */
export const FIGURES_UNDER_FACE = 'px-[4px] pt-[14px]';
/** The same figures where there is no face to sit under: a soft card of their own. */
export const FIGURES_ALONE = cx(CARD, 'h-full px-[20px] py-[18px]');

/** A table inside a card, v1's: grey semibold heads over a hairline, 13.5px rows parted by hairlines. */
export const TH = 'border-b border-[var(--mk-head-line)] px-[10px] py-[8px] text-left text-[12.5px] font-semibold whitespace-nowrap text-[var(--mk-ink-2)]';
export const TD = 'border-b border-[var(--mk-line)] px-[10px] py-[9px] whitespace-nowrap group-last/row:border-b-0';
/** A table row: a faint hover, and v1's pale blue with rounded ends once it is open in the peek or picked. */
export function rowClass(selected: boolean): string {
  return cx(
    'group/row cursor-default text-[13.5px] select-none text-[var(--mk-ink)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--mk-blue)]',
    selected ? '[&>td]:bg-[var(--mk-sel)] [&>td:first-child]:rounded-l-[10px] [&>td:last-child]:rounded-r-[10px]' : 'hover:[&>td]:bg-[var(--mk-hover)]',
  );
}

/** The page makes room for the side peek at once, so no figure sits under it (`panel-frame`'s, the peek's own width). */
export { PEEK_ROOM } from '../../ui/native/panel-frame';
