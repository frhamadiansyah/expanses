import { formatMinor } from '@expanses/core';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx, Money } from '../../ui';

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * A category read as a share of the whole: one line, the share before the name, both figures in columns of their own.
 */
export function ShareLine({
  colour,
  name,
  amountMinor,
  wholeMinor,
  currency,
  chevron = true,
  figure,
}: {
  colour: string;
  name: string;
  amountMinor: number;
  wholeMinor: number;
  currency: string;
  chevron?: boolean;
  /** What stands at the end of the line instead of the plain figure — an event reads it against what was planned. */
  figure?: ReactNode;
}) {
  return (
    <span className="flex w-full items-center gap-2.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour }} aria-hidden />
      <span className="tabular w-9 shrink-0 text-center text-[13px] font-semibold">{share(amountMinor, wholeMinor)}%</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      {figure ?? <Money minor={amountMinor} currency={currency} className="shrink-0 text-sm font-semibold" />}
      {chevron && <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />}
    </span>
  );
}

/**
 * A category read against what was set aside for it: what is left (or how far over) first, then what was spent and
 * the share of the figure set aside, against the two ends of the bar.
 */
export function CapLine({
  colour,
  name,
  amountMinor,
  capMinor,
  currency,
  chevron = true,
  noCap = 'no budget',
}: {
  colour: string;
  name: string;
  amountMinor: number;
  capMinor: number | null | undefined;
  currency: string;
  chevron?: boolean;
  /** What a line with nothing set aside says in the cap's place. */
  noCap?: string;
}) {
  // No cap, no bar: a bar against nothing would only ask what it was measuring.
  const capped = capMinor != null && capMinor > 0;
  const over = capped && amountMinor > capMinor;
  return (
    <>
      <span className="flex w-full items-center gap-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        {capped ? (
          <span className={cx('tabular shrink-0 text-sm', over && 'text-red-700')}>
            <span className="font-semibold">{formatMinor(Math.abs(capMinor - amountMinor), currency)}</span> {over ? 'over' : 'left'}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-slate-500">{noCap}</span>
        )}
        {chevron && <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />}
      </span>
      <span className={cx('tabular mt-1 ml-[22px] flex items-baseline gap-2 text-xs text-slate-500', chevron ? 'mr-7' : 'mr-0')}>
        <span>Spent {formatMinor(amountMinor, currency)}</span>
        {capped && (
          <span className={cx('ml-auto', over && 'font-semibold text-red-700')}>
            {share(amountMinor, capMinor)}% of {formatMinor(capMinor, currency)}
          </span>
        )}
      </span>
      {capped && (
        <span className={cx('mt-2 ml-[22px] block h-1 overflow-hidden rounded-full bg-slate-100', chevron ? 'mr-7' : 'mr-0')}>
          <span className="block h-1 rounded-full" style={{ width: `${Math.min(1, amountMinor / capMinor) * 100}%`, background: over ? '#b91c1c' : colour }} />
        </span>
      )}
    </>
  );
}
