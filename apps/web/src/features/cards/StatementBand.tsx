import { formatMinor } from '@expanses/core';
import type { CSSProperties } from 'react';
import type { CardStatement } from '@expanses/db';
import { cx } from '../../ui';
import { statementTotals } from './statement-totals';

/** The hatch marks money already paid: it is drawn, but it is no longer owed. */
const HATCH = { backgroundImage: 'repeating-linear-gradient(135deg,#cbd5e1 0 3px,#e8edf3 3px 6px)' };

/**
 * A statement's totals, as one bar the width of the search box above it.
 *
 * The bar carries the whole of the previous bill and everything bought since, so the figures beside it are
 * the ones the bank prints. What has been paid is hatched out, leaving the upcoming bill as the solid part.
 */
export function StatementBand({ statement, currency }: { statement: CardStatement; currency: string }) {
  const t = statementTotals(statement);
  const money = (minor: number) => formatMinor(minor, currency);
  const share = (minor: number) => (t.wholeMinor > 0 ? (minor / t.wholeMinor) * 100 : 0);
  const totalLabel = t.closed ? 'Total bill' : 'Upcoming bill';

  // Each label stands under its own stretch of the bar, but never squeezed so narrow that it runs into the next.
  const first = Math.min(70, Math.max(30, share(t.closed ? t.paidMinor : t.billMinor)));
  const figure = (label: string, owedMinor: number, ofMinor: number | null, width: number, faint = false) => (
    <span className="flex min-w-0 items-baseline justify-between gap-3 pr-2.5 whitespace-nowrap md:block md:w-[var(--w)]" style={{ '--w': `${width}%` } as CSSProperties}>
      <span className="text-[11px] text-slate-500 md:block">{label}</span>
      <span className={cx('tabular text-sm font-semibold', faint ? 'text-slate-500' : 'text-slate-900')}>
        {money(owedMinor)}
        {ofMinor !== null && ofMinor !== owedMinor && <span className="font-normal text-slate-400"> of {money(ofMinor)}</span>}
      </span>
    </span>
  );

  return (
    <div className="mb-3 flex flex-col-reverse overflow-hidden rounded-lg border border-slate-300 bg-white md:flex-row md:items-stretch" data-testid="statement-band">
      <div className="min-w-0 flex-1 px-3.5 py-2.5">
        {t.wholeMinor > 0 && (
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-slate-200"
            role="img"
            aria-label={
              t.closed
                ? `Of ${money(t.billMinor)} billed, ${money(t.paidMinor)} paid and ${money(t.leftMinor)} still to pay`
                : `${money(t.leftMinor)} still to pay of the ${money(t.billMinor)} previous bill, and ${money(t.unbilledLeftMinor)} unbilled`
            }
          >
            <i style={{ width: `${share(t.paidMinor)}%`, ...HATCH }} />
            <i className="border-r border-white bg-slate-400" style={{ width: `${share(t.leftMinor)}%` }} />
            {!t.closed && (
              <>
                <i style={{ width: `${share(t.unbilledMinor - t.unbilledLeftMinor)}%`, ...HATCH }} />
                <i className="bg-slate-900" style={{ width: `${share(t.unbilledLeftMinor)}%` }} />
              </>
            )}
          </div>
        )}
        <div className="mt-2.5 flex flex-col gap-1.5 md:flex-row md:gap-0">
          {t.wholeMinor === 0 ? (
            <span className="text-sm text-slate-500">Nothing billed on this statement.</span>
          ) : t.closed ? (
            <>
              {figure('Paid', t.paidMinor, null, first, true)}
              {figure('Still to pay', t.leftMinor, null, 100 - first)}
            </>
          ) : (
            <>
              {figure('Previous bill', t.leftMinor, t.billMinor, first)}
              {figure('Unbilled', t.unbilledLeftMinor, t.unbilledMinor, 100 - first)}
            </>
          )}
        </div>
      </div>
      <div
        className="flex shrink-0 items-baseline justify-between gap-3 bg-slate-900 px-3.5 py-2.5 md:w-[30%] md:flex-col md:items-end md:justify-center md:gap-0.5"
        data-testid="statement-total"
      >
        <span className="text-[11px] whitespace-nowrap text-slate-400">{totalLabel}</span>
        <span className="tabular text-sm leading-tight font-semibold whitespace-nowrap text-white">{money(t.totalMinor)}</span>
      </div>
    </div>
  );
}
