import { describe, expect, it } from 'vitest';
import { balanceOf, consumeFifo, dueToExpire, expiresOn, feeRoi, LedgerError, type PointEntry } from '../src/index';

const TODAY = '2026-09-13';

const earn = (id: string, quantity: number, occurredOn: string, extra: Partial<PointEntry> = {}): PointEntry => ({
  id,
  kind: 'earn',
  quantity,
  occurredOn,
  status: 'posted',
  batchId: null,
  expiresOn: null,
  ...extra,
});

const spend = (id: string, quantity: number, batchId: string, occurredOn = TODAY): PointEntry => ({
  id,
  kind: 'redeem',
  quantity: -Math.abs(quantity),
  occurredOn,
  status: 'posted',
  batchId,
  expiresOn: null,
});

describe('the balance', () => {
  it('keeps what the issuer confirmed apart from what was only worked out', () => {
    const balance = balanceOf([earn('a', 4_200, '2026-08-01'), earn('b', 800, '2026-09-01', { status: 'projected', source: 'projected' })], TODAY);

    expect(balance).toMatchObject({ total: 5_000, postedTotal: 4_200, projectedTotal: 800 });
  });

  it('falls when points are spent', () => {
    const balance = balanceOf([earn('a', 4_200, '2026-08-01'), spend('r1', 1_200, 'a')], TODAY);

    expect(balance.total).toBe(3_000);
    expect(balance.postedTotal).toBe(3_000);
  });

  it('is nothing at all when there is nothing to count', () => {
    expect(balanceOf([], TODAY)).toMatchObject({ total: 0, postedTotal: 0, projectedTotal: 0, expiringSoon: 0, nextExpiryOn: null });
  });
});

describe('what is about to expire', () => {
  it('counts only what is still held in a batch that is running out', () => {
    const entries = [earn('a', 1_000, '2024-10-01', { expiresOn: '2026-10-01' }), earn('b', 5_000, '2026-01-01', { expiresOn: '2028-01-01' })];

    const balance = balanceOf(entries, TODAY, 60);

    expect(balance.expiringSoon).toBe(1_000);
    expect(balance.nextExpiryOn).toBe('2026-10-01');
  });

  it('leaves out what has already been spent from that batch', () => {
    const entries = [earn('a', 1_000, '2024-10-01', { expiresOn: '2026-10-01' }), spend('r1', 900, 'a')];

    expect(balanceOf(entries, TODAY, 60).expiringSoon).toBe(100);
  });

  it('says nothing is near when the date is further off than the window', () => {
    const entries = [earn('a', 1_000, '2026-01-01', { expiresOn: '2027-06-01' })];

    const balance = balanceOf(entries, TODAY, 60);

    expect(balance.expiringSoon).toBe(0);
    expect(balance.nextExpiryOn).toBe('2027-06-01');
  });

  it('ignores a batch with no expiry at all, which is the default', () => {
    const balance = balanceOf([earn('a', 1_000, '2026-01-01')], TODAY, 60);

    expect(balance.expiringSoon).toBe(0);
    expect(balance.nextExpiryOn).toBeNull();
  });

  it('does not count a batch that already expired and was written off', () => {
    const entries = [
      earn('a', 1_000, '2024-01-01', { expiresOn: '2026-01-01' }),
      { id: 'x1', kind: 'expire' as const, quantity: -1_000, occurredOn: '2026-01-01', status: 'posted' as const, batchId: 'a', expiresOn: null },
    ];

    const balance = balanceOf(entries, TODAY, 60);

    expect(balance.total).toBe(0);
    expect(balance.expiringSoon).toBe(0);
  });
});

describe('when points die', () => {
  it('gives no date at all while the program has no policy', () => {
    expect(expiresOn('2026-09-13', 'none', 24)).toBeNull();
  });

  it('counts months from the day they were earned', () => {
    expect(expiresOn('2026-09-13', 'months_from_earn', 24)).toBe('2028-09-13');
    expect(expiresOn('2026-09-13', 'months_from_earn', 18)).toBe('2028-03-13');
  });

  it('kills a year of points at the end of that year', () => {
    expect(expiresOn('2026-02-01', 'fixed_annual', null)).toBe('2026-12-31');
    expect(expiresOn('2026-12-31', 'fixed_annual', null)).toBe('2026-12-31');
  });

  it('gives no date when the policy counts months but nobody said how many', () => {
    expect(expiresOn('2026-09-13', 'months_from_earn', null)).toBeNull();
  });
});

describe('spending oldest first', () => {
  const batches: PointEntry[] = [
    earn('older', 1_000, '2026-01-01', { expiresOn: '2027-01-01' }),
    earn('newer', 2_000, '2026-06-01', { expiresOn: '2027-06-01' }),
  ];

  it('takes the batch that dies soonest', () => {
    expect(consumeFifo(batches, 600, TODAY)).toEqual([{ batchId: 'older', quantity: 600 }]);
  });

  it('runs into the next batch when the first cannot cover it', () => {
    expect(consumeFifo(batches, 1_500, TODAY)).toEqual([
      { batchId: 'older', quantity: 1_000 },
      { batchId: 'newer', quantity: 500 },
    ]);
  });

  it('leaves out what was already spent from a batch', () => {
    const entries = [...batches, spend('r1', 900, 'older')];

    expect(consumeFifo(entries, 200, TODAY)).toEqual([
      { batchId: 'older', quantity: 100 },
      { batchId: 'newer', quantity: 100 },
    ]);
  });

  it('will not spend points that have already died', () => {
    const entries = [earn('dead', 5_000, '2023-01-01', { expiresOn: '2025-01-01' }), ...batches];

    expect(consumeFifo(entries, 1_000, TODAY)).toEqual([{ batchId: 'older', quantity: 1_000 }]);
  });

  it('refuses to spend more than is held', () => {
    expect(() => consumeFifo(batches, 4_000, TODAY)).toThrow(LedgerError);
  });
});

describe('what has to be written off', () => {
  it('names each batch that is past its date and still holds something', () => {
    const entries = [earn('gone', 400, '2024-01-01', { expiresOn: '2026-01-01' }), earn('alive', 900, '2026-01-01', { expiresOn: '2027-01-01' })];

    expect(dueToExpire(entries, TODAY)).toEqual([{ batchId: 'gone', quantity: 400, expiresOn: '2026-01-01' }]);
  });

  it('says nothing about a batch already written off', () => {
    const entries: PointEntry[] = [
      earn('gone', 400, '2024-01-01', { expiresOn: '2026-01-01' }),
      { id: 'x1', kind: 'expire', quantity: -400, occurredOn: '2026-01-01', status: 'posted', batchId: 'gone', expiresOn: null },
    ];

    expect(dueToExpire(entries, TODAY)).toEqual([]);
  });

  it('says nothing at all when no batch has a date', () => {
    expect(dueToExpire([earn('a', 1_000, '2020-01-01')], TODAY)).toEqual([]);
  });
});

describe('what a card year was worth', () => {
  const year = { from: '2026-01-01', to: '2026-12-31' };
  // Rp 25 a point, in micro-rupiah.
  const RATE = 25_000_000;

  it('values the points earned and takes the fee off', () => {
    const entries = [earn('a', 6_000, '2026-03-01'), earn('b', 4_000, '2026-07-01')];

    expect(feeRoi({ entries, ...year, valuePerPointMicro: RATE, annualFeeMinor: 750_000 })).toMatchObject({
      pointsEarned: 10_000,
      valueMinor: 250_000,
      annualFeeMinor: 750_000,
      netMinor: -500_000,
    });
  });

  it('counts only what was earned inside the year', () => {
    const entries = [earn('old', 8_000, '2025-12-31'), earn('in', 2_000, '2026-06-01'), earn('next', 5_000, '2027-01-01')];

    expect(feeRoi({ entries, ...year, valuePerPointMicro: RATE, annualFeeMinor: 0 }).pointsEarned).toBe(2_000);
  });

  it('leaves out what was spent, expired or corrected: the fee bought the earning', () => {
    const entries = [earn('a', 10_000, '2026-03-01'), spend('r1', 4_000, 'a', '2026-04-01')];

    expect(feeRoi({ entries, ...year, valuePerPointMicro: RATE, annualFeeMinor: 0 }).pointsEarned).toBe(10_000);
  });

  it('says so when any of it was only worked out', () => {
    const entries = [earn('a', 6_000, '2026-03-01'), earn('b', 4_000, '2026-07-01', { status: 'projected' })];

    expect(feeRoi({ entries, ...year, valuePerPointMicro: RATE, annualFeeMinor: 0 }).estimated).toBe(true);
  });

  it('stands behind the figure when every point was confirmed', () => {
    const entries = [earn('a', 6_000, '2026-03-01')];

    expect(feeRoi({ entries, ...year, valuePerPointMicro: RATE, annualFeeMinor: 0 }).estimated).toBe(false);
  });

  it('is the plain value of the points when the card is free', () => {
    const entries = [earn('a', 10_000, '2026-03-01')];

    expect(feeRoi({ entries, ...year, valuePerPointMicro: RATE, annualFeeMinor: 0 }).netMinor).toBe(250_000);
  });
});
