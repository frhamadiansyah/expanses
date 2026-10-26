import { describe, expect, it } from 'vitest';
import { heldFor, sellFigures, signedGain } from './sell-model';

const o = { currency: 'IDR', costMinor: 210_000_000, today: '2026-10-26', acquiredOn: '2022-03-12' };
const draft = { soldFor: '225.000.000', date: '2026-10-20', cashId: 'bank', costs: '', goalId: '' };

describe('the Sell sheet sums', () => {
  it('works out total and gain against the original cost with no costs', () => {
    expect(sellFigures(draft, o)).toMatchObject({ soldForMinor: 225_000_000, costsMinor: 0, totalMinor: 225_000_000, gainMinor: 15_000_000, problem: null, ready: true });
  });

  it('takes the costs off the total, and the gain follows', () => {
    expect(sellFigures({ ...draft, costs: '5.000.000' }, o)).toMatchObject({ costsMinor: 5_000_000, totalMinor: 220_000_000, gainMinor: 10_000_000 });
  });

  it('reads a loss as a negative gain', () => {
    expect(sellFigures({ ...draft, soldFor: '190.000.000' }, o).gainMinor).toBe(-20_000_000);
  });

  it('waits, not complains, while a field is blank', () => {
    expect(sellFigures({ ...draft, soldFor: '' }, o)).toMatchObject({ totalMinor: null, problem: null, ready: false });
    expect(sellFigures({ ...draft, cashId: '' }, o)).toMatchObject({ ready: false, problem: null });
    expect(sellFigures({ ...draft, date: '' }, o).ready).toBe(false);
  });

  it('refuses a future day, a day before it was acquired, and costs that eat the price', () => {
    expect(sellFigures({ ...draft, date: '2026-10-27' }, o)).toMatchObject({ ready: false, problem: 'It cannot be sold after today' });
    expect(sellFigures({ ...draft, date: '2022-03-11' }, o)).toMatchObject({ ready: false, problem: 'It cannot be sold before it was acquired' });
    expect(sellFigures({ ...draft, date: '2022-03-12' }, o).ready).toBe(true);
    expect(sellFigures({ ...draft, costs: '225.000.000' }, o)).toMatchObject({ ready: false, problem: 'Costs must be less than what it sold for' });
    expect(sellFigures({ ...draft, soldFor: 'abc' }, o).ready).toBe(false);
  });

  it('writes a gain with its sign', () => {
    expect(signedGain(15, (m) => `Rp ${m}`)).toBe('+Rp 15');
    expect(signedGain(-2, (m) => `Rp ${m}`)).toBe('−Rp 2');
    expect(signedGain(0, (m) => `Rp ${m}`)).toBe('+Rp 0');
  });

  it('says how long it was held', () => {
    expect(heldFor('2022-03-12', '2026-10-26')).toBe('4 years 7 months');
    expect(heldFor('2025-10-26', '2026-10-26')).toBe('1 year');
    expect(heldFor('2026-10-01', '2026-10-20')).toBe('Under a month');
    expect(heldFor('2026-01-31', '2026-02-28')).toBe('Under a month');
  });
});
