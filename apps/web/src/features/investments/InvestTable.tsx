import { formatMinor } from '@expanses/core';
import { Link, type LinkProps, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { approxLine, Figure } from '../../ui/native';

/**
 * The desktop's table for the Investments screens, drawn as the Debts page draws its own: a surface of kit tokens,
 * headers in the group-header voice, the first cell a real link, and a click anywhere else on the row going to the
 * same place. The phone never sees it — there each record is a row with its chevron (`usePhone`).
 *
 * Why not the kit's `RecordTable` (S4 m6, checked 2026-09-22): it would lose things these screens rely on. Its desktop
 * rows open nothing (no link in the first cell, no row click), its phone rows open through `onClick` rather than real
 * route links, and it has no group footer, trailing figure or table-level test id — Held at's footer, the Investments
 * header's trailing total and the e2e's `*-table` handles all live there. Promoting this table into the kit, with
 * those, is the way to one phone-rows/desktop-table rule.
 */

export interface InvestColumn<T> {
  key: string;
  heading: string;
  cell: (record: T) => ReactNode;
  numeric?: boolean;
}

/**
 * The desktop's top band: the page's figure on the left and its read-only facts beside it, so the tables below
 * take the whole column — the Debts page's side column, turned on its side for a page whose tables are wide.
 */
export function DesktopBand({ figure, facts }: { figure: ReactNode; facts: ReactNode }) {
  return (
    <div className="grid items-start gap-[28px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>{figure}</div>
      <div>{facts}</div>
    </div>
  );
}

export type Destination = { to: LinkProps['to']; params?: LinkProps['params'] };

export function InvestTable<T>({
  header,
  trailing,
  footer,
  records,
  columns,
  title,
  destination,
  rowKey,
  rowTestId,
  testId,
}: {
  header: string;
  trailing?: ReactNode;
  footer?: ReactNode;
  records: readonly T[];
  columns: readonly InvestColumn<T>[];
  /** The first cell: the record's name, drawn as the link. */
  title: (record: T) => ReactNode;
  /** Where a record opens, or null for a record that opens nothing (a trade, read-only). */
  destination: (record: T) => Destination | null;
  rowKey: (record: T) => string;
  rowTestId?: string;
  testId?: string;
}) {
  const navigate = useNavigate();
  const cell = 'border-t-[0.5px] border-[var(--ph-hair)] px-[14px] py-[10px] align-middle';
  const head = 'border-b-[0.5px] border-[var(--ph-hair)] px-[14px] py-[10px] text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase';
  return (
    <section className="w-full" style={{ marginBottom: 18 }}>
      <div className="flex items-baseline justify-between gap-3 px-[4px] pb-[6px]">
        <h2 className="text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{header}</h2>
        {trailing && <span className="tabular shrink-0 text-[11.5px] leading-[14px] font-semibold text-[var(--ph-ink-3)]">{trailing}</span>}
      </div>
      {/* The sideways scroll, if a window is ever too narrow, lives on the table's own container and never the page. */}
      <div className="overflow-x-auto bg-[var(--ph-surface)]" style={{ borderRadius: 11 }}>
        <table className="w-full border-collapse text-[14px]" data-testid={testId}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column.key} scope="col" className={cx(head, column.numeric ? 'text-right' : 'text-left', index === 0 && 'min-w-[150px]')}>
                  {column.heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const to = destination(record);
              return (
                <tr
                  key={rowKey(record)}
                  data-testid={rowTestId}
                  className={cx('[&:first-child>td]:border-t-0', to && 'cursor-pointer hover:bg-[var(--ph-fill)]')}
                  onClick={
                    to
                      ? (event) => {
                          // The name is a real link; a click anywhere else on the row goes to the same place.
                          if ((event.target as HTMLElement).closest('a')) return;
                          void navigate(to);
                        }
                      : undefined
                  }
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cx(cell, column.numeric ? 'tabular text-right whitespace-nowrap text-[var(--ph-ink)]' : 'text-left text-[var(--ph-ink-3)]')}
                    >
                      {index === 0 ? (
                        to ? (
                          <Link {...to} className="ph-focus font-medium text-[var(--ph-ink)]">
                            {title(record)}
                          </Link>
                        ) : (
                          <span className="font-medium text-[var(--ph-ink)]">{title(record)}</span>
                        )
                      ) : null}
                      {column.cell(record)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer && <p className="px-[4px] pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p>}
    </section>
  );
}

/**
 * A figure's "In {base}" cell: itself in the base currency; else the kit's `≈` line at the held rate, or the missing
 * rate named in the warning tone — never a zero.
 */
export function InBase({ minor, currency, base, rates }: { minor: number; currency: string; base: string; rates: Readonly<Record<string, number>> }) {
  if (currency === base) return <Figure>{formatMinor(minor, base)}</Figure>;
  const line = approxLine(minor, currency, base, rates)!;
  return <Figure tone={line.startsWith('≈') ? 'ink' : 'warn'}>{line}</Figure>;
}
