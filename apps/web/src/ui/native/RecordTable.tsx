import type { ReactNode } from 'react';
import { usePhone } from '../../app/use-phone';
import { cx } from '../index';
import { InsetGroup, InsetRow, toneClass } from './InsetList';
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
 * Desktop is this product's paid tier, so the table is not a fallback — it is the better of the two, and it
 * keeps every column.
 *
 * **Becoming rows is not unconditional.** A record only collapses to one line if the columns left behind have a
 * detail screen to go to — that is what the chevron promises. Where they have not, losing a column is worse than
 * scrolling one, so the table stays a table on the phone as well, inside the horizontal-scroll container it
 * already has. `shape` is how a caller says there is somewhere to go: given one, the phone shows rows; left out,
 * the table is the answer at every width. The ruling is in the type rather than in a flag, so a screen cannot
 * quietly drop `/review`'s Category column or `/accounts`'s Archive by forgetting to pass something.
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
  /** Where the rest of the columns live on a phone. */
  onOpen?: (record: T) => void;
}

export function RecordTable<T>({
  records,
  columns,
  shape,
  rowKey,
  rowTestId,
  header,
  className,
}: {
  records: readonly T[];
  columns: readonly RecordColumn<T>[];
  /** Given, the phone shows one row a record. Left out, the table stays a table at every width — see above. */
  shape?: RecordShape<T>;
  /** How a record is identified when there is no `shape` to ask. One of the two is always present. */
  rowKey?: (record: T) => string;
  /** The `data-testid` each record carries, in either form, so a test names the record and not the layout. */
  rowTestId?: (record: T) => string;
  header?: string;
  className?: string;
}) {
  const phone = usePhone();
  const keyOf = (record: T, index: number) => shape?.key(record) ?? rowKey?.(record) ?? String(index);

  if (phone && shape) {
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
            onClick={shape.onOpen ? () => shape.onOpen?.(record) : undefined}
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
      <div className="overflow-x-auto bg-[var(--ph-surface)]" style={{ borderRadius: 11 }}>
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cx(
                    'border-b-[0.5px] border-[var(--ph-hair)] px-[13px] py-[10px] text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase',
                    column.numeric ? 'text-right' : 'text-left',
                  )}
                >
                  {column.heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr key={keyOf(record, index)} data-testid={rowTestId?.(record)} className="border-t-[0.5px] border-[var(--ph-hair)] first:border-t-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      'px-[13px] py-[10px] align-middle text-[var(--ph-ink)]',
                      column.numeric ? 'tabular text-right whitespace-nowrap' : 'text-left',
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
