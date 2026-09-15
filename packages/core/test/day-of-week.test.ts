import { describe, expect, it } from 'vitest';
import { dayOfWeek, matchesSpend, type SpendLine } from '../src/index';

const line = (occurredOn: string): SpendLine => ({
  transactionId: 't', entryId: 'e', occurredOn, categoryId: 'shopping', description: 'Belanja',
  amountMinor: 1_000_000, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, cardFee: false,
});

describe('reading the day off the purchase date', () => {
  it('numbers Sunday 0 through Saturday 6', () => {
    // 13 September 2026 is a Sunday.
    expect([13, 14, 15, 16, 17, 18, 19].map((d) => dayOfWeek(`2026-09-${d}`))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('does not shift with the machine’s time zone', () => {
    // A plain date has no zone; parsed as local time, a date near midnight could land on the day before.
    expect(dayOfWeek('2026-01-01')).toBe(4);
    expect(dayOfWeek('2026-12-31')).toBe(4);
  });
});

describe('a rule that only earns at the weekend', () => {
  const weekend = { daysOfWeek: [0, 6] };

  it('matches Saturday and Sunday and nothing between', () => {
    const days = [13, 14, 15, 16, 17, 18, 19].map((d) => matchesSpend(weekend, line(`2026-09-${d}`), {}));
    expect(days).toEqual([true, false, false, false, false, false, true]);
  });

  it('leaves a rule without the field matching every day, as it did before', () => {
    for (const d of [13, 14, 15, 16, 17, 18, 19]) expect(matchesSpend({}, line(`2026-09-${d}`), {})).toBe(true);
  });

  it('is ANDed with the rest of the match, not ORed', () => {
    const saturdayGroceries = { daysOfWeek: [0, 6], merchantPatterns: ['superindo'] };
    expect(matchesSpend(saturdayGroceries, { ...line('2026-09-19'), description: 'Superindo' }, {})).toBe(true);
    // Right day, wrong shop.
    expect(matchesSpend(saturdayGroceries, { ...line('2026-09-19'), description: 'Indomaret' }, {})).toBe(false);
    // Right shop, wrong day.
    expect(matchesSpend(saturdayGroceries, { ...line('2026-09-16'), description: 'Superindo' }, {})).toBe(false);
  });
});
