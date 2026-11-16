import { addMonths, isoDate, MONTH_START_LAST, monthName, monthPeriodDates, type MonthStartDay, periodMonthOf } from '@expanses/core';
import { BookError, phonesBehindMonthStart, setBookMonthStart } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { useSharedBooks } from '../sharing/queries';
import { useBooks } from './queries';

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** "November is 25 Oct – 24 Nov": the workspace's month that holds today, by its dates. */
export function monthStartFooter(day: MonthStartDay, today: string = isoDate()): string {
  const month = periodMonthOf(today, day);
  return `${monthName(month, 'long')} is ${monthPeriodDates(month, day)}. Cashflow, Budget, bills and reports all use it.`;
}

/** This month and the next, by their dates: what a choice would make of them. */
export function monthStartLines(day: MonthStartDay, today: string = isoDate()): string[] {
  const month = periodMonthOf(today, day);
  return [month, addMonths(month, 1)].map((each) => `${monthName(each, 'long')} = ${monthPeriodDates(each, day)}`);
}

/** Days 1 to 28 in weeks of seven, and "Last day of the month" across the foot. */
function DayGrid({ value, disabled, onPick }: GroupChild & { value: MonthStartDay; disabled: boolean; onPick: (day: MonthStartDay) => void }) {
  const cell = (on: boolean) =>
    cx(
      'ph-focus min-h-[36px] rounded-[8px] text-center text-[15px] leading-[20px] tabular',
      on ? 'bg-[var(--ph-tint)] font-semibold text-white' : 'text-[var(--ph-ink)]',
      disabled && 'opacity-40',
    );
  return (
    <div className="grid grid-cols-7 gap-[6px] p-[12px]" role="radiogroup" aria-label="Month starts on" data-testid="month-start-grid">
      {DAYS.map((day) => (
        <button key={day} type="button" role="radio" aria-checked={value === day} disabled={disabled} className={cell(value === day)} onClick={() => onPick(day)} data-testid={`month-start-${day}`}>
          {day}
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={value === MONTH_START_LAST}
        disabled={disabled}
        className={cx(cell(value === MONTH_START_LAST), 'col-span-7', value === MONTH_START_LAST ? '' : 'bg-[var(--ph-fill)]')}
        onClick={() => onPick(MONTH_START_LAST)}
        data-testid="month-start-last"
      >
        Last day of the month
      </button>
    </div>
  );
}

/**
 * Account › a workspace › Month starts on: the day its months begin, for a salary paid on the 25th. A tap keeps it at
 * once. It regroups and never edits: no transaction, bill, statement or loan changes. In a shared workspace it is the
 * workspace's own, so every phone in it counts the same months; a phone on an older build is named until it updates.
 */
export function MonthStartPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/month-start' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const books = useBooks();
  const book = (books.data ?? []).find((each) => each.id === bookId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // A workspace left and kept as it was reads only.
  const readOnly = (useSharedBooks().data ?? []).some((each) => each.bookId === bookId && each.state === 'unshared');
  const behind = useQuery({ queryKey: ['month-start-behind', bookId], queryFn: () => phonesBehindMonthStart(database, bookId) });

  if (!book) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Month starts on" back="Account" backTo="/account" />
        {books.isSuccess && (
          <InsetGroup wide>
            <InsetRow title="That workspace is not here." chevron={false} />
          </InsetGroup>
        )}
      </div>
    );
  }

  const pick = async (day: MonthStartDay) => {
    if (busy || day === book.monthStartDay) return;
    setBusy(true);
    setError(null);
    try {
      await setBookMonthStart(database, ws, book.id, day);
      await invalidate();
    } catch (caught) {
      setError(caught instanceof BookError ? new Error(caught.message) : caught);
    } finally {
      setBusy(false);
    }
  };

  const names = behind.data ?? [];
  return (
    <div className={SCREEN}>
      <PushedTitle title="Month starts on" back={book.name} backTo="/account/workspaces/$bookId" backParams={{ bookId: book.id }} />
      <div className="pt-[2px]">
        <ErrorBox error={error} />
        <InsetGroup
          wide
          footer={
            <span data-testid="month-start-lines">
              {monthStartLines(book.monthStartDay).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              <span className="block">“1” = the calendar month, as today.</span>
              {names.length > 0 && (
                <span className="mt-[6px] block" data-testid="month-start-behind">
                  {names.join(', ')} {names.length === 1 ? 'counts' : 'count'} calendar months until updated.
                </span>
              )}
            </span>
          }
        >
          <DayGrid value={book.monthStartDay} disabled={busy || readOnly} onPick={(day) => void pick(day)} />
        </InsetGroup>
      </div>
    </div>
  );
}
