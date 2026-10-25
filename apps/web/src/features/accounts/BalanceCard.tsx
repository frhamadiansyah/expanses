import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { heroFigure, Panel } from '../../ui/native';
import { crossing, type DayBalance } from './balance-series';
import { BalanceSpark } from './BalanceSpark';

export interface BalanceCardProps {
  label: string;
  minor: number;
  currency: string;
  /** A figure added up at rates rather than held: drawn after a quiet ≈. */
  approximate?: boolean;
  caption?: ReactNode;
  /** Oldest first, ending on the figure. Null while it is read, or when it cannot be drawn (a rate missing). */
  series: readonly DayBalance[] | null;
  /** A drawing of the page's own in the line's place, under the same rule: Income's twelve months. */
  chart?: ReactNode;
  ends?: readonly [string, string];
  /** Whether the line is read against nothing: money is, a thing's value is not. */
  throughZero?: boolean;
  testId?: string;
  /** Drawn in the card's top-right corner, level with the label: the round flag of the currency it holds. */
  corner?: ReactNode;
  children?: ReactNode;
}

/**
 * A page's figure as the Accounts tab draws its Balance: the label, the figure, one grey line under it, a dashed rule,
 * and the line the figure is the end of — read a day at a time by touching it. What else a page wants inside the card
 * (an asset's four figures) goes under the line.
 *
 * Shared by an account's page and an asset's, so the two figures are one shape — and by Income, whose year is drawn
 * as twelve bars rather than a line: a page with a drawing of its own hands it over as `chart`, and it takes the
 * line's place under the same dashed rule.
 */
export function BalanceCard({ testId, ...props }: BalanceCardProps) {
  return (
    <Panel testId={testId}>
      <BalanceBody {...props} />
    </Panel>
  );
}

/**
 * What the card holds, without its surface: the card itself draws it on a Panel, and the back of a Wallet card (the
 * account page's flip) draws it on the card's own white. `plot` shortens the line for a surface with less room, and
 * `readable` is on there too: only a small button turns the card back over.
 */
export function BalanceBody({
  label,
  minor,
  currency,
  approximate = false,
  caption,
  series,
  chart,
  ends,
  throughZero = true,
  corner,
  children,
  plot,
  readable = true,
  className,
}: Omit<BalanceCardProps, 'testId'> & { plot?: number; readable?: boolean; className?: string }) {
  const figure = heroFigure(minor, currency);
  return (
    <div className={cx('space-y-3', className)}>
      <div className="relative">
        {corner && <div className="absolute top-0 right-0">{corner}</div>}
        <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">{label}</p>
        {/* One line, whatever the amount is: a figure that wraps reads as two figures where there is one. */}
        <p className={cx('tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]', corner ? 'pr-11' : undefined)} data-testid="card-figure">
          {approximate && <span className="text-[var(--ph-ink-3)]">≈ </span>}
          {figure.text}
        </p>
        {caption && <p className="mt-[2px] text-[13px] leading-[18px] text-[var(--ph-ink-3)]">{caption}</p>}
      </div>
      {chart && <div className="border-t-[1px] border-dashed border-[var(--ph-hair)] pt-3">{chart}</div>}
      {!chart && series && series.length > 1 && (
        <div className="border-t-[1px] border-dashed border-[var(--ph-hair)] pt-3">
          <BalanceSpark series={series} currency={currency} crossing={crossing(series)} readable={readable} ends={ends} throughZero={throughZero} plot={plot} />
        </div>
      )}
      {children}
    </div>
  );
}
