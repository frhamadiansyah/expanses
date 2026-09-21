import type { ReactNode } from 'react';
import { usePhone } from '../../app/use-phone';
import { cx } from '../index';
import { InsetGroup, InsetRow, toneClass } from './InsetList';
import { planRecordTable } from './record-table';
import type { Tone } from './row';

/**
 * The rule that fixes the seven screens that break at 390 px: **a table becomes rows on a phone and stays a
 * table on desktop.**
 *
 * This is not a seventh primitive, it is primitives 1 and 2 with a desktop form. `/review`, `/net-worth/trades`,
 * `/net-worth/loans/$accountId` and `/accounts` are all the same defect — a desktop grid put on a phone, where
 * its columns collide or run off the right edge. And the fix is not to shrink the grid: a phone shows each
 * record as a row with the two figures that matter, and everything else waits on the detail screen behind the
 * chevron.
 *
 * The second half of that sentence is a condition, not a flourish. A table whose records open nothing has no
 * "behind the chevron" — so it is drawn as a table on the phone as well, inside its own sideways scroller, and
 * every column survives. Which of the two a table is, it is **told** by `detail`; it never guesses.
 *
 * Desktop is this product's paid tier, so the table is not a fallback — it is the better of the two, and it
 * keeps every column.
 */

export interface RecordColumn<T> {
  key: string;
  heading: string;
  /** The cell on a wide screen. Every column is drawn here; the phone shows only `title` and `value`. */
  cell: (record: T) => ReactNode;
  /** Figures are right-aligned and tabular; words are not. */
  numeric?: boolean;
}

export interface RecordShape<T> {
  /** The phone's row: what the record is. */
  title: (record: T) => ReactNode;
  subtitle?: (record: T) => ReactNode;
  /** The phone's one figure: the number this record exists to report. */
  value: (record: T) => ReactNode;
  valueTone?: (record: T) => Tone;
  key: (record: T) => string;
  /**
   * The column keys this row already says out loud, in its title, subtitle or value.
   *
   * Only bookkeeping for the phone's rows form — everything not named here is a column the reader reaches by
   * opening the record, which is the claim `detail` has to make good on.
   */
  covers?: readonly string[];
}

/**
 * Whether opening a record leads anywhere — the question that decides the phone's form.
 *
 * `screen` is the ordinary case: a row is a chevron into a detail screen, which holds the columns the row had no
 * width for. `none` says plainly that there is nowhere to go, and the phone then keeps the table rather than
 * dropping columns onto a screen that does not exist.
 */
export type RecordDetail<T> = { kind: 'screen'; open: (record: T) => void } | { kind: 'none' };

export function RecordTable<T>({
  records,
  columns,
  shape,
  detail,
  rowTestId,
  header,
  className,
}: {
  records: readonly T[];
  columns: readonly RecordColumn<T>[];
  shape: RecordShape<T>;
  /** Required, and deliberately so: a table that has not said where its rows lead cannot be drawn safely. */
  detail: RecordDetail<T>;
  /**
   * The `data-testid` each record carries, in either form — so a locator names the record and not the layout.
   * A screen whose rows are tables on a phone has no other stable handle on them.
   */
  rowTestId?: (record: T) => string;
  header?: string;
  className?: string;
}) {
  const phone = usePhone();
  const plan = planRecordTable(columns, { phone, destination: detail.kind === 'screen' ? 'detail' : 'none', onRow: shape.covers });

  if (plan.form === 'rows') {
    return (
      <InsetGroup header={header} className={className}>
        {records.map((record) => (
          <InsetRow
            key={shape.key(record)}
            testId={rowTestId?.(record)}
            title={shape.title(record)}
            subtitle={shape.subtitle?.(record)}
            value={shape.value(record)}
            valueTone={shape.valueTone?.(record) ?? 'ink-2'}
            onClick={detail.kind === 'screen' ? () => detail.open(record) : undefined}
          />
        ))}
      </InsetGroup>
    );
  }

  return (
    <section className={cx('w-full', className)} style={{ marginBottom: 18 }}>
      {header && (
        <div className="px-[4px] pb-[6px]">
          <h2 className="text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{header}</h2>
        </div>
      )}
      {/*
       * The sideways scroll lives here, on the table's own container, and never on the page: the app's layout
       * rule grants a table, a diagram or a block of code exactly this, and grants it to nothing else.
       */}
      <div className="overflow-x-auto bg-[var(--ph-surface)]" style={{ borderRadius: 11 }}>
        <table className={cx('border-collapse text-[14px]', plan.scrolls ? 'w-max min-w-full' : 'w-full')}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cx(
                    'border-b-[0.5px] border-[var(--ph-hair)] px-[13px] py-[10px] text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase',
                    column.numeric ? 'text-right' : 'text-left',
                    plan.scrolls && 'whitespace-nowrap',
                  )}
                >
                  {column.heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={shape.key(record)} data-testid={rowTestId?.(record)} className="border-t-[0.5px] border-[var(--ph-hair)] first:border-t-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'px-[13px] py-[10px] align-middle text-[var(--ph-ink)]',
                      column.numeric ? 'tabular text-right whitespace-nowrap' : 'text-left',
                      plan.scrolls && 'whitespace-nowrap',
                    )}
                  >
                    {column.cell(record)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A figure in a table cell, in the tone the row decided. Exported so a column need not reach for the classes. */
export function Figure({ children, tone = 'ink' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx('tabular', toneClass(tone))}>{children}</span>;
}
