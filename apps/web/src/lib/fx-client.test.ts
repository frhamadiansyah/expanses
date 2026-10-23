import { describe, expect, it, vi } from 'vitest';
import { frankfurterFetcher, thinWeekly, worldGoldSeries } from './fx-client';

describe('frankfurterFetcher', () => {
  it('requests the dated pair and returns the matching rate', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([
        { date: '2026-09-05', base: 'THB', quote: 'CNY', rate: 0.2037 },
        { date: '2026-09-05', base: 'THB', quote: 'IDR', rate: 536.49 },
      ])),
    );
    const fetcher = frankfurterFetcher(fetchImpl as unknown as typeof fetch);
    expect(await fetcher('THB', 'IDR', '2026-09-05')).toEqual({ rate: 536.49, sourceDate: '2026-09-05' });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rates?date=2026-09-05&base=THB&quotes=IDR');
  });

  it('throws on HTTP errors and missing pairs', async () => {
    await expect(frankfurterFetcher((async () => new Response('', { status: 500 })) as unknown as typeof fetch)('USD', 'IDR', '2026-09-05')).rejects.toThrow('500');
    await expect(frankfurterFetcher((async () => new Response('[]')) as unknown as typeof fetch)('USD', 'IDR', '2026-09-05')).rejects.toThrow('No USD->IDR');
  });
});

describe('worldGoldSeries', () => {
  const fake = (rows: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(rows), { status }));
  const asFetch = (impl: ReturnType<typeof fake>) => impl as unknown as typeof fetch;

  it('asks for the range and brings each ounce down to a whole-rupiah gram, oldest first', async () => {
    const fetchImpl = fake([
      { date: '2026-09-02', base: 'XAU', quote: 'IDR', rate: 62_208_953.6 },
      { date: '2026-09-01', base: 'XAU', quote: 'IDR', rate: 62_000_000 },
      { date: '2026-09-02', base: 'XAU', quote: 'USD', rate: 3_800 },
    ]);
    const days = await worldGoldSeries('IDR', '2026-09-01', '2026-09-05', asFetch(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rates?from=2026-09-01&to=2026-09-05&base=XAU&quotes=IDR');
    // 62.000.000 / 31,1034768 = 1.993.346,2… → Rp 1.993.346 a gram; IDR has no minor digits.
    expect(days).toEqual([
      { on: '2026-09-01', minor: 1_993_346 },
      { on: '2026-09-02', minor: 2_000_064 },
    ]);
  });

  it('keeps cents for a currency that has them', async () => {
    const days = await worldGoldSeries('USD', '2026-09-01', '2026-09-01', asFetch(fake([{ date: '2026-09-01', base: 'XAU', quote: 'USD', rate: 3_110.34768 }])));
    expect(days).toEqual([{ on: '2026-09-01', minor: 10_000 }]);
  });

  it('keeps one day a week past two years, and every day inside them', async () => {
    const rows = Array.from({ length: 28 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, '0')}`, base: 'XAU', quote: 'IDR', rate: 62_000_000 + index }));
    expect(await worldGoldSeries('IDR', '2025-09-01', '2026-09-28', asFetch(fake(rows)))).toHaveLength(28);
    const thinned = await worldGoldSeries('IDR', '2021-09-28', '2026-09-28', asFetch(fake(rows)));
    // 1–6 Sep closes on Sunday the 6th, then the 13th, 20th and 27th Sundays, then the 28th, the newest day.
    expect(thinned.map((day) => day.on)).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-09-28']);
  });

  it('throws when the service refuses or answers with nothing usable', async () => {
    await expect(worldGoldSeries('IDR', '2026-09-01', '2026-09-05', asFetch(fake('', 503)))).rejects.toThrow('503');
    await expect(worldGoldSeries('IDR', '2026-09-01', '2026-09-05', asFetch(fake({ message: 'not found' })))).rejects.toThrow('No world gold prices');
  });
});

describe('thinWeekly', () => {
  it('keeps the last day of each Monday-to-Sunday week, and the last day of all', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-09', '2026-10-12'].map((on) => ({ on }));
    expect(thinWeekly(days).map((day) => day.on)).toEqual(['2026-10-02', '2026-10-09', '2026-10-12']);
    expect(thinWeekly([])).toEqual([]);
  });
});
