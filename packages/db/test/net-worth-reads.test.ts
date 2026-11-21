import { lastNMonths } from '@expanses/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nativeBalances, nativeBalancesOn, netWorthAt, netWorthSeries, sheetInputsAt } from '../src/index';
import { setupDb, type TestDb } from './helpers';
import { seedSampleData } from './sample/seed';

/*
 * Net worth's reads, on the dev sample (an invented household): the line is worked out from one read of everything
 * instead of one read a month, and its figures must be the ones it gave before.
 */

const TODAY = '2026-11-20';
const RATES = { USD: 16_280, SGD: 12_540, THB: 455 };

let current: TestDb;
let statements = 0;

beforeAll(async () => {
  // The sample is dated from the clock in places; held still, the household is the same on every run.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T09:00:00`) });
  current = await setupDb();
  const query = current.executor.query.bind(current.executor);
  current.executor.query = (sql, params, method) => {
    statements += 1;
    return query(sql, params, method);
  };
  await seedSampleData(current.database, current.ws, TODAY);
}, 120_000);

afterAll(() => {
  current.executor.close();
  vi.useRealTimers();
});

describe('net worth on the sample household', () => {
  it('gives the totals it gave before the line was read in one pass', async () => {
    const { database, ws } = current;
    const sheet = await sheetInputsAt(database, ws, TODAY, RATES);
    // Worked out by the reads as they were before this change (one full read a month), on this same sample and day.
    expect(sheet.assets.reduce((total, row) => total + row.valueMinor, 0)).toBe(2_789_526_949);
    expect(sheet.liabilities.reduce((total, row) => total + row.balanceMinor, 0)).toBe(923_160_250);
    expect(sheet.assets.length + sheet.liabilities.length).toBe(38);
    expect(sheet.missing).toEqual([]);
    const series = await netWorthSeries(database, ws, lastNMonths('2026-11', 12), RATES, TODAY);
    expect(series.map((point) => [point.month, point.assetsMinor, point.liabilitiesMinor, point.netWorthMinor])).toEqual([
      ['2025-12', 2_580_207_373, 827_100_000, 1_753_107_373],
      ['2026-01', 2_580_207_373, 827_100_000, 1_753_107_373],
      ['2026-02', 2_611_496_294, 827_100_000, 1_784_396_294],
      ['2026-03', 2_611_496_294, 827_100_000, 1_784_396_294],
      ['2026-04', 2_611_496_294, 827_100_000, 1_784_396_294],
      ['2026-05', 2_641_959_948, 842_100_000, 1_799_859_948],
      ['2026-06', 2_641_959_948, 842_100_000, 1_799_859_948],
      ['2026-07', 2_641_959_948, 844_100_000, 1_797_859_948],
      ['2026-08', 2_702_647_624, 910_316_500, 1_792_331_124],
      ['2026-09', 2_717_324_607, 931_050_000, 1_786_274_607],
      ['2026-10', 2_737_236_589, 936_824_000, 1_800_412_589],
      ['2026-11', 2_789_526_949, 923_160_250, 1_866_366_699],
    ]);
  });

  it('gives each month exactly what that day on its own gives, stack and all', async () => {
    const { database, ws } = current;
    const months = lastNMonths('2026-11', 14);
    const series = await netWorthSeries(database, ws, months, RATES, TODAY);
    for (const point of series) expect(point).toEqual({ month: point.month, onDate: point.onDate, ...(await netWorthAt(database, ws, point.onDate, RATES)) });
    // A rate missing reads the same way through both: no figure, the currency named.
    const unrated = await netWorthSeries(database, ws, months.slice(-3), {}, TODAY);
    for (const point of unrated) expect(point).toEqual({ month: point.month, onDate: point.onDate, ...(await netWorthAt(database, ws, point.onDate, {})) });
  });

  it('adds the ledger up for many days at once as it does for each day', async () => {
    const { database, ws } = current;
    const days = ['2025-08-01', '2026-02-28', '2026-11-20', '2026-10-31', '2026-10-31', '2026-11-19'];
    const together = await nativeBalancesOn(database, ws, days);
    for (const day of days) expect(together.get(day)).toEqual(await nativeBalances(database, ws, day));
    expect((await nativeBalancesOn(database, ws, [])).size).toBe(0);
  });

  it('reads as much for five years of the line as for six months', async () => {
    const { database, ws } = current;
    statements = 0;
    await netWorthSeries(database, ws, lastNMonths('2026-11', 6), RATES, TODAY);
    const six = statements;
    statements = 0;
    await netWorthSeries(database, ws, lastNMonths('2026-11', 60), RATES, TODAY);
    expect(statements).toBe(six);
  });
});
