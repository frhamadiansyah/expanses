import { formatMinor, type TrendBar, type TrendUnit } from '@expanses/core';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { compactMoney } from '../../app/sidebar-model';
import { cx } from '../../ui';
import { dayBarsShape, type LegendItem, type MonthFigures, ringArcs } from './cashflow-desk-model';

/*
 * The three boxes along the top of the wide screen's Cashflow (Mac Cashflow D): the ring with its categories, the
 * period's bars, and this month's four figures. Drawn from figures handed in — each read the way the phone reads the
 * same thing — so they hold no queries of their own and are tested as markup.
 */

export const BOX = 'rounded-[18px] bg-[var(--mk-card)] shadow-[var(--mk-card-shadow)]';
export const NOTE = 'text-[12.5px] font-normal text-[var(--mk-ink-2)]';

/** A box's header: its title, and a grey note on the right. */
export function BoxHead({ title, note }: { title: ReactNode; note?: ReactNode }) {
  return (
    <h2 className="flex items-baseline justify-between gap-[10px] px-[14px] pt-[14px] pb-[8px] text-[15px] font-bold text-[var(--mk-ink-2)]">
      <span className="min-w-0 truncate">{title}</span>
      {note && <span className={cx(NOTE, 'shrink-0')}>{note}</span>}
    </h2>
  );
}

/**
 * The ring's, the bars' and This month's own header in the Mac v1 kit (`CARD_HEAD`'s look: 20px sides, an icon before
 * the title). `BoxHead` above stays as it is for the other desk pages that still use it.
 */
function KitHead({ title, note, icon: Icon }: { title: ReactNode; note?: ReactNode; icon?: LucideIcon }) {
  return (
    <h2 className="flex items-center gap-[9px] px-[20px] pt-[16px] pb-[10px] text-[15.5px] font-bold text-[var(--mk-ink-2)]">
      {Icon && <Icon size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />}
      <span className="min-w-0 truncate">{title}</span>
      {note && <span className={cx(NOTE, 'ml-auto shrink-0')}>{note}</span>}
    </h2>
  );
}

const R = 52;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Spending (or income) by category: the ring and, beside it, its largest categories with their shares. A category is a
 * button that filters the table to it (its children included); the one picked reads pressed, and a second click lets go.
 */
export function RingBox({
  kind,
  items,
  totalMinor,
  currency,
  picked,
  onPick,
  icon,
  ready,
  period,
  footnote,
  title,
  testId = 'cashflow-ring',
  headIcon,
}: {
  /** The header's icon (the kit's card look). */
  headIcon?: LucideIcon;
  /** The box's own title, when it is not Cashflow's ("Spent by category" on an event). */
  title?: string;
  testId?: string;
  /** The period, named: "November 2026". */
  period: string;
  /** A grey line under the ring: "1 not in the ring" (`notMonthlyNote`). */
  footnote?: string | null;
  kind: 'expense' | 'income';
  items: readonly LegendItem[];
  /** The middle's figure: the period's whole total, as the phone's ring writes it. */
  totalMinor: number;
  currency: string;
  /** The category the table is filtered to, or ''. */
  picked: string;
  onPick: (categoryId: string) => void;
  /** The app's own category mark, drawn small. */
  icon: (categoryId: string) => ReactNode;
  ready: boolean;
}) {
  const arcs = ringArcs(items, CIRCUMFERENCE);
  const word = kind === 'expense' ? 'Spent' : 'Received';
  const named = title ?? (kind === 'expense' ? 'Spending by category' : 'Income by category');
  return (
    <section className={BOX} aria-label={named} data-testid={testId}>
      <KitHead title={named} icon={headIcon} note={items.some((item) => item.categoryId) ? 'click to filter' : undefined} />
      {/* What the ring adds up to, read aloud and by the journeys, as the phone's chart keeps it. */}
      <div data-testid="period-total" className="sr-only">
        {formatMinor(totalMinor, currency)}
      </div>
      <div className="flex items-center gap-4 px-[20px] pt-[2px] pb-[16px]">
        <svg width="118" height="118" viewBox="0 0 140 140" className="shrink-0" role="img" aria-label={`${word} ${formatMinor(totalMinor, currency)}`}>
          <circle r={R} cx="70" cy="70" fill="none" stroke="var(--ph-track)" strokeWidth="16" />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              r={R}
              cx="70"
              cy="70"
              fill="none"
              stroke={arc.colour}
              strokeWidth="16"
              strokeDasharray={`${arc.dash} ${CIRCUMFERENCE}`}
              strokeDashoffset={arc.offset}
              transform="rotate(-90 70 70)"
              opacity={picked && items.find((item) => item.key === arc.key)?.categoryId !== picked ? 0.35 : 1}
            />
          ))}
          <text x="70" y="64" textAnchor="middle" fontSize="10" fill="var(--ph-ink-3)">
            {word}
          </text>
          <text x="70" y="82" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ph-ink)">
            {compactMoney(totalMinor, currency)}
          </text>
        </svg>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px] text-[12px]">
          {ready && items.length === 0 && <p className="text-[12.5px] text-[var(--ph-ink-3)]">Nothing recorded for {period}.</p>}
          {items.map((item) => {
            const inside = (
              <>
                <span className="flex min-w-0 items-center gap-[6px]">
                  {item.categoryId ? icon(item.categoryId) : <i aria-hidden className="mx-[4px] block h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: item.colour }} />}
                  <span className="min-w-0 truncate text-[var(--ph-ink)]">{item.name}</span>
                  {/* The figure behind the share, said rather than drawn: the box has room for the share alone. */}
                  <span className="sr-only">, {formatMinor(item.minor, currency)}</span>
                </span>
                <span className="shrink-0 text-[var(--ph-ink-3)] tabular-nums">{item.percent}%</span>
              </>
            );
            const row = 'flex w-full items-center justify-between gap-3 rounded-[6px] px-[4px] py-[1px] text-left';
            return item.categoryId ? (
              <button
                key={item.key}
                type="button"
                data-testid="report-row"
                aria-pressed={picked === item.categoryId}
                title={picked === item.categoryId ? 'Show every category' : `Only ${item.name}`}
                onClick={() => onPick(item.categoryId!)}
                className={cx(row, 'hover:bg-[var(--ph-fill)]', picked === item.categoryId && 'bg-[var(--ph-fill)] font-semibold')}
              >
                {inside}
              </button>
            ) : (
              <div key={item.key} data-testid="report-row" className={row}>
                {inside}
              </div>
            );
          })}
        </div>
      </div>
      {footnote && (
        <p data-testid="not-monthly-note" className="-mt-[6px] px-[20px] pb-[12px] text-right text-[11.5px] text-[var(--ph-ink-3)]">
          {footnote}
        </p>
      )}
    </section>
  );
}

const UNIT_WORD: Record<TrendUnit, string> = { day: 'day', week: 'week', month: 'month', year: 'year' };

/**
 * What went out (or came in) each day of the period: the phone's bars page, read through the same days. A day still
 * to come has no bar, and a dashed line marks today.
 */
export function DailyBox({
  kind,
  bars,
  unit,
  currency,
  today,
  note,
  icon,
}: {
  icon?: LucideIcon;
  kind: 'expense' | 'income';
  bars: readonly TrendBar[] | null;
  unit: TrendUnit;
  currency: string;
  today: string;
  /** The period, said on the right: "November". */
  note: string;
}) {
  const { peakMinor, todayIndex } = dayBarsShape(bars ?? [], today);
  const count = Math.max(1, bars?.length ?? 1);
  const title = `${kind === 'expense' ? 'Spent' : 'Received'} each ${UNIT_WORD[unit]}`;
  // A marker past the last bar would only point at nothing: today stands inside the period or not at all.
  const showToday = bars !== null && todayIndex >= 0 && todayIndex < count - 1;
  const first = bars?.[0];
  const last = bars?.[bars.length - 1];
  return (
    <section className={BOX} aria-label={title} data-testid="cashflow-days">
      <KitHead title={title} note={note} icon={icon} />
      <div className="px-[20px] pt-[6px] pb-[16px]">
        <div className="relative h-[110px] border-b border-[var(--ph-hair)]">
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {(bars ?? []).map((bar) => {
              const minor = bar.totalMinor ?? 0;
              const height = peakMinor > 0 ? Math.max(minor > 0 ? 2 : 0, (minor / peakMinor) * 100) : 0;
              return (
                <span key={bar.from} className="flex h-full min-w-0 flex-1 items-end" title={bar.totalMinor === null ? undefined : `${bar.label}: ${formatMinor(minor, currency)}`}>
                  {bar.totalMinor !== null && height > 0 && <i className="block w-full rounded-t-[1.5px] bg-[var(--ph-up)]" style={{ height: `${height}%` }} />}
                </span>
              );
            })}
          </div>
          {showToday && (
            <span
              aria-hidden
              data-testid="days-today"
              className="absolute top-0 bottom-0 border-l border-dashed border-[var(--ph-ink)]"
              style={{ left: `${((todayIndex + 1) / count) * 100}%` }}
            />
          )}
        </div>
        <div className="relative mt-[3px] h-[14px] text-[10px] text-[var(--ph-ink-3)]">
          {first && <span className="absolute left-0">{unit === 'day' ? dayMonthOf(first.from) : first.tick}</span>}
          {showToday && (
            <span className="absolute -translate-x-1/2 text-[var(--ph-ink)]" style={{ left: `${((todayIndex + 1) / count) * 100}%` }}>
              Today
            </span>
          )}
          {last && last !== first && <span className="absolute right-0">{unit === 'day' ? dayMonthOf(last.from) : last.tick}</span>}
        </div>
      </div>
    </section>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonthOf = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** The month's four figures, the phone's own: what went out, what came in, what is left, and what waits for review. */
export function MonthBox({ title, figures, currency, review, icon }: { title: string; figures: MonthFigures; currency: string; review: (count: number) => ReactNode; icon?: LucideIcon }) {
  const money = (minor: number | null) => (minor === null ? '–' : formatMinor(minor, currency));
  const line = (label: string, value: ReactNode, tone?: string, testId?: string) => (
    <div className="mx-[20px] flex items-center border-t border-[var(--ph-hair)] py-[9px] text-[13.5px] first-of-type:border-t-0">
      <span className="flex-1 text-[var(--ph-ink)]">{label}</span>
      <span data-testid={testId} className={cx('tabular-nums', tone ?? 'text-[var(--ph-ink)]')}>
        {value}
      </span>
    </div>
  );
  return (
    <section className={BOX} aria-label={title} data-testid="cashflow-month">
      <KitHead title={title} icon={icon} />
      <div className="pb-[8px]">
        {line('Spent', money(figures.spentMinor), undefined, 'month-spent')}
        {line('Received', money(figures.receivedMinor), 'text-[var(--ph-up)]', 'month-received')}
        {line('Left', money(figures.leftMinor), figures.leftMinor !== null && figures.leftMinor < 0 ? 'text-[var(--ph-alarm)]' : undefined, 'month-left')}
        {line('To review', review(figures.toReview), undefined, 'month-review')}
      </div>
    </section>
  );
}
