import { describe, expect, it } from 'vitest';
import { feeLine } from './fee-line';

describe('the annual fee row on a card page', () => {
  it('is absent with neither an amount nor a date', () => expect(feeLine(null, null, null, 'IDR', '2026-10-26')).toBeNull());
  it('names the charge that already happened and the next, and is not soon far off', () => {
    const line = feeLine(500_000, '2023-03-12', null, 'IDR', '2026-10-26')!;
    expect(line.when).toBe('Charged on 12 Mar 2026 · next 12 Mar 2027');
    expect(line.soon).toBe(false);
  });
  it('names only the coming charge when it is within 30 days', () => {
    const line = feeLine(500_000, '2020-11-20', null, 'IDR', '2026-10-26')!;
    expect(line.when).toBe('Charged on 20 Nov 2026');
    expect(line.soon).toBe(true);
  });
  it('turns soon within 30 days', () => expect(feeLine(500_000, '2020-11-20', null, 'IDR', '2026-10-26')!.soon).toBe(true));
  it('shows a date alone, or an amount alone', () => {
    expect(feeLine(null, '2020-11-20', null, 'IDR', '2026-10-26')!.amount).toBeNull();
    expect(feeLine(0, null, null, 'IDR', '2026-10-26')).toMatchObject({ when: null, soon: false });
  });
  it('reads waived with next year’s charge, and is not soon', () => {
    const line = feeLine(500_000, '2020-11-20', 2026, 'IDR', '2026-10-26')!;
    expect(line).toMatchObject({ waived: true, soon: false, when: 'Waived this year · next charge 20 Nov 2027' });
  });
  it('reads a year refunded through the old Fee refunded as waived: one word for both', () => {
    const line = feeLine(500_000, '2020-11-20', null, 'IDR', '2026-10-26', 2026)!;
    expect(line).toMatchObject({ waived: true, soon: false, when: 'Waived this year · next charge 20 Nov 2027' });
  });
  it('ignores a refund of another year', () => expect(feeLine(500_000, '2020-11-20', null, 'IDR', '2026-10-26', 2025)!.waived).toBe(false));
});
