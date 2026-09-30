import type { ItemSummary } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import type { ReceivedItem } from './joint-rows';
import { type PurchaseLine, sharedItemView, linesPaidFrom } from './shared-item';

const card: ReceivedItem = {
  itemId: 'i-visa',
  owner: 'm-rina',
  kind: 'liability',
  subtype: 'credit_card',
  name: 'BCA Visa ···· 1234',
  currency: 'IDR',
  balanceMinor: 3_000_000,
  asOf: '2026-09-20',
  card: { limitMinor: 10_000_000, cycleStart: '2026-09-05', cycleEnd: '2026-10-04' },
  period: { start: '2026-09-05', end: '2026-10-04' },
  openingMinor: 1_000_000,
  householdMinor: 1_500_000,
  otherUseMinor: 500_000,
  monthEnds: [
    { month: '2026-07', balanceMinor: 800_000 },
    { month: '2026-08', balanceMinor: 1_000_000 },
  ],
  tax: null,
} satisfies ItemSummary & { itemId: string };

const line = (over: Partial<PurchaseLine>): PurchaseLine => ({
  lineageId: 'p',
  transactionId: 't',
  occurredOn: '2026-09-10',
  recordedOn: '2026-09-10',
  description: 'Groceries',
  amountMinor: 300_000,
  currency: 'IDR',
  paidFromItemId: 'i-visa',
  paidBy: 'm-andi',
  ...over,
});

describe('linesPaidFrom (spec §8.3 "Lines you can see")', () => {
  it('keeps the Household purchases of the period whose money side is on the item', () => {
    const purchases = [
      line({ lineageId: 'a' }),
      line({ lineageId: 'b', paidFromItemId: 'i-other' }),
      line({ lineageId: 'c', paidFromItemId: null }),
      line({ lineageId: 'd', occurredOn: '2026-09-01' }), // before the cycle
    ];
    expect(linesPaidFrom(purchases, card).map((p) => p.lineageId)).toEqual(['a']);
  });
});

describe('sharedItemView', () => {
  it('reads balance, other use as one total, details and the card bar', () => {
    const view = sharedItemView(card, [line({})], 'Rina');
    expect(view.balance).toEqual({ minor: 3_000_000, currency: 'IDR' });
    expect(view.otherUse).toMatchObject({ label: "Rina's other use", under: 'total only', credit: false });
    expect(view.otherUse.text).toBe(view.otherUse.text.replace('−', '')); // no minus sign on a charge
    expect(view.details).toEqual({ owner: 'Rina', updated: '2026-09-20', notYet: null });
    expect(view.bar).toEqual({ householdPct: 15, otherPct: 5, availableMinor: 7_000_000, limitMinor: 10_000_000 });
    // The chart: the month-ends, then today's balance.
    expect(view.chart.values).toEqual([800_000, 1_000_000, 3_000_000]);
  });

  it('a negative other use reads as a credit, with a minus sign', () => {
    const view = sharedItemView({ ...card, otherUseMinor: -250_000, balanceMinor: 2_250_000 }, [], 'Rina');
    expect(view.otherUse.credit).toBe(true);
    expect(view.otherUse.text.startsWith('−')).toBe(true);
    expect(view.otherUse.text).toContain('250.000');
    expect(view.otherUse.under).toBe('total only · a credit');
  });

  it('a purchase paid from it that is newer than the summary is "not yet on Rina\'s phone", and the bar subtracts it', () => {
    const late = line({ lineageId: 'late', occurredOn: '2026-09-25', recordedOn: '2026-09-25', amountMinor: 1_000_000 });
    const view = sharedItemView(card, [line({}), late], 'Rina');
    expect(view.details.notYet).toBe("1 purchase not yet on Rina's phone");
    expect(view.lines.find((l) => l.lineageId === 'late')?.pending).toBe(true);
    expect(view.lines.find((l) => l.lineageId === 'p')?.pending).toBe(false);
    // available 10 jt − (3 jt + 1 jt waiting) = 6 jt; household share grows by what waits.
    expect(view.bar).toEqual({ householdPct: 25, otherPct: 5, availableMinor: 6_000_000, limitMinor: 10_000_000 });
  });

  it('a purchase recorded after the summary counts as waiting even when dated before it', () => {
    const view = sharedItemView(card, [line({ occurredOn: '2026-09-18', recordedOn: '2026-09-21' })], 'Rina');
    expect(view.details.notYet).toBe("1 purchase not yet on Rina's phone");
  });

  it('the owner\'s own purchase received late is not pending: her summary already holds it (finding 3)', () => {
    const hers = line({ lineageId: 'hers', paidBy: 'm-rina', occurredOn: '2026-09-25', recordedOn: '2026-09-25', amountMinor: 1_000_000 });
    const view = sharedItemView(card, [hers], 'Rina');
    expect(view.lines[0]!.pending).toBe(false);
    expect(view.details.notYet).toBeNull();
    expect(view.bar!.availableMinor).toBe(7_000_000);
  });

  it('the chart never draws the summary\'s month twice (finding 7)', () => {
    const view = sharedItemView({ ...card, monthEnds: [...card.monthEnds, { month: '2026-09', balanceMinor: 2_900_000 }] }, [], 'Rina');
    expect(view.chart.months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(view.chart.values).toEqual([800_000, 1_000_000, 3_000_000]);
  });

  it('an account that is not a card has no bar', () => {
    expect(sharedItemView({ ...card, kind: 'asset', subtype: 'bank', card: null }, [], 'Rina').bar).toBeNull();
  });
});
