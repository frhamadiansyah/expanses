import { describe, expect, it } from 'vitest';
import { parseYahooChart, yahooChartUrl, yahooSymbol } from '../src/index';

/** A chart as Yahoo sends it for BBCA.JK on Wednesday 30 Sep 2026, trimmed to what is read. Bars open 09:00 WIB. */
const chart = (o: { currency?: string; closes?: (number | null)[] } = {}) => ({
  chart: {
    result: [
      {
        meta: {
          currency: o.currency ?? 'IDR',
          symbol: 'BBCA.JK',
          exchangeTimezoneName: 'Asia/Jakarta',
          gmtoffset: 25200,
          // 16:14:57 WIB: a few seconds short of the session end, even after the close.
          regularMarketTime: 1790759697,
          regularMarketPrice: 6075,
          currentTradingPeriod: { regular: { start: 1790733600, end: 1790759700 } },
        },
        // Thu 24, Fri 25, Mon 28, Tue 29, Wed 30 Sep 2026, 09:00 WIB.
        timestamp: [1790215200, 1790301600, 1790560800, 1790647200, 1790733600],
        indicators: { quote: [{ close: o.closes ?? [6225, 6250, 6225, 6150, 6075] }] },
      },
    ],
    error: null,
  },
});
const wib = (iso: string) => new Date(`${iso}+07:00`);

describe('the Yahoo symbol', () => {
  it('is TICKER.JK on IDX, the plain ticker in the US, and nothing elsewhere', () => {
    expect(yahooSymbol({ ticker: 'BBCA', market: 'IDX', currency: 'IDR' })).toBe('BBCA.JK');
    expect(yahooSymbol({ ticker: 'bbri', market: '', currency: 'IDR' })).toBe('BBRI.JK');
    expect(yahooSymbol({ ticker: 'AAPL', market: 'NASDAQ', currency: 'USD' })).toBe('AAPL');
    expect(yahooSymbol({ ticker: 'BRK.B', market: 'NYSE', currency: 'USD' })).toBe('BRK-B');
    expect(yahooSymbol({ ticker: null, market: 'IDX', currency: 'IDR' })).toBeNull();
    expect(yahooSymbol({ ticker: 'X', market: 'OTC', currency: 'USD' })).toBeNull();
    expect(yahooChartUrl('BBCA.JK')).toBe('https://query1.finance.yahoo.com/v8/finance/chart/BBCA.JK?range=5d&interval=1d');
  });
});

describe('the close a chart gives', () => {
  it('takes yesterday’s close while today’s session is still open', () => {
    expect(parseYahooChart(chart(), { currency: 'IDR', now: wib('2026-09-30T14:00:00') })).toEqual({ onDate: '2026-09-29', close: 6150 });
  });

  it('takes today’s close once the session has ended, though regularMarketTime sits seconds before its end', () => {
    expect(parseYahooChart(chart(), { currency: 'IDR', now: wib('2026-09-30T18:00:00') })).toEqual({ onDate: '2026-09-30', close: 6075 });
  });

  it('skips a day with no close', () => {
    const closes = [6225, 6250, 6225, null, null];
    expect(parseYahooChart(chart({ closes }), { currency: 'IDR', now: wib('2026-09-30T18:00:00') })).toEqual({ onDate: '2026-09-28', close: 6225 });
  });

  it('reads the day in the exchange’s timezone, not UTC', () => {
    // 09:00 WIB on 30 Sep is 02:00 UTC the same day; on a Saturday morning the last bar is Friday's, whatever UTC says.
    expect(parseYahooChart(chart({ closes: [6225, 6250, null, null, null] }), { currency: 'IDR', now: wib('2026-10-03T08:00:00') })).toEqual({ onDate: '2026-09-25', close: 6250 });
  });

  it('refuses a close in another currency than the holding’s', () => {
    expect(() => parseYahooChart(chart({ currency: 'USD' }), { currency: 'IDR', now: wib('2026-09-30T18:00:00') })).toThrow(/USD.*IDR/);
  });

  it('refuses a chart with nothing finished in it, or no chart at all', () => {
    expect(() => parseYahooChart(chart({ closes: [null, null, null, null, 6075] }), { currency: 'IDR', now: wib('2026-09-30T10:00:00') })).toThrow(/no finished close/);
    expect(() => parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } }, { currency: 'IDR', now: new Date() })).toThrow(/no chart/);
  });
});
