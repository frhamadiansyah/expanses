import { describe, expect, it } from 'vitest';
import { cashflowLine, recordedCount } from './cashflow-desk-model';

describe('Cashflow’s line under the title', () => {
  it('names the period, the recorded rows and those not recorded yet', () => {
    expect(cashflowLine('November 2026', 42, 3)).toBe('November 2026 · 42 recorded · 3 not recorded yet');
  });
  it('says nothing of rows not recorded when none wait', () => {
    expect(cashflowLine('November 2026', 1, 0)).toBe('November 2026 · 1 recorded');
  });
  it('counts recorded rows only, a deleted one shown by the filter left out', () => {
    expect(
      recordedCount([
        { kind: 'tx', deleted: false },
        { kind: 'tx', deleted: true },
        { kind: 'draft', deleted: false },
        { kind: 'tx', deleted: false },
      ]),
    ).toBe(2);
  });
});
