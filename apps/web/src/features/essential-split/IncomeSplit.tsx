import { formatMinor } from '@expanses/core';
import { cx } from '../../ui';
import { SplitBar } from './SplitBar';
import { SPLIT_COLOURS, type SplitView } from './split-view';

/**
 * Cashflow's Income page 2: where the period's income went. Essential and Lifestyle filter the list below, as a ring
 * slice does — the picked row stays, the others fade, and the same row again lets go. The guide line opens the guide.
 */
export function IncomeSplit({
  view,
  currency,
  active,
  onPick,
  onGuide,
}: {
  view: SplitView | null;
  currency: string;
  active?: 'essential' | 'lifestyle';
  onPick: (need: 'essential' | 'lifestyle' | undefined) => void;
  onGuide: () => void;
}) {
  if (!view) return <div className="aspect-[400/290] w-full" />;
  const faded = (key: string) => active !== undefined && key !== active;
  return (
    // The card around it answers Enter and Space by folding its list; a row's own keys stay the row's.
    <div className="flex aspect-[400/290] w-full flex-col justify-center px-1" data-testid="income-split" onKeyDown={(event) => event.stopPropagation()}>
      <p className="mb-[10px] text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]" data-testid="income-split-headline">
        Where {formatMinor(view.incomeMinor, currency)} went
      </p>
      {view.bar && <SplitBar parts={view.bar} marks={view.marks} faded={faded} />}
      <div className="divide-y divide-[var(--ph-hair)]">
        {view.rows.map((row) => {
          const inner = (
            <>
              <span aria-hidden className="h-[11px] w-[11px] shrink-0 rounded-[3px]" style={{ background: SPLIT_COLOURS[row.key] }} />
              <span className="min-w-0 flex-1 truncate text-left">
                {row.label}
                {row.percent !== null && <span className="ml-[6px] text-[13px] text-[var(--ph-ink-3)]">{row.percent}</span>}
              </span>
              <span className={cx('tabular shrink-0', row.warn ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink)]')}>{formatMinor(row.amountMinor, currency)}</span>
            </>
          );
          const rowClass = cx('flex min-h-[38px] w-full items-center gap-[10px] py-[7px] text-[15px] leading-[20px] whitespace-nowrap transition-opacity', faded(row.key) && 'opacity-40');
          return row.filters ? (
            <button
              key={row.key}
              type="button"
              className={cx(rowClass, 'ph-focus cursor-pointer')}
              aria-pressed={active === row.key}
              data-testid={`split-row-${row.key}`}
              onClick={() => onPick(active === row.key ? undefined : (row.key as 'essential' | 'lifestyle'))}
            >
              {inner}
            </button>
          ) : (
            <div key={row.key} className={rowClass} data-testid={`split-row-${row.key}`}>
              {inner}
            </div>
          );
        })}
      </div>
      {view.overspentMinor > 0 && (
        <p className="mt-[2px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]" data-testid="split-overspent">
          Spent {formatMinor(view.overspentMinor, currency)} more than earned
        </p>
      )}
      <button type="button" className="ph-focus mt-[4px] self-start text-left text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="split-guide" onClick={onGuide}>
        Guide: {view.guide}
      </button>
    </div>
  );
}
