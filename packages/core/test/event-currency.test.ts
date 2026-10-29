import { describe, expect, it } from 'vitest';
import {
  canChangeEventCurrency,
  eventPlan,
  type EventPlanInput,
  type EventPlanItemInput,
  itemCurrency,
  makeConverter,
  missingCurrencies,
  purchaseTotalIn,
  shareIn,
} from '../src/index';

const RATES = [
  { from: 'EUR', to: 'IDR', onDate: '2026-03-01', rate: 18_000 },
  { from: 'TRY', to: 'IDR', onDate: '2026-03-01', rate: 400 },
  { from: 'EUR', to: 'IDR', onDate: '2026-03-08', rate: 20_000 },
];
const converter = makeConverter(RATES, 'IDR');

describe('itemCurrency', () => {
  it('is the row when there is one, else the base — old items read as base whatever the event is in', () => {
    expect(itemCurrency('EUR', 'IDR')).toBe('EUR');
    expect(itemCurrency(null, 'IDR')).toBe('IDR');
    expect(itemCurrency(undefined, 'IDR')).toBe('IDR');
  });
});

describe('makeConverter', () => {
  it('takes the pair as stored, turned over, or through the base as one rate', () => {
    expect(converter.convert(9_500, 'EUR', 'IDR', '2026-03-02')).toBe(1_710_000);
    expect(converter.convert(9_800_000, 'IDR', 'TRY', '2026-03-02')).toBe(2_450_000);
    // 1 EUR = 18000 / 400 = 45 TRY, in one step: 9500 cents -> 427500 kurus.
    expect(converter.convert(9_500, 'EUR', 'TRY', '2026-03-02')).toBe(427_500);
  });

  it('uses the day, else the latest earlier rate, and nothing before the first', () => {
    expect(converter.convert(100, 'EUR', 'IDR', '2026-03-09')).toBe(20_000);
    expect(converter.convert(100, 'EUR', 'IDR', '2026-03-05')).toBe(18_000);
    expect(converter.convert(100, 'EUR', 'IDR', '2026-02-01')).toBeNull();
  });

  it('hands a currency into itself back as it is, and null — not a guess — when no rate reaches', () => {
    expect(converter.convert(5, 'USD', 'USD', '2026-03-02')).toBe(5);
    expect(converter.convert(5, 'USD', 'IDR', '2026-03-02')).toBeNull();
    expect(converter.convert(5, 'USD', 'TRY', '2026-03-02')).toBeNull();
    expect(missingCurrencies(converter, 'IDR', ['USD', 'EUR', 'IDR'], '2026-03-02')).toEqual(['USD']);
  });
});

describe('purchaseTotalIn and shareIn', () => {
  it('reads an entry already in the currency exactly, and others from base at the day', () => {
    const entries = [
      { amountMinor: 120_000, currency: 'TRY', amountBaseMinor: 480_000 },
      { amountMinor: 400_000, currency: 'IDR', amountBaseMinor: 400_000 },
    ];
    expect(purchaseTotalIn(entries, 'TRY', 'IDR', '2026-03-02', converter)).toBe(120_000 + 100_000);
    expect(purchaseTotalIn(entries, 'USD', 'IDR', '2026-03-02', converter)).toBeNull();
  });

  it('cuts a share in proportion, half up, and the whole receipt gives the whole figure', () => {
    expect(shareIn(500, 1_000, 301)).toBe(151);
    expect(shareIn(1_000, 1_000, 301)).toBe(301);
    expect(shareIn(5, 0, 10)).toBe(0);
  });
});

describe('canChangeEventCurrency', () => {
  it('is allowed until something is bought', () => {
    expect(canChangeEventCurrency(0)).toBe(true);
    expect(canChangeEventCurrency(1)).toBe(false);
  });
});

const item = (id: string, name: string, quantity: number, unitPriceMinor: number, over: Partial<EventPlanItemInput> = {}): EventPlanItemInput => ({
  id,
  name,
  quantity,
  unitPriceMinor,
  categoryId: 'c',
  link: null,
  note: null,
  purchases: [],
  done: false,
  ...over,
});

const trip = (over: Partial<EventPlanInput> = {}): EventPlanInput => ({
  categoryNames: { c: 'Trip' },
  money: { baseCurrency: 'IDR', eventCurrency: 'TRY', today: '2026-03-02', converter },
  items: [
    item('flight', 'Flight', 1, 9_800_000), // no currency row: base
    item('museum', 'Museum pass', 1, 9_500, { currency: 'EUR' }),
    item('dinner', 'Dinner', 6, 180_000, { currency: 'TRY' }),
  ],
  actuals: [],
  ...over,
});

describe('a plan in mixed currencies', () => {
  it('totals IDR, EUR and TRY items in the event currency, and the base equivalent beside it', () => {
    const plan = eventPlan(trip());
    expect(plan.plannedEventMinor).toBe(2_450_000 + 427_500 + 1_080_000);
    expect(plan.plannedMinor).toBe(9_800_000 + 1_710_000 + 4_320_000);
    expect(plan.missingRates).toEqual([]);
    const views = plan.lines[0]!.items;
    expect(views.map((v) => [v.id, v.currency, v.estimateEventMinor])).toEqual([
      ['flight', 'IDR', 2_450_000],
      ['museum', 'EUR', 427_500],
      ['dinner', 'TRY', 1_080_000],
    ]);
  });

  it('never moves an item that is already in the event currency', () => {
    const later = eventPlan(trip({ money: { baseCurrency: 'IDR', eventCurrency: 'TRY', today: '2026-03-20', converter } }));
    expect(later.lines[0]!.items.find((v) => v.id === 'dinner')!.estimateEventMinor).toBe(1_080_000);
    // The euro one follows the 8 March rate.
    expect(later.lines[0]!.items.find((v) => v.id === 'museum')!.estimateMinor).toBe(1_900_000);
  });

  it('leaves an item with no rate out of every total, and names the currency', () => {
    const plan = eventPlan(trip({ items: [...trip().items, item('tix', 'Tickets', 1, 5_000, { currency: 'USD' })] }));
    expect(plan.plannedEventMinor).toBe(2_450_000 + 427_500 + 1_080_000);
    expect(plan.plannedMinor).toBe(9_800_000 + 1_710_000 + 4_320_000);
    expect(plan.missingRates).toEqual(['USD']);
    expect(plan.lines[0]!.items.find((v) => v.id === 'tix')).toMatchObject({ noRate: true, estimateMinor: 0, estimateEventMinor: null });
  });

  it('fixes a bought item at what was paid, on the purchase day, whatever the rate does after', () => {
    const bought = trip({
      money: { baseCurrency: 'IDR', eventCurrency: 'TRY', today: '2026-03-20', converter },
      items: [item('museum', 'Museum pass', 1, 9_500, { currency: 'EUR', done: true, purchases: [{ transactionId: 't1', shareMinor: 1_656_000 }] })],
      // Paid EUR 92 on 2 March at 18000: Rp 1.656.000, posted as a EUR entry.
      actuals: [{ transactionId: 't1', occurredOn: '2026-03-02', description: 'Museum', categoryId: 'c', amountBaseMinor: 1_656_000, amountMinor: 9_200, currency: 'EUR' }],
    });
    const view = eventPlan(bought).lines[0]!.items[0]!;
    expect(view.paidOwnMinor).toBe(9_200);
    expect(view.paidEventMinor).toBe(414_000);
    // The estimate is held at the purchase's day (18000), not today's 20000.
    expect(view.estimateMinor).toBe(1_710_000);
    expect(view.estimateEventMinor).toBe(427_500);
    expect(view.differenceMinor).toBe(1_656_000 - 1_710_000);
  });

  it('reads a purchase paid in the event currency exactly in it', () => {
    const plan = eventPlan(
      trip({
        items: [item('dinner', 'Dinner', 1, 180_000, { currency: 'TRY', done: true, purchases: [{ transactionId: 't2', shareMinor: 720_000 }] })],
        actuals: [{ transactionId: 't2', occurredOn: '2026-03-02', description: 'Dinner', categoryId: 'c', amountBaseMinor: 720_000, amountMinor: 180_000, currency: 'TRY' }],
      }),
    );
    expect(plan.lines[0]!.items[0]!.paidEventMinor).toBe(180_000);
  });

  it('is unchanged without money: an old plan reads as it always did', () => {
    const plan = eventPlan({ categoryNames: {}, items: [item('a', 'A', 2, 500)], actuals: [] });
    expect(plan.plannedMinor).toBe(1_000);
    expect(plan.plannedEventMinor).toBe(1_000);
  });
});
