import { describe, expect, it } from 'vitest';
import { type CoverCharge, type CoverCredit, coverOldestFirst } from '../src/statement/cover';

// Invented figures throughout.
const charge = (key: string, on: string, amountMinor: number, settled = false): CoverCharge => ({ key, on, amountMinor, settled });
const credit = (key: string, on: string, amountMinor: number): CoverCredit => ({ key, on, amountMinor });

const FOUR = [charge('market', '2026-10-02', 412_000), charge('ride', '2026-10-03', 185_000), charge('shop', '2026-10-04', 649_000), charge('dinner', '2026-10-06', 280_000)];

describe('covering a statement’s purchases with its lump payments, oldest first', () => {
  it('covers every purchase whole when the pool matches their total, each by the payment that completes it', () => {
    const cover = coverOldestFirst({ charges: FOUR, poolMinor: 1_526_000, credits: [credit('pay', '2026-11-10', 1_526_000)] });
    for (const key of ['market', 'ride', 'shop', 'dinner']) expect(cover.get(key)).toMatchObject({ whole: true, leftMinor: 0, credit: { key: 'pay' } });
    expect(cover.get('shop')!.coveredMinor).toBe(649_000);
  });

  it('covers the oldest first and leaves the newest owed; a purchase part covered says how much is left', () => {
    const cover = coverOldestFirst({ charges: FOUR, poolMinor: 600_000, credits: [credit('pay', '2026-11-10', 600_000)] });
    expect(cover.get('market')).toMatchObject({ whole: true, coveredMinor: 412_000, leftMinor: 0 });
    expect(cover.get('ride')).toMatchObject({ whole: true, coveredMinor: 185_000, leftMinor: 0 });
    expect(cover.get('shop')).toMatchObject({ whole: false, coveredMinor: 3_000, leftMinor: 646_000 });
    expect(cover.get('dinner')).toMatchObject({ whole: false, coveredMinor: 0, leftMinor: 280_000, credit: null });
  });

  it('skips a purchase paid one by one: it is not in the map and the pool runs on past it', () => {
    const charges = FOUR.map((c) => (c.key === 'ride' ? { ...c, settled: true } : c));
    const cover = coverOldestFirst({ charges, poolMinor: 1_061_000, credits: [credit('pay', '2026-11-10', 1_061_000)] });
    expect(cover.has('ride')).toBe(false);
    expect(cover.get('market')!.whole).toBe(true);
    expect(cover.get('shop')!.whole).toBe(true);
    expect(cover.get('dinner')).toMatchObject({ whole: false, coveredMinor: 0, leftMinor: 280_000 });
  });

  it('names the payment that completes a purchase’s cover when several payments share it', () => {
    const credits = [credit('first', '2026-11-10', 600_000), credit('second', '2026-11-15', 926_000)];
    const cover = coverOldestFirst({ charges: FOUR, poolMinor: 1_526_000, credits });
    expect(cover.get('market')!.credit!.key).toBe('first');
    expect(cover.get('ride')!.credit!.key).toBe('first');
    // Rp 3.000 of the first payment and the rest of the second: the second completes it.
    expect(cover.get('shop')!.credit!.key).toBe('second');
    expect(cover.get('dinner')!.credit!.key).toBe('second');
  });

  it('takes the pool from the latest credits: earlier ones went to the older bill', () => {
    // Rp 500.000 paid mid-cycle cleared the previous bill; only the later payment reaches these purchases.
    const credits = [credit('older', '2026-10-05', 500_000), credit('later', '2026-11-10', 597_000)];
    const cover = coverOldestFirst({ charges: FOUR, poolMinor: 597_000, credits });
    expect(cover.get('market')!.credit!.key).toBe('later');
    expect(cover.get('ride')!.credit!.key).toBe('later');
    expect(cover.get('shop')!.coveredMinor).toBe(0);
  });

  it('never covers more than a purchase: a pool bigger than the total leaves every purchase whole and no more', () => {
    const cover = coverOldestFirst({ charges: FOUR, poolMinor: 2_000_000, credits: [credit('pay', '2026-11-10', 2_000_000)] });
    const total = [...cover.values()].reduce((sum, c) => sum + c.coveredMinor, 0);
    expect(total).toBe(1_526_000);
    expect([...cover.values()].every((c) => c.whole && c.leftMinor === 0)).toBe(true);
  });

  it('covers nothing with an empty pool, or a negative one', () => {
    for (const poolMinor of [0, -50_000]) {
      const cover = coverOldestFirst({ charges: FOUR, poolMinor, credits: [credit('pay', '2026-11-10', 100_000)] });
      expect([...cover.values()].every((c) => c.coveredMinor === 0 && !c.whole && c.credit === null)).toBe(true);
      expect(cover.get('shop')!.leftMinor).toBe(649_000);
    }
  });

  it('orders by date first, and same-day purchases in the order given', () => {
    const charges = [charge('late', '2026-10-09', 100_000), charge('b', '2026-10-02', 70_000), charge('a', '2026-10-02', 50_000)];
    const cover = coverOldestFirst({ charges, poolMinor: 90_000, credits: [credit('pay', '2026-11-10', 90_000)] });
    expect(cover.get('b')).toMatchObject({ whole: true });
    expect(cover.get('a')).toMatchObject({ coveredMinor: 20_000, leftMinor: 30_000 });
    expect(cover.get('late')).toMatchObject({ coveredMinor: 0 });
  });

  it('orders same-day credits in the order given, and names none for a part the credits listed do not reach', () => {
    // The pool is more than the credits listed: the rest was credit carried on the card from before.
    const credits = [credit('x', '2026-11-10', 100_000), credit('y', '2026-11-10', 100_000)];
    const cover = coverOldestFirst({ charges: [charge('one', '2026-10-01', 150_000), charge('two', '2026-10-02', 200_000)], poolMinor: 350_000, credits });
    expect(cover.get('one')).toMatchObject({ whole: true, credit: null });
    expect(cover.get('two')).toMatchObject({ whole: true, credit: { key: 'y' } });
  });

  it('leaves the sum covered plus the sum left equal to what the purchases add up to', () => {
    for (const poolMinor of [0, 1, 411_999, 412_000, 1_000_000, 1_525_999, 1_526_000, 9_999_999]) {
      const cover = coverOldestFirst({ charges: FOUR, poolMinor, credits: [credit('pay', '2026-11-10', poolMinor)] });
      const covered = [...cover.values()].reduce((sum, c) => sum + c.coveredMinor, 0);
      const left = [...cover.values()].reduce((sum, c) => sum + c.leftMinor, 0);
      expect(covered).toBe(Math.min(Math.max(poolMinor, 0), 1_526_000));
      expect(covered + left).toBe(1_526_000);
    }
  });
});
