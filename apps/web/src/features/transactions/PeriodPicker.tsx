import { addMonths, isoDate, monthOf, parsePeriod, type PeriodKind, weeksOfMonth } from '@expanses/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Button, cx, Field, Input } from '../../ui';

const TABS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
  { kind: 'quarter', label: 'Quarter' },
  { kind: 'year', label: 'Year' },
  { kind: 'all', label: 'All' },
  { kind: 'custom', label: 'Custom' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A choice in one of the grids: dimmed when it lies wholly in the future, filled when it is the one showing. */
function Choice({ on, future, onClick, children, testId }: { on: boolean; future: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      disabled={future}
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={cx('min-h-11 rounded-lg text-sm font-medium', on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800', future && 'opacity-35')}
    >
      {children}
    </button>
  );
}

function Stepper({ label, onPrevious, onNext, nextDisabled }: { label: string; onPrevious: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <button type="button" aria-label="Earlier" onClick={onPrevious} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
        <ChevronLeft size={18} aria-hidden />
      </button>
      <b className="text-sm">{label}</b>
      <button
        type="button"
        aria-label="Later"
        disabled={nextDisabled}
        onClick={onNext}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 disabled:opacity-35"
      >
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Choosing the stretch of time Cashflow shows: a week, a month, a quarter, a year, all of it, or two dates.
 *
 * It opens on the kind already showing, so the common move — another month — is one tap, and any month back
 * is a year's arrow and a tap rather than a run of presses on the chart's arrows.
 */
export function PeriodPicker({ value, years, onPick, onClose }: { value: string; years: readonly number[]; onPick: (value: string) => void; onClose: () => void }) {
  const today = isoDate();
  const current = parsePeriod(value);
  const [kind, setKind] = useState<PeriodKind>(current?.kind ?? 'month');
  // The year a month, quarter or week grid is showing, and the month a week list is showing.
  const [year, setYear] = useState(Number((current?.from ?? today).slice(0, 4)));
  const [weekMonth, setWeekMonth] = useState(monthOf(current?.kind === 'week' ? current.to! : (current?.from ?? today)));
  const [from, setFrom] = useState(current?.kind === 'custom' ? current.from! : `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(current?.kind === 'custom' ? current.to! : today);

  const pick = (next: string) => {
    onPick(next);
    onClose();
  };
  const thisYear = Number(today.slice(0, 4));

  return (
    <Sheet title="Choose a period" onClose={onClose}>
      <div data-testid="period-picker">
        <div role="tablist" className="mb-3 flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={kind === tab.kind}
              onClick={() => setKind(tab.kind)}
              className={cx('min-h-9 flex-1 rounded-md text-xs font-medium', kind === tab.kind ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {kind === 'month' && (
          <>
            <Stepper label={String(year)} onPrevious={() => setYear(year - 1)} onNext={() => setYear(year + 1)} nextDisabled={year >= thisYear} />
            <div className="grid grid-cols-3 gap-2">
              {MONTHS.map((name, index) => {
                const month = `${year}-${String(index + 1).padStart(2, '0')}`;
                return (
                  <Choice key={month} on={month === value} future={month > monthOf(today)} onClick={() => pick(month)}>
                    {name}
                  </Choice>
                );
              })}
            </div>
          </>
        )}

        {kind === 'week' && (
          <>
            <Stepper
              label={`${MONTHS_LONG[Number(weekMonth.slice(5)) - 1]} ${weekMonth.slice(0, 4)}`}
              onPrevious={() => setWeekMonth(addMonths(weekMonth, -1))}
              onNext={() => setWeekMonth(addMonths(weekMonth, 1))}
              nextDisabled={weekMonth >= monthOf(today)}
            />
            <div className="grid gap-1">
              {weeksOfMonth(weekMonth).map((week) => {
                const label = `${Number(week.from!.slice(8))} ${MONTHS[Number(week.from!.slice(5, 7)) - 1]} – ${Number(week.to!.slice(8))} ${MONTHS[Number(week.to!.slice(5, 7)) - 1]}`;
                const on = week.value === value;
                return (
                  <button
                    key={week.value}
                    type="button"
                    disabled={week.from! > today}
                    aria-pressed={on}
                    onClick={() => pick(week.value)}
                    className={cx('flex min-h-11 items-center justify-between rounded-lg px-3 text-sm', on ? 'bg-slate-900 text-white' : 'text-slate-800', week.from! > today && 'opacity-35')}
                  >
                    <span>{label}</span>
                    <span className={cx('text-xs', on ? 'text-white/70' : 'text-slate-500')}>Week {Number(week.value.slice(6))}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {kind === 'quarter' && (
          <>
            <Stepper label={String(year)} onPrevious={() => setYear(year - 1)} onNext={() => setYear(year + 1)} nextDisabled={year >= thisYear} />
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((q) => {
                const quarter = `${year}-Q${q}`;
                const first = parsePeriod(quarter)!.from!;
                return (
                  <Choice key={quarter} on={quarter === value} future={first > today} onClick={() => pick(quarter)}>
                    <span className="block">Q{q}</span>
                    <span className="block text-xs font-normal opacity-70">
                      {MONTHS[(q - 1) * 3]} – {MONTHS[(q - 1) * 3 + 2]}
                    </span>
                  </Choice>
                );
              })}
            </div>
          </>
        )}

        {kind === 'year' && (
          <div className="grid grid-cols-3 gap-2">
            {years.map((y) => (
              <Choice key={y} on={String(y) === value} future={false} onClick={() => pick(String(y))}>
                {y}
              </Choice>
            ))}
          </div>
        )}

        {kind === 'all' && (
          <div className="space-y-3 py-2 text-center">
            <p className="text-sm text-slate-500">Everything, from the first transaction.</p>
            <Button className="w-full" onClick={() => pick('all')}>
              Show all time
            </Button>
          </div>
        )}

        {kind === 'custom' && (
          <div className="space-y-3">
            <Field label="From">
              <Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
            </Field>
            <Button className="w-full" disabled={!parsePeriod(`${from}..${to}`)} onClick={() => pick(`${from}..${to}`)}>
              Show this period
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** The years the picker offers: from the oldest transaction to this one, and at least this one. */
export function yearsSince(oldest: string | null): number[] {
  const thisYear = Number(isoDate().slice(0, 4));
  const first = oldest ? Math.min(Number(oldest.slice(0, 4)), thisYear) : thisYear;
  return Array.from({ length: thisYear - first + 1 }, (_, index) => first + index);
}

