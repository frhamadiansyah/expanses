import { describe, expect, it } from 'vitest';
import { type NeedBill, repeatingNeeds } from './repeating-needs';

const TODAY = '2026-10-27';
const bill = (id: string, over: Partial<NeedBill> = {}): NeedBill => ({
  id,
  amountMinor: 1_200_000,
  estimateMinor: null,
  currency: 'IDR',
  dueOn: '2027-01-15',
  ...over,
});
const need = (result: ReturnType<typeof repeatingNeeds>, id: string) => result.bills.find((row) => row.billId === id)!;

describe('repeatingNeeds', () => {
  it('counts a funded bill by its fund and an unfunded one by amount over months left', () => {
    const result = repeatingNeeds([bill('a', { amountMinor: 4_800_000 }), bill('b', { amountMinor: 1_200_000 })], [{ billId: 'a', monthlyMinor: 468_750 }], TODAY, 'IDR');
    expect(need(result, 'a')).toMatchObject({ needMinor: 468_750, funded: true });
    // October to January is 3 months left: 400.000.
    expect(need(result, 'b')).toMatchObject({ needMinor: 400_000, funded: false });
    expect(result.fundedMinor).toBe(468_750);
    expect(result.unfundedMinor).toBe(400_000);
    expect(result.totalMinor).toBe(868_750);
    expect(result.bills.reduce((sum, row) => sum + (row.readMinor ?? 0), 0)).toBe(result.totalMinor);
    expect(result.approximate).toBe(false);
  });

  it('leaves one month for a bill due next month and spreads one due in six', () => {
    const result = repeatingNeeds([bill('n', { dueOn: '2026-11-12', amountMinor: 900_000 }), bill('s', { dueOn: '2027-04-12', amountMinor: 900_000 })], [], TODAY, 'IDR');
    expect(need(result, 'n').needMinor).toBe(900_000);
    expect(need(result, 's').needMinor).toBe(150_000);
  });

  it('never goes below one month, and rounds up to a whole unit', () => {
    const result = repeatingNeeds([bill('now', { dueOn: '2026-10-30', amountMinor: 700_000 }), bill('odd', { dueOn: '2027-01-02', amountMinor: 1_000_001 })], [], TODAY, 'IDR');
    expect(need(result, 'now').needMinor).toBe(700_000);
    expect(need(result, 'odd').needMinor).toBe(333_334);
    // USD in cents rounds up to whole dollars.
    expect(repeatingNeeds([bill('u', { currency: 'USD', amountMinor: 10_000, dueOn: '2027-01-02' })], [], TODAY, 'USD').bills[0]!.needMinor).toBe(3400);
  });

  it('goes by the estimate of a varying amount, and leaves one without an estimate out', () => {
    const result = repeatingNeeds([bill('e', { amountMinor: null, estimateMinor: 600_000 }), bill('v', { amountMinor: null })], [], TODAY, 'IDR');
    expect(need(result, 'e').needMinor).toBe(200_000);
    expect(need(result, 'v')).toMatchObject({ needMinor: null, readMinor: null });
    expect(result.totalMinor).toBe(200_000);
    expect(result.approximate).toBe(true);
  });

  it('brings a foreign bill over with a rate, and leaves it out with none', () => {
    const usd = bill('usd', { currency: 'USD', amountMinor: 30_000, dueOn: '2027-01-02' });
    const withRate = repeatingNeeds([usd], [], TODAY, 'IDR', (minor, from) => (from === 'USD' ? minor * 160 : null));
    expect(need(withRate, 'usd').needMinor).toBe(10_000);
    expect(need(withRate, 'usd').readMinor).toBe(1_600_000);
    expect(withRate.unfundedMinor).toBe(1_600_000);
    const without = repeatingNeeds([usd, bill('idr')], [], TODAY, 'IDR');
    expect(need(without, 'usd')).toMatchObject({ needMinor: 10_000, readMinor: null });
    expect(without.unfundedMinor).toBe(400_000);
    expect(without.approximate).toBe(true);
  });

  it('counts an every-3-months bill from its next date', () => {
    const result = repeatingNeeds([bill('q', { amountMinor: 300_000, dueOn: '2027-01-10' })], [], TODAY, 'IDR');
    expect(need(result, 'q').needMinor).toBe(100_000);
  });

  it('takes next year for a bill whose date this year has passed', () => {
    // The caller hands the next occurrence: March next year, 5 months left.
    const result = repeatingNeeds([bill('p', { amountMinor: 5_000_000, dueOn: '2027-03-05' })], [], TODAY, 'IDR');
    expect(need(result, 'p').needMinor).toBe(1_000_000);
  });

  it('is all funded when no bill is without a fund, and zero with none', () => {
    const funded = repeatingNeeds([bill('a')], [{ billId: 'a', monthlyMinor: 100 }], TODAY, 'IDR');
    expect(funded.unfundedMinor).toBe(0);
    expect(funded.fundedMinor).toBe(100);
    expect(repeatingNeeds([], [], TODAY, 'IDR')).toMatchObject({ totalMinor: 0, fundedMinor: 0, unfundedMinor: 0, approximate: false });
  });
});
