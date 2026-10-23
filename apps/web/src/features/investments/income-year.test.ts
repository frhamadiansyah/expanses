import { formatMinor } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { receivedThisYear, yearByHolding, yearSum } from './income-year';

// Invented figures: a holding bought last year, sold in part each year, paying once a year either side of 1 January.
const trade = (id: string, accountId: string, kind: TradeRow['kind'], occurredOn: string, unitsMicro: number, grossMinor: number, feeMinor = 0, taxMinor = 0): TradeRow =>
  ({ id, accountId, kind, occurredOn, createdAt: `${occurredOn}T09:00:00Z`, unitsMicro, grossMinor, feeMinor, taxMinor, status: 'active' }) as TradeRow;

const trades = [
  // 10 units at 100.000 each.
  trade('b1', 'shares', 'buy', '2025-03-01', 10_000_000, 1_000_000),
  // Last year's: 2 units for 250.000 realize 50.000, and a payment of 30.000.
  trade('s1', 'shares', 'sell', '2025-06-01', 2_000_000, 250_000),
  trade('d1', 'shares', 'income', '2025-12-20', 0, 30_000),
  // This year's: 4 units for 600.000 less a 5.000 fee realize 195.000, and 45.000 paid with 4.500 withheld.
  trade('s2', 'shares', 'sell', '2026-02-01', 4_000_000, 600_000, 5_000),
  trade('d2', 'shares', 'income', '2026-05-10', 0, 45_000, 0, 4_500),
  // A dollar holding: 1 unit bought at 50,00 and sold this year at 42,00, a loss.
  trade('b2', 'usd', 'buy', '2026-01-05', 1_000_000, 5_000),
  trade('s3', 'usd', 'sell', '2026-03-05', 1_000_000, 4_200),
];

const holdings = [
  { accountId: 'shares', currency: 'IDR' },
  { accountId: 'usd', currency: 'USD' },
  { accountId: 'idle', currency: 'IDR' },
];

describe('the year so far, per holding', () => {
  const year = yearByHolding(holdings, trades, '2026-10-23');

  it('counts only what was realized and paid since 1 January, at the average cost of the time', () => {
    expect(year.shares).toEqual({ realizedMinor: 195_000, incomeMinor: 40_500 });
  });

  it('keeps a loss as a loss, and a holding with nothing this year at nothing', () => {
    expect(year.usd).toEqual({ realizedMinor: -800, incomeMinor: 0 });
    expect(year.idle).toEqual({ realizedMinor: 0, incomeMinor: 0 });
  });

  it('reads last year as its own year when today is in it', () => {
    const then = trades.filter((row) => row.occurredOn < '2026-01-01');
    expect(yearByHolding(holdings, then, '2025-12-31').shares).toEqual({ realizedMinor: 50_000, incomeMinor: 30_000 });
  });
});

describe('the year added up', () => {
  const year = yearByHolding(holdings, trades, '2026-10-23');

  it('sums the base currency, and says another currency apart rather than adding it in', () => {
    expect(yearSum(holdings, year, 'realizedMinor', 'IDR')).toEqual({ base: 195_000, others: formatMinor(-800, 'USD') });
    expect(yearSum(holdings, year, 'incomeMinor', 'IDR')).toEqual({ base: 40_500, others: '' });
  });

  it('is nothing at all with no holdings', () => {
    expect(yearSum([], {}, 'incomeMinor', 'IDR')).toEqual({ base: 0, others: '' });
  });
});

describe('received this year, the estimate and the record together', () => {
  it('takes the larger of the two for a payer both know, and the record alone for a holding the estimate does not', () => {
    const estimated = [
      // A share held at two brokers, estimated before tax; recorded after it at one of them.
      { accountIds: ['bbca-stockbit', 'bbca-ipot'], minor: 50_000 },
      // A bond whose coupon was recorded before the estimate's day.
      { accountIds: ['ori'], minor: 0 },
      // Nothing recorded against it: the estimate stands.
      { accountIds: ['tlkm'], minor: 12_000 },
    ];
    const recorded = { 'bbca-stockbit': 45_000, ori: 47_250, 'fund-by-hand': 30_000 };
    expect(receivedThisYear(estimated, recorded)).toBe(50_000 + 47_250 + 12_000 + 30_000);
  });

  it('adds a payer’s holdings up before comparing, so two brokers’ records are not each matched against the whole', () => {
    expect(receivedThisYear([{ accountIds: ['a', 'b'], minor: 50_000 }], { a: 30_000, b: 30_000 })).toBe(60_000);
  });

  it('is nothing with nothing estimated or recorded', () => {
    expect(receivedThisYear([], {})).toBe(0);
    expect(receivedThisYear([{ accountIds: ['a'], minor: 0 }], {})).toBe(0);
  });
});
