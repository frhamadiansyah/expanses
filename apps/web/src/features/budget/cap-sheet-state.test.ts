import { parseMajor, parsePercentBp } from '@expanses/core';
import type { BudgetRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { type CapForm, openForm, savedOf, switchMode, switchMonth, typeFigure } from './cap-sheet-state';

const base = { basis: 'take-home' as const, label: 'take-home', minor: 10_000_000 };

// Food: 30% of a Rp 10.000.000 take-home, Rp 3.000.000 a month; with `month`, this month asks for that instead.
const shareRow = (month?: number): BudgetRow => ({
  id: 'b-food',
  categoryAccountId: 'food',
  planMinor: 3_000_000,
  amountMinor: month ?? 3_000_000,
  overridden: month !== undefined,
  frequency: 'monthly',
  amountAsSetMinor: 3_000_000,
  share: { basis: 'take-home', bp: 3000 },
});

// The field always reads as what is shown: a % while the plan is a % and Just this month is off, else Rp.
const fieldMatchesMode = (form: CapForm) => {
  if (form.mode === 'share' && !form.thisMonthOnly) expect(() => parsePercentBp(form.amount)).not.toThrow();
  else expect(() => parseMajor(form.amount, 'IDR')).not.toThrow();
};

describe('Just this month on a % budget', () => {
  it('leaves the plan a % when Just this month is turned off, on a budget opened with a month of its own', () => {
    const row = shareRow(4_000_000);
    const opened = openForm(row, 'IDR');
    expect(opened).toMatchObject({ thisMonthOnly: true, amount: '4.000.000', mode: 'share' });
    const off = switchMonth(opened, false, row, base, 'IDR');
    expect(off).toMatchObject({ thisMonthOnly: false, amount: '30', mode: 'share' });
    fieldMatchesMode(off);
    expect(savedOf(off, base, 'IDR')).toEqual({ kind: 'plan', plan: { amountMinor: 3_000_000, frequency: 'monthly', share: { basis: 'take-home', bp: 3000 } } });
  });

  it('shows the month’s figure when turned on and the plan’s % when turned off again, so ✓ saves what was stored', () => {
    const row = shareRow();
    const on = switchMonth(openForm(row, 'IDR'), true, row, base, 'IDR');
    expect(on).toMatchObject({ thisMonthOnly: true, amount: '3.000.000', mode: 'share' });
    fieldMatchesMode(on);
    expect(savedOf(on, base, 'IDR')).toEqual({ kind: 'month', amountMinor: 3_000_000 });
    const off = switchMonth(on, false, row, base, 'IDR');
    expect(off).toMatchObject({ thisMonthOnly: false, amount: '30', mode: 'share' });
    expect(savedOf(off, base, 'IDR')).toEqual({ kind: 'plan', plan: { amountMinor: 3_000_000, frequency: 'monthly', share: { basis: 'take-home', bp: 3000 } } });
  });

  it('turns a typed % into its month’s figure, and back to that % when the month’s figure was not changed', () => {
    const row = shareRow();
    const typed = typeFigure(openForm(row, 'IDR'), '25');
    const on = switchMonth(typed, true, row, base, 'IDR');
    expect(on).toMatchObject({ amount: '2.500.000', mode: 'share' });
    expect(switchMonth(on, false, row, base, 'IDR')).toMatchObject({ amount: '25', mode: 'share' });
  });

  it('carries a month’s figure typed while it was on back to the plan as its %', () => {
    const row = shareRow();
    const on = typeFigure(switchMonth(typeFigure(openForm(row, 'IDR'), '25'), true, row, base, 'IDR'), '2.000.000');
    const off = switchMonth(on, false, row, base, 'IDR');
    expect(off).toMatchObject({ amount: '20', mode: 'share' });
    fieldMatchesMode(off);
  });
});

describe('Amount ↔ % on the sheet', () => {
  it('gives back the figure exactly when switched back without typing', () => {
    const amount = typeFigure(openForm(undefined, 'IDR'), '1.234.567');
    const share = switchMode(amount, 'share', base, 'IDR');
    expect(share.amount).toBe('12,35');
    expect(switchMode(share, 'amount', base, 'IDR')).toMatchObject({ amount: '1.234.567', mode: 'amount', frequency: 'monthly' });
  });

  it('gives back the figure in its unit, and a % exactly too', () => {
    const quarterly = { ...typeFigure(openForm(undefined, 'IDR'), '3.600.000'), frequency: 'quarterly' as const };
    expect(switchMode(switchMode(quarterly, 'share', base, 'IDR'), 'amount', base, 'IDR')).toMatchObject({ amount: '3.600.000', frequency: 'quarterly' });
    const share = openForm(shareRow(), 'IDR');
    const odd = typeFigure(share, '12,34');
    expect(switchMode(switchMode(odd, 'amount', base, 'IDR'), 'share', base, 'IDR').amount).toBe('12,34');
  });

  it('converts afresh once something was typed after the switch', () => {
    const share = switchMode(typeFigure(openForm(undefined, 'IDR'), '1.234.567'), 'share', base, 'IDR');
    expect(switchMode(typeFigure(share, '15'), 'amount', base, 'IDR').amount).toBe('1.500.000');
  });
});
