import { formatMinor, monthName } from '@expanses/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronLeft, Settings } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { CARD_W, cardHeightFor, type WalletCard, WalletFace } from '../../ui/native';
import { BOX, NOTE } from '../transactions/CashflowBoxes';

/*
 * The parts the Mac account pages share (a bank, cash or e-wallet account's, and a credit card's): the title bar's
 * buttons, a box with its heading, a figure row, the card's face as Wallet draws it, and the six months' line.
 */

/** A plain button of the title bar, as Mac Wallet's. */
export const GBTN =
  'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)] disabled:opacity-40';
/** The title bar's one black button. */
export const PBTN =
  'inline-flex h-[26px] items-center gap-[3px] rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)] disabled:opacity-40';
const GEAR = 'inline-flex h-[26px] w-[28px] items-center justify-center rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]';
const H2 = 'flex items-baseline justify-between gap-[10px] px-[14px] pt-[11px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]';

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
    <header
      ref={barRef}
      className="desk-titlebar sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]"
    >
      {back && (
        <Link
          to={back.to}
          params={back.params}
          aria-label={back.label}
          className="flex shrink-0 items-center gap-[2px] rounded-[5px] px-[4px] py-[2px] text-[12.5px] text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]"
        >
          <ChevronLeft size={14} aria-hidden />
          <span className="max-w-[180px] truncate">{back.label}</span>
        </Link>
      )}
      <span className="flex min-w-0 shrink items-baseline gap-[8px]">
        <h1 className="truncate text-[15px] font-semibold text-[var(--ph-ink)]">{title}</h1>
        {line && (
          <span data-testid="desk-title-line" className="truncate text-[12px] text-[var(--ph-ink-3)]">
            {line}
          </span>
        )}
      </span>
      <span className="flex-1" />
      {children}
    </header>
  );
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
      className={cx(GEAR, pressed && 'bg-[var(--ph-fill)]')}
      onClick={(event: MouseEvent) => {
        if (!onPeek || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onPeek();
      }}
    >
      <Settings size={14} aria-hidden />
    </Link>
  );
}

/** A box of the page, with its heading and a grey note on the right. */
export function DeskBox({ title, note, testId, className, children }: { title: ReactNode; note?: ReactNode; testId?: string; className?: string; children: ReactNode }) {
  return (
    <section className={cx(BOX, 'min-w-0 overflow-hidden', className)} data-testid={testId} aria-label={typeof title === 'string' ? title : undefined}>
      <h2 className={H2}>
        <span className="min-w-0 truncate">{title}</span>
        {note !== undefined && note !== null && <span className={cx(NOTE, 'shrink-0')}>{note}</span>}
      </h2>
      {children}
    </section>
  );
}

/** One figure of a box: what it is on the left, the figure on the right, under a hairline. */
export function FigureRow({ label, value, tone, testId }: { label: string; value: ReactNode; tone?: 'up' | 'grey' | 'warn' | 'alarm'; testId?: string }) {
  return (
    <div data-testid={testId} className="flex items-baseline justify-between gap-3 border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[13px] text-[var(--ph-ink)]">
      <span className="min-w-0 truncate">{label}</span>
      <span
        className={cx(
          'shrink-0 text-right whitespace-nowrap tabular-nums',
          tone === 'up' && 'text-[var(--ph-up)]',
          tone === 'grey' && 'text-[var(--ph-ink-3)]',
          tone === 'warn' && 'font-medium text-[var(--ph-warn)]',
          tone === 'alarm' && 'font-medium text-[var(--ph-alarm)]',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** How wide the face is drawn in its box. */
export const FACE_W = 168;

/** The account's or the card's own face, as Wallet draws it (the iPhone's art), at the box's size. */
export function DeskFace({ card }: { card: WalletCard }) {
  const scale = FACE_W / CARD_W;
  return (
    <div
      data-testid="desk-face"
      aria-hidden
      className="relative shrink-0 overflow-hidden"
      style={{ width: FACE_W, height: cardHeightFor(FACE_W), borderRadius: Math.round(14.4 * scale), boxShadow: '0 1px 3px rgba(0,0,0,0.18)' }}
    >
      <WalletFace card={card} band={false} scale={scale} figure={false} />
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
export function MonthsLine({ points, currency }: { points: readonly { month: string; minor: number }[]; currency: string }) {
  const [box, width] = useWidth();
  const plot = 70;
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
          <polyline
            points={points.map((point, index) => `${x(index)},${y(point.minor)}`).join(' ')}
            fill="none"
            stroke="var(--ph-ink)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
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

/** The boxes' grid: one column on a narrow page, two (the first box across both) wider, three across a Mac window. */
export const BOX_GRID = 'grid grid-cols-1 items-stretch gap-[14px] @min-[700px]:grid-cols-2 @min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]';
/** The first box of that grid: across both columns while there are two. */
export const FIRST_BOX = '@min-[700px]:col-span-2 @min-[900px]:col-span-1';

/** The page makes room for the side peek at once, so no figure sits under it (the peek is 330 wide; the page keeps its 20). */
export const PEEK_ROOM = 'mr-[322px]';
