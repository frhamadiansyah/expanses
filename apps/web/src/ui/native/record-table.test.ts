import { describe, expect, it } from 'vitest';
import { planRecordTable, reachableColumns } from './record-table';

/** `/net-worth/trades`: eight columns, and no screen anywhere in the app that opens a holding. */
const HOLDINGS = [
  { key: 'name' },
  { key: 'held' },
  { key: 'average' },
  { key: 'cost' },
  { key: 'value' },
  { key: 'unrealized' },
  { key: 'realized' },
  { key: 'income' },
];

/** `/net-worth/loans/$accountId`: a schedule line is not a record you can open, so neither is "Left after". */
const SCHEDULE = [{ key: 'due' }, { key: 'payment' }, { key: 'principal' }, { key: 'interest' }, { key: 'left' }];

/** `/merchants`: tapping a merchant opens it in the form above the list, which is where its actions live. */
const MERCHANTS = [{ key: 'pattern' }, { key: 'mcc' }, { key: 'matches' }, { key: 'actions' }];

describe('planRecordTable', () => {
  it('keeps the whole table on a wide screen, whatever a record opens', () => {
    for (const destination of ['detail', 'none'] as const) {
      const plan = planRecordTable(HOLDINGS, { phone: false, destination });
      expect(plan.form).toBe('table');
      expect(plan.drawn).toEqual(['name', 'held', 'average', 'cost', 'value', 'unrealized', 'realized', 'income']);
      expect(plan.behindChevron).toEqual([]);
    }
  });

  it('draws every holdings column on a phone too, because a holding has no detail screen to hold them', () => {
    const plan = planRecordTable(HOLDINGS, { phone: true, destination: 'none' });
    expect(plan.form).toBe('table');
    expect(plan.scrolls).toBe(true);
    // The four figures the collapse took off every screen: average cost, unrealized, realized and income.
    expect(plan.drawn).toEqual(['name', 'held', 'average', 'cost', 'value', 'unrealized', 'realized', 'income']);
    expect(plan.behindChevron).toEqual([]);
  });

  it('keeps “Left after” on the loan schedule at phone width', () => {
    const plan = planRecordTable(SCHEDULE, { phone: true, destination: 'none' });
    expect(plan.drawn).toContain('left');
    expect(plan.form).toBe('table');
  });

  it('drops to rows only when a record opens something, and says what waits there', () => {
    const plan = planRecordTable(MERCHANTS, { phone: true, destination: 'detail', onRow: ['pattern', 'mcc', 'matches'] });
    expect(plan.form).toBe('rows');
    expect(plan.scrolls).toBe(false);
    expect(plan.drawn).toEqual(['pattern', 'mcc', 'matches']);
    expect(plan.behindChevron).toEqual(['actions']);
  });

  it('never leaves a column on no screen at all, on either path and at either width', () => {
    const tables = [HOLDINGS, SCHEDULE, MERCHANTS];
    for (const columns of tables) {
      for (const phone of [true, false]) {
        for (const destination of ['detail', 'none'] as const) {
          const plan = planRecordTable(columns, { phone, destination, onRow: [columns[0]!.key] });
          expect([...reachableColumns(plan)].sort()).toEqual(columns.map((column) => column.key).sort());
        }
      }
    }
  });
});
