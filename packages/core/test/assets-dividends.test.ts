import { describe, expect, it } from 'vitest';
import { parseYahooDividends } from '../src/prices/yahoo';
import { type DividendHolding, dividendView } from '../src/assets/dividends';

const LOTS = (lots: number) => lots * 100 * 1_000_000;

const holding = (over: Partial<DividendHolding>): DividendHolding => ({
  securityId: 'aaaa',
  title: 'AAAA',
  currency: 'IDR',
  unitsMicro: LOTS(10),
  unitsOn: () => LOTS(10),
  costBaseMinor: 5_000_000,
  valueBaseMinor: 6_000_000,
  payments: [],
  ...over,
});

const TODAY = '2026-10-21';

describe('dividendView', () => {
  it('counts the last 365 days at the shares held now, by month, with both yields', () => {
    const view = dividendView({
      today: TODAY,
      baseCurrency: 'IDR',
      ratesToBase: {},
      holdings: [
        holding({ payments: [{ exDate: '2025-10-20', perShare: 99 }, { exDate: '2025-11-12', perShare: 40 }, { exDate: '2026-05-04', perShare: 60 }] }),
      ],
    });
    // 2025-10-20 is over a year ago; 40 + 60 per share on 1.000 shares.
    expect(view.yearMinor).toBe(100_000);
    expect(view.yieldOnCostBps).toBe(200); // 100.000 of 5.000.000
    expect(view.yieldAtPriceBps).toBe(167);
    expect(view.months.find((m) => m.month === 11)).toEqual({ month: 11, minor: 40_000, titles: ['AAAA'] });
    expect(view.months).toHaveLength(12);
  });

  it('counts this year at the shares held the day before each ex-date', () => {
    const unitsOn = (date: string) => (date < '2026-06-01' ? LOTS(2) : LOTS(10));
    const view = dividendView({
      today: TODAY,
      baseCurrency: 'IDR',
      ratesToBase: {},
      holdings: [holding({ unitsOn, payments: [{ exDate: '2026-05-04', perShare: 50 }, { exDate: '2026-09-01', perShare: 10 }] })],
    });
    expect(view.receivedMinor).toBe(50 * 200 + 10 * 1_000);
  });

  it('owes last year’s payments this year has not matched, in order, and names their months', () => {
    const view = dividendView({
      today: TODAY,
      baseCurrency: 'IDR',
      ratesToBase: {},
      holdings: [
        holding({ payments: [{ exDate: '2025-05-02', perShare: 30 }, { exDate: '2025-11-20', perShare: 20 }, { exDate: '2026-05-06', perShare: 35 }] }),
        holding({ securityId: 'bbbb', title: 'BBBB', payments: [{ exDate: '2025-12-03', perShare: 5 }] }),
      ],
    });
    expect(view.toComeMinor).toBe(20_000 + 5_000);
    expect(view.toComeMonths).toEqual([11, 12]);
  });

  it('ranks who pays it with whole percents adding to 100, and leaves out a stock that paid nothing', () => {
    const view = dividendView({
      today: TODAY,
      baseCurrency: 'IDR',
      ratesToBase: {},
      holdings: [
        holding({ securityId: 'small', title: 'SMAL', payments: [{ exDate: '2026-03-01', perShare: 10 }] }),
        holding({ securityId: 'big', title: 'BIGG', payments: [{ exDate: '2026-04-01', perShare: 20 }] }),
        holding({ securityId: 'none', title: 'NONE', payments: [] }),
      ],
    });
    expect(view.payers.map((p) => [p.title, p.percent])).toEqual([['BIGG', 67], ['SMAL', 33]]);
    // A stock that pays nothing still sits in what was put in.
    expect(view.yieldOnCostBps).toBe(Math.round((30_000 * 10_000) / 15_000_000));
  });

  it('converts a foreign stock at the held rate, and names one with no history or no rate', () => {
    const view = dividendView({
      today: TODAY,
      baseCurrency: 'IDR',
      ratesToBase: { USD: 16_000 },
      holdings: [
        holding({ securityId: 'us', title: 'USCO', currency: 'USD', unitsMicro: 10_000_000, payments: [{ exDate: '2026-08-01', perShare: 0.25 }] }),
        holding({ securityId: 'off', title: 'OFFL', payments: null }),
        holding({ securityId: 'eu', title: 'EURO', currency: 'EUR', payments: [{ exDate: '2026-08-01', perShare: 1 }] }),
      ],
    });
    // 10 shares × US$0,25 = 250 cents = Rp 40.000.
    expect(view.yearMinor).toBe(40_000);
    expect(view.unknown).toEqual(['OFFL', 'EURO']);
  });

  it('has no yield on cost when a cost is not known', () => {
    const view = dividendView({ today: TODAY, baseCurrency: 'IDR', ratesToBase: {}, holdings: [holding({ costBaseMinor: null, payments: [{ exDate: '2026-02-01', perShare: 1 }] })] });
    expect(view.yieldOnCostBps).toBeNull();
  });
});

describe('parseYahooDividends', () => {
  const body = (currency: string, dividends?: Record<string, unknown>) => ({
    chart: { result: [{ meta: { currency, exchangeTimezoneName: 'Asia/Jakarta', gmtoffset: 25200 }, events: dividends ? { dividends } : undefined }] },
  });

  it('reads each ex-date on the exchange’s calendar, oldest first', () => {
    // 2026-05-03 17:30 UTC is 4 May in Jakarta.
    const at = Date.UTC(2026, 4, 3, 17, 30) / 1000;
    const earlier = Date.UTC(2025, 10, 20, 2) / 1000;
    expect(parseYahooDividends(body('IDR', { [at]: { amount: 42.5, date: at }, [earlier]: { amount: 10, date: earlier } }), { currency: 'IDR' })).toEqual([
      { exDate: '2025-11-20', perShare: 10 },
      { exDate: '2026-05-04', perShare: 42.5 },
    ]);
  });

  it('reads no dividends as none, and refuses another currency', () => {
    expect(parseYahooDividends(body('IDR'), { currency: 'IDR' })).toEqual([]);
    expect(() => parseYahooDividends(body('USD'), { currency: 'IDR' })).toThrow(/USD/);
  });
});
