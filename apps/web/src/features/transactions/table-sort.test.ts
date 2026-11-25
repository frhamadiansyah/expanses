import { describe, expect, it } from 'vitest';
import { cashflowFigure, orderNote, sortDesk } from './cashflow-desk-model';
import type { ListRow } from './list-model';

/*
 * Mac Cashflow's column names sort the table by any of its columns (owner 2026-11-25), and what each row adds to the
 * sum of picked Amount cells and the Total under the table. Invented rows.
 */

const row = (id: string, over: Partial<ListRow> = {}) =>
  ({ id, kind: 'tx', date: '2026-09-03', description: '', amountMinor: 1, currency: 'IDR', categoryName: null, accountLabel: '', spentMinor: 0, earnedMinor: 0, deleted: false, excluded: false, type: 'expense', tx: { createdAt: id, dayOrder: null }, ...over }) as unknown as ListRow;

describe('a column’s name sorts the table', () => {
  const rows = [
    row('a', { description: 'grabride', categoryName: 'Ride hailing', accountLabel: 'BCA debit', date: '2026-09-09' }),
    row('b', { description: 'GrabFood', categoryName: 'Takeaways', accountLabel: 'GoPay', date: '2026-09-05' }),
    row('c', { description: '', categoryName: null, accountLabel: '', date: '2026-09-01' }),
    row('d', { description: 'Apotek', categoryName: 'Health', accountLabel: 'BCA debit', date: '2026-09-02' }),
  ];
  const ids = (sorted: ListRow[]) => sorted.map((one) => one.id);

  it('by Note A→Z or Z→A, any case, a blank note at the bottom either way', () => {
    expect(ids(sortDesk(rows, { key: 'description', dir: 'asc' }))).toEqual(['d', 'b', 'a', 'c']);
    expect(ids(sortDesk(rows, { key: 'description', dir: 'desc' }))).toEqual(['a', 'b', 'd', 'c']);
  });

  it('by Category’s name, and by what paid, a tie read oldest first', () => {
    expect(ids(sortDesk(rows, { key: 'category', dir: 'asc' }))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(sortDesk(rows, { key: 'paid', dir: 'asc' }))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(sortDesk(rows, { key: 'paid', dir: 'desc' }))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('says the order in the box header', () => {
    expect(orderNote({ key: 'description', dir: 'asc' })).toBe('Note A→Z · new rows at the bottom');
    expect(orderNote({ key: 'paid', dir: 'desc' })).toBe('Paid with Z→A · new rows at the bottom');
  });
});

describe('what a row adds up to', () => {
  it('a recorded row: its spending less its money in, in the workspace’s currency', () => {
    expect(cashflowFigure(row('a', { amountMinor: 50_000, spentMinor: 50_000 }), 'IDR')).toEqual({ minor: 50_000, currency: 'IDR' });
    expect(cashflowFigure(row('a', { type: 'income', amountMinor: 70_000, earnedMinor: 70_000 }), 'IDR')).toEqual({ minor: -70_000, currency: 'IDR' });
    // Paid abroad: the workspace's figure, so the sum stays in one currency.
    expect(cashflowFigure(row('a', { amountMinor: 1_000, currency: 'USD', spentMinor: 160_000 }), 'IDR')).toEqual({ minor: 160_000, currency: 'IDR' });
  });

  it('a grey row counts nothing: deleted, or a not-monthly bill left out of the month', () => {
    expect(cashflowFigure(row('a', { amountMinor: 50_000, spentMinor: 50_000, deleted: true }), 'IDR').minor).toBe(0);
    expect(cashflowFigure(row('a', { amountMinor: 50_000, spentMinor: 0, notMonthlyOut: true }), 'IDR').minor).toBe(0);
  });

  it('a row not recorded yet: its own figure, in its own currency', () => {
    const draft = row('w', { kind: 'draft', amountMinor: 41_500, currency: 'IDR', draft: { amountMinor: 41_500, currency: 'IDR' } as ListRow['draft'] });
    expect(cashflowFigure(draft, 'IDR')).toEqual({ minor: 41_500, currency: 'IDR' });
  });
});
