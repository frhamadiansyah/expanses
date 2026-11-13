import { dayMonth, feeDateFromDayMonth, monthName } from '@expanses/core';
import { useId, useState } from 'react';
import { type GroupChild } from '../../ui/native';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native/metrics';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const monthShort = (m: number) => monthName(`2000-${String(m).padStart(2, '0')}`, 'short');

/**
 * "Charged on": a day and a month, no year ("15 Oct"). The value stays a full date, the latest such day on or before
 * `today`, so everything that reads the fee date rolls it forward as it always did. Empty until both are picked.
 */
export function FeeDayMonthRow({ value, today, onChange, position }: GroupChild & { value: string; today: string; onChange: (iso: string) => void }) {
  const id = useId();
  const fromValue = value ? { month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) } : { month: 0, day: 0 };
  // Half a pick (one of the two) is kept here until the other arrives.
  const [partial, setPartial] = useState<{ month: number; day: number } | null>(null);
  const shown = value ? fromValue : (partial ?? fromValue);
  const pick = (next: { month: number; day: number }) => {
    if (next.month === 0 || next.day === 0) {
      setPartial(next);
      onChange('');
      return;
    }
    const iso = feeDateFromDayMonth(next.month, next.day, today);
    // A day the month does not have (31 Apr) is not taken.
    if (iso === undefined) return setPartial(next);
    setPartial(null);
    onChange(iso);
  };
  const text = value ? dayMonth(value) : 'Not set';
  const select = 'absolute inset-y-0 w-1/2 cursor-pointer appearance-none bg-transparent opacity-0';
  return (
    <div className="relative">
      {position?.separator && <div aria-hidden className="absolute top-0 right-0 h-px bg-[var(--ph-track)]" style={{ left: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="shrink-0 text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">Charged on</span>
        <span className="relative flex min-w-0 flex-1 items-center justify-end gap-[6px]">
          <span aria-hidden className={`truncate text-[17px] leading-[22px] md:text-[15px] md:leading-[20px] ${value ? 'text-[var(--ph-ink-2)]' : 'text-[var(--ph-ink-3)]'}`}>
            {text}
          </span>
          <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">{'›'}</span>
          <select id={id} aria-label="Charged on day" value={shown.day} onChange={(e) => pick({ ...shown, day: Number(e.target.value) })} className={`${select} left-0`}>
            <option value={0}>Day</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select aria-label="Charged on month" value={shown.month} onChange={(e) => pick({ ...shown, month: Number(e.target.value) })} className={`${select} right-0`}>
            <option value={0}>Month</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>{monthShort(m)}</option>
            ))}
          </select>
        </span>
      </div>
      {value === '' && partial && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Pick the day and the month.</p>}
    </div>
  );
}
