import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Ms } from '../src/ids';
import { type ChargeCover, type CoverCharge, type CoverCredit, coverOldestFirst, coverStatement, type PoolLine, RECORDED_TOGETHER_MS, recordedRanks } from '../src/statement/cover';

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
    // How many payments went into each: the one split across both counts two.
    expect(['market', 'ride', 'shop', 'dinner'].map((key) => cover.get(key)!.credits)).toEqual([1, 1, 2, 1]);
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
    // Credit carried from before counts as no payment; the two listed both went into the second purchase.
    expect(cover.get('one')!.credits).toBe(0);
    expect(cover.get('two')!.credits).toBe(2);
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

// When each line was recorded, as its id's time: invented minutes on an invented day.
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 24, 9, 0, 0);
const rec = (key: string, statementOn: string, poolMinor: number, minute: number | null): PoolLine => ({ key, statementOn, poolMinor, recordedMs: minute === null ? null : T0 + minute * MIN });
const NOV = { start: '2026-10-21', end: '2026-11-20' };
const DEC = { start: '2026-11-21', end: '2026-12-20' };

describe('a payment pays first what was on the card when it was recorded', () => {
  it('the owner’s case: purchases recorded after the payment, though older, leave its cover with the three it paid', () => {
    const lines = [
      rec('a', '2026-11-23', 400_000, 0),
      rec('b', '2026-11-23', 350_000, 1),
      rec('c', '2026-11-23', 250_000, 2),
      rec('pay', '2026-11-24', -1_000_000, 10),
      // Recorded a day later, dated before the three.
      rec('old-1', '2026-11-22', 120_000, 24 * 60),
      rec('old-2', '2026-11-22', 80_000, 24 * 60 + 3),
    ];
    const cover = coverStatement({ lines, cycle: DEC, today: '2026-11-25' });
    for (const key of ['a', 'b', 'c']) expect(cover.get(key)).toMatchObject({ whole: true, leftMinor: 0, credit: { key: 'pay' }, credits: 1 });
    for (const key of ['old-1', 'old-2']) expect(cover.get(key)).toMatchObject({ whole: false, coveredMinor: 0, credit: null });
    expect(cover.get('old-1')!.leftMinor).toBe(120_000);
  });

  it('what is over of a payment goes on to the charges recorded after it, oldest first', () => {
    const lines = [
      rec('a', '2026-11-23', 600_000, 0),
      rec('pay', '2026-11-24', -800_000, 5),
      rec('later-new', '2026-11-22', 150_000, 60),
      rec('later-old', '2026-11-21', 100_000, 90),
    ];
    const cover = coverStatement({ lines, cycle: DEC, today: '2026-11-26' });
    expect(cover.get('a')).toMatchObject({ whole: true, credit: { key: 'pay' } });
    // Rp 200.000 over: the older of the two recorded after it first, whole, then Rp 100.000 of the newer.
    expect(cover.get('later-old')).toMatchObject({ whole: true, coveredMinor: 100_000, credit: { key: 'pay' } });
    expect(cover.get('later-new')).toMatchObject({ whole: false, coveredMinor: 100_000, leftMinor: 50_000 });
  });

  it('rows recorded together (a paste, a statement check) count as recorded together: the payment covers its purchases', () => {
    // A newer purchase was on the card already; the paste holds the payment first, then its purchases, seconds apart.
    const at = (minute: number, seconds: number) => minute + seconds / 60;
    const lines = [
      rec('before', '2026-11-25', 200_000, 0),
      rec('pay', '2026-11-24', -500_000, at(30, 0)),
      rec('p1', '2026-11-23', 200_000, at(30, 1)),
      rec('p2', '2026-11-21', 300_000, at(30, 3)),
    ];
    const cover = coverStatement({ lines, cycle: DEC, today: '2026-11-26' });
    // One run of rows a few seconds apart: all on the card for the payment, oldest first by date.
    expect(cover.get('p2')).toMatchObject({ whole: true, credit: { key: 'pay' } });
    expect(cover.get('p1')).toMatchObject({ whole: true, credit: { key: 'pay' } });
    expect(cover.get('before')).toMatchObject({ coveredMinor: 0 });
  });

  it('a row recorded well after the run is not part of it', () => {
    const lines = [rec('pay', '2026-11-24', -300_000, 0), rec('p1', '2026-11-23', 300_000, 0.05), rec('late', '2026-11-22', 300_000, 2)];
    const cover = coverStatement({ lines, cycle: DEC, today: '2026-11-25' });
    expect(cover.get('p1')).toMatchObject({ whole: true, credit: { key: 'pay' } });
    expect(cover.get('late')).toMatchObject({ coveredMinor: 0 });
  });

  it('a second payment pays what was on the card when it was recorded before what came after it', () => {
    const lines = [
      rec('a', '2026-11-22', 500_000, 0),
      rec('pay-1', '2026-11-23', -300_000, 10),
      rec('b', '2026-11-25', 400_000, 20),
      rec('pay-2', '2026-11-26', -400_000, 30),
      rec('c', '2026-11-21', 200_000, 40),
    ];
    const cover = coverStatement({ lines, cycle: DEC, today: '2026-11-27' });
    // Pay 1 pays Rp 300.000 of A; pay 2 the Rp 200.000 left of A, then Rp 200.000 of B; C, recorded last, nothing.
    expect(cover.get('a')).toMatchObject({ whole: true, credit: { key: 'pay-2' }, credits: 2 });
    expect(cover.get('b')).toMatchObject({ coveredMinor: 200_000, leftMinor: 200_000 });
    expect(cover.get('c')).toMatchObject({ coveredMinor: 0 });
  });

  it('a payment recorded before its purchases covers them, as one recorded after would', () => {
    const lines = [rec('pay', '2026-11-24', -500_000, 0), rec('x', '2026-11-25', 200_000, 60), rec('y', '2026-11-22', 300_000, 120)];
    const cover = coverStatement({ lines, cycle: DEC, today: '2026-11-26' });
    expect(cover.get('x')).toMatchObject({ whole: true, credit: { key: 'pay' } });
    expect(cover.get('y')).toMatchObject({ whole: true, credit: { key: 'pay' } });
  });

  it('only the payments that reach the statement draw the line: one that paid the older bill does not', () => {
    // Pay-old (recorded between X and Y) cleared what was owed before November; the closing payment covers both, by date.
    const lines = [
      rec('before', '2026-10-15', 400_000, 0),
      rec('x', '2026-11-05', 200_000, 10),
      rec('pay-old', '2026-11-06', -400_000, 20),
      rec('y', '2026-11-01', 300_000, 30),
      rec('pay-nov', '2026-11-25', -300_000, 40),
    ];
    const cover = coverStatement({ lines, cycle: NOV, today: '2026-11-26' });
    expect(cover.get('y')).toMatchObject({ whole: true, credit: { key: 'pay-nov' } });
    expect(cover.get('x')).toMatchObject({ coveredMinor: 0 });
  });

  it('a row whose id carries no record time counts as on the card all along', () => {
    const lines = [rec('pay', '2026-11-24', -100_000, 10), rec('timeless', '2026-11-23', 100_000, null), rec('later', '2026-11-22', 100_000, 20)];
    const cover = coverStatement({ lines, cycle: DEC, today: '2026-11-25' });
    expect(cover.get('timeless')).toMatchObject({ whole: true });
    expect(cover.get('later')).toMatchObject({ coveredMinor: 0 });
  });

  it('whatever the record order, the covered and the left add up to the same figures as by date alone', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      let r = seed;
      const rand = (n: number) => {
        r = (r * 1_103_515_245 + 12_345) % 2_147_483_648;
        return r % n;
      };
      const lines: PoolLine[] = [];
      for (let i = 0; i < 2 + rand(8); i += 1) {
        const credit = rand(3) === 0;
        const day = `2026-${rand(2) === 0 ? '10' : '11'}-${String(1 + rand(28)).padStart(2, '0')}`;
        lines.push(rec(`l${i}`, day, (credit ? -1 : 1) * (1 + rand(50)) * 10_000, rand(4) === 0 ? null : rand(600)));
      }
      for (const cycle of [NOV, { start: '2026-09-21', end: '2026-10-20' }]) {
        const byRecord = coverStatement({ lines, cycle, today: '2026-11-28' });
        const byDate = coverStatement({ lines: lines.map(({ recordedMs: _, ...line }) => line), cycle, today: '2026-11-28' });
        const total = (m: Map<string, { coveredMinor: number; leftMinor: number }>) => [...m.values()].reduce((s, c) => [s[0]! + c.coveredMinor, s[1]! + c.leftMinor], [0, 0]);
        expect([...byRecord.keys()].sort()).toEqual([...byDate.keys()].sort());
        expect(total(byRecord)).toEqual(total(byDate));
      }
    }
  });

  it('with every line recorded in date order, the cover is exactly what the dates alone give', () => {
    const lines = [
      rec('old', '2026-09-02', 500_000, 0),
      rec('market', '2026-10-02', 412_000, 10),
      rec('pay-a', '2026-10-05', -700_000, 20),
      rec('ride', '2026-10-06', 185_000, 30),
      rec('shop', '2026-10-09', 649_000, 40),
      rec('pay-b', '2026-10-25', -600_000, 50),
      rec('dinner', '2026-10-27', 280_000, 60),
      rec('pay-c', '2026-11-10', -400_000, 70),
    ];
    for (const cycle of [{ start: '2026-08-21', end: '2026-09-20' }, { start: '2026-09-21', end: '2026-10-20' }, NOV]) {
      const plain = (m: Map<string, ChargeCover>) => [...m].map(([key, c]) => [key, c.coveredMinor, c.leftMinor, c.whole, c.credit?.key ?? null, c.credits]);
      const byDate = coverStatement({ lines: lines.map(({ recordedMs: _, ...line }) => line), cycle, today: '2026-11-12' });
      expect(plain(coverStatement({ lines, cycle, today: '2026-11-12' }))).toEqual(plain(byDate));
    }
  });
});

describe('when a line was recorded', () => {
  it('reads the millisecond a UUIDv7 was made at, and nothing from any other id', () => {
    const at = Date.UTC(2026, 10, 24, 9, 15, 30, 123);
    expect(uuidv7Ms(uuidv7(at))).toBe(at);
    // A v5 id (named by what it is for) and a v4 id carry no time.
    expect(uuidv7Ms('9b2f1c3e-4a5d-5e6f-8a7b-0c1d2e3f4a5b')).toBeNull();
    expect(uuidv7Ms('9b2f1c3e-4a5d-4e6f-8a7b-0c1d2e3f4a5b')).toBeNull();
    expect(uuidv7Ms('not-an-id')).toBeNull();
  });

  it('ranks rows a few seconds apart as one run, and a row after a longer gap as the next', () => {
    const ranks = recordedRanks([10_000, 0, 4_000, 8_500, 30_000, 34_999, 39_000, 44_001]);
    expect([0, 4_000, 8_500, 10_000, 30_000, 34_999, 39_000, 44_001].map((t) => ranks.get(t))).toEqual([0, 0, 0, 0, 1, 1, 1, 2]);
    expect(recordedRanks([0, RECORDED_TOGETHER_MS + 1]).get(RECORDED_TOGETHER_MS + 1)).toBe(1);
  });
});
