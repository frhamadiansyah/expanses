import { describe, expect, it } from 'vitest';
import { type CoverCharge, type CoverCredit, coverOldestFirst, coverStatement, type PoolLine } from '../src/statement/cover';

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

const OCT = { start: '2026-09-21', end: '2026-10-20' };
const at = (key: string, statementOn: string, poolMinor: number): PoolLine => ({ key, statementOn, poolMinor });
const OCT_FOUR = [at('market', '2026-10-02', 412_000), at('ride', '2026-10-03', 185_000), at('shop', '2026-10-04', 649_000), at('dinner', '2026-10-06', 280_000)];

describe('one statement’s cover, from the card’s pool lines', () => {
  it('a closed statement counts the credits since its date, up to today, and not those after today', () => {
    const lines = [...OCT_FOUR, at('lump', '2026-11-10', -600_000), at('later', '2026-11-20', -900_000)];
    const cover = coverStatement({ lines, cycle: OCT, today: '2026-11-12' });
    expect(cover.get('ride')).toMatchObject({ whole: true, credit: { key: 'lump' } });
    expect(cover.get('shop')).toMatchObject({ coveredMinor: 3_000, leftMinor: 646_000 });
  });

  it('credits clear what was owed before the statement first', () => {
    const lines = [at('old', '2026-09-02', 500_000), ...OCT_FOUR, at('lump', '2026-11-10', 0 - 1_097_000)];
    const cover = coverStatement({ lines, cycle: OCT, today: '2026-11-12' });
    expect(cover.get('ride')!.whole).toBe(true);
    expect(cover.get('shop')!.coveredMinor).toBe(0);
  });

  it('an open statement lets a payment spill past the previous bill into its cycle, and no carried credit', () => {
    const open = { start: '2026-10-21', end: '2026-11-20' };
    const spill = coverStatement({ lines: [at('old', '2026-10-02', 500_000), at('a', '2026-10-25', 300_000), at('pay', '2026-11-01', -600_000)], cycle: open, today: '2026-11-12' });
    expect(spill.get('a')).toMatchObject({ coveredMinor: 100_000, leftMinor: 200_000, credit: { key: 'pay' } });
    const carried = coverStatement({ lines: [at('refund', '2026-10-02', -500_000), at('a', '2026-10-25', 300_000)], cycle: open, today: '2026-11-12' });
    expect(carried.get('a')).toMatchObject({ coveredMinor: 0 });
  });

  it('a credit carried on the card from before covers a closed statement, naming no credit', () => {
    const cover = coverStatement({ lines: [at('refund', '2026-09-02', -500_000), at('a', '2026-10-02', 300_000)], cycle: OCT, today: '2026-11-12' });
    expect(cover.get('a')).toMatchObject({ whole: true, credit: null });
  });

  it('whenever the pool lines owe nothing by today, every charge of every statement is covered', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      let r = seed;
      const rand = (n: number) => {
        r = (r * 1_103_515_245 + 12_345) % 2_147_483_648;
        return r % n;
      };
      const lines: PoolLine[] = [];
      let owed = 0;
      for (let i = 0; i < 1 + rand(10); i += 1) {
        const amount = (1 + rand(50)) * 10_000;
        lines.push(at(`c${i}`, `2026-${rand(2) === 0 ? '09' : '10'}-${String(1 + rand(28)).padStart(2, '0')}`, amount));
        owed += amount;
      }
      const first = rand(owed + 1);
      lines.push(at('pay-a', `2026-10-${String(1 + rand(28)).padStart(2, '0')}`, -first), at('pay-b', '2026-11-10', first - owed));
      lines.sort((a, b) => a.statementOn.localeCompare(b.statementOn));
      for (const cycle of [{ start: '2026-08-21', end: '2026-09-20' }, { start: '2026-09-21', end: '2026-10-20' }]) {
        const cover = coverStatement({ lines: lines.filter((l) => l.poolMinor !== 0), cycle, today: '2026-11-12' });
        expect([...cover.values()].every((c) => c.whole)).toBe(true);
      }
    }
  });
});
