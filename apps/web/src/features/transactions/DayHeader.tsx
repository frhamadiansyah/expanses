import { formatMinor } from '@expanses/core';
import { CalendarX2 } from 'lucide-react';
import { cx } from '../../ui';

/**
 * The head of one day's card: the day's number, its weekday and month, and what the day came to.
 *
 * `net` is income less spending, as the Cashflow list counts it: above zero it is green, below it is the plain
 * total of what went out. Any list drawn by day — Cashflow, Review — heads its cards with this.
 */
export function DayHeader({ date, net, currency }: { date: string; net: number; currency: string }) {
  if (!date) {
    return (
      <div className="-mx-2 flex items-center gap-3 border-b border-slate-200 px-2 pb-2">
        <CalendarX2 size={22} className="text-amber-700" aria-hidden />
        <span className="flex flex-col text-xs leading-tight text-slate-500">
          <b className="font-semibold text-slate-700">No date yet</b>
          Give these a date to file them
        </span>
      </div>
    );
  }
  const d = new Date(`${date}T00:00:00`);
  return (
    <div className="-mx-2 flex items-center gap-3 border-b border-slate-200 px-2 pb-2">
      <span className="tabular w-9 shrink-0 text-2xl leading-none font-semibold">{d.getDate()}</span>
      <span className="flex flex-col text-xs leading-tight text-slate-500">
        <b className="font-semibold text-slate-700">{d.toLocaleDateString('en-GB', { weekday: 'long' })}</b>
        {d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
      </span>
      {/* From md a row ends with room for its edit pencil, so the day's total leaves the same room. */}
      {/* No sign and no red: the day's total sums the rows below it rather than adding anything to them. */}
      {net !== 0 && (
        <span className={cx('tabular ml-auto text-sm font-semibold md:pr-7', net > 0 ? 'text-emerald-700' : 'text-slate-600')}>
          {formatMinor(Math.abs(net), currency)}
        </span>
      )}
    </div>
  );
}
