import { describe, expect, it } from 'vitest';
import { assetValueAt, tradeCashMinor, tradeCashMovedMinor, type ValuationRow, moneyFlows, moneyPositionAfter, moneySellBasis, navAnchors, tradeDescription, tradePostings, type TradeRecord } from '../src/index';

const trade = (id: string, kind: TradeRecord['kind'], occurredOn: string, grossMinor: number, extra: Partial<TradeRecord> = {}): TradeRecord => ({
  id,
  accountId: 'fund',
  kind,
  occurredOn,
  createdAt: `${occurredOn}T00:00:00Z`,
  unitsMicro: 0,
  grossMinor,
  feeMinor: 0,
  taxMinor: 0,
  ...extra,
});

/** The owner's own example: 1.000.000 in, Bibit says 1.052.000, 500.000 more, then half the value out. */
const bought = [trade('b1', 'buy', '2026-08-01', 1_000_000), trade('b2', 'buy', '2026-10-05', 500_000)];
const typed: ValuationRow[] = [{ asOf: '2026-10-01', valueMinor: 1_052_000, basis: 'estimate' }];
const valueOn = (trades: TradeRecord[], date: string, valuations = typed) =>
  assetValueAt({ accountId: 'fund', mode: 'amount', currency: 'IDR', ledgerBalanceMinor: 0, position: moneyPositionAfter(trades, date), valuations, flows: moneyFlows(trades) }, date);

describe('a fund tracked by money', () => {
  it('is worth the money put in until a value is typed', () => {
    expect(valueOn(bought, '2026-09-01', [])).toMatchObject({ valueMinor: 1_000_000, costMinor: 1_000_000, source: 'cost' });
  });

  it('is worth the typed value, moved by every buy after it', () => {
    expect(valueOn(bought, '2026-10-01')).toMatchObject({ valueMinor: 1_052_000, costMinor: 1_000_000, source: 'valuation', asOf: '2026-10-01' });
    expect(valueOn(bought, '2026-10-05')).toMatchObject({ valueMinor: 1_552_000, costMinor: 1_500_000 });
  });

  it('takes out the same share of the money as of the value when it sells, and books the rest as profit', () => {
    const basis = moneySellBasis(1_500_000, 1_552_000, 776_000);
    expect(basis).toBe(750_000);
    const after = [...bought, trade('s1', 'sell', '2026-10-10', 776_000, { basisMinor: basis })];
    expect(valueOn(after, '2026-10-10')).toMatchObject({ valueMinor: 776_000, costMinor: 750_000 });
    expect(moneyPositionAfter(after).realizedMinor).toBe(26_000);
  });

  it('takes all the money when a sell takes all the value, or more', () => {
    expect(moneySellBasis(1_500_000, 1_552_000, 1_552_000)).toBe(1_500_000);
    expect(moneySellBasis(1_500_000, 1_552_000, 1_600_000)).toBe(1_500_000);
    expect(moneySellBasis(1_500_000, 0, 10_000)).toBe(1_500_000);
    expect(moneySellBasis(0, 0, 10_000)).toBe(0);
  });

  it('counts a value typed on a day as already holding that day’s buys', () => {
    const sameDay = [{ asOf: '2026-10-05', valueMinor: 1_560_000, basis: 'estimate' as const }];
    expect(valueOn(bought, '2026-10-05', sameDay).valueMinor).toBe(1_560_000);
  });

  it('keeps a sell’s profit when something earlier changes: the basis it was saved with stands', () => {
    const sold = trade('s1', 'sell', '2026-10-10', 776_000, { basisMinor: 750_000 });
    const withLateEntry = [...bought, trade('b0', 'buy', '2026-07-01', 200_000), sold];
    expect(moneyPositionAfter(withLateEntry).realizedMinor).toBe(26_000);
  });

  it('gives a sell from the units days the average cost of the units it sold', () => {
    const units = [
      trade('u1', 'buy', '2025-01-01', 1_000_000, { unitsMicro: 1_000_000_000 }),
      trade('u2', 'sell', '2025-06-01', 600_000, { unitsMicro: 500_000_000 }),
      trade('m1', 'buy', '2026-01-01', 300_000),
    ];
    expect(moneyPositionAfter(units)).toMatchObject({ costMinor: 800_000, realizedMinor: 100_000 });
  });

  it('books a buy with no units, and a sell’s cost as the caller worked it out', () => {
    const accounts = { holdingAccountId: 'fund', holdingCurrency: 'IDR', cashAccountId: 'bank', cashCurrency: 'IDR', realizedGainsCategoryId: 'gain', investmentIncomeCategoryId: 'inc', finalTaxCategoryId: 'tax' };
    const position = moneyPositionAfter(bought);
    expect(tradePostings({ kind: 'buy', occurredOn: '2026-10-05', unitsMicro: 0, grossMinor: 500_000, feeMinor: 0, taxMinor: 0, byMoney: {} }, position, accounts)).toEqual([
      { accountId: 'fund', amountMinor: 500_000, currency: 'IDR' },
      { accountId: 'bank', amountMinor: -500_000, currency: 'IDR' },
    ]);
    expect(tradePostings({ kind: 'sell', occurredOn: '2026-10-10', unitsMicro: 0, grossMinor: 776_000, feeMinor: 0, taxMinor: 0, byMoney: { basisMinor: 750_000 } }, position, accounts)).toEqual([
      { accountId: 'bank', amountMinor: 776_000, currency: 'IDR' },
      { accountId: 'fund', amountMinor: -750_000, currency: 'IDR' },
      { accountId: 'gain', amountMinor: -26_000, currency: 'IDR' },
    ]);
    expect(tradeDescription({ kind: 'buy', occurredOn: '2026-10-05', unitsMicro: 0, grossMinor: 500_000, feeMinor: 0, taxMinor: 0 }, 'Sucor Money Market')).toBe('Bought Sucor Money Market');
  });

  it('still refuses a buy with no units on a holding tracked by units', () => {
    const accounts = { holdingAccountId: 'fund', holdingCurrency: 'IDR', cashAccountId: 'bank', cashCurrency: 'IDR', realizedGainsCategoryId: 'gain', investmentIncomeCategoryId: 'inc', finalTaxCategoryId: 'tax' };
    expect(() => tradePostings({ kind: 'buy', occurredOn: '2026-10-05', unitsMicro: 0, grossMinor: 500_000, feeMinor: 0, taxMinor: 0 }, moneyPositionAfter([]), accounts)).toThrow();
  });

  it('turns the NAVs typed before into values on their days, so the units days keep their history', () => {
    const units = [trade('u1', 'buy', '2025-01-01', 1_000_000, { unitsMicro: 1_000_000_000 }), trade('m1', 'buy', '2026-01-01', 300_000)];
    const anchors = navAnchors(units, [
      { onDate: '2024-12-31', priceMicro: 1_100_000_000 },
      { onDate: '2025-12-31', priceMicro: 1_200_000_000 },
    ]);
    expect(anchors).toEqual([{ asOf: '2025-12-31', valueMinor: 1_200_000, basis: 'estimate' }]);
    // A money buy after the last NAV moves the value on from it.
    expect(valueOn(units, '2026-01-01', anchors).valueMinor).toBe(1_500_000);
  });

  it('on the day a value is typed, adds only the buys saved after it: the value saw the ones before', () => {
    // b2 (5 Oct) was saved at 00:00 that day.
    const typedLater: ValuationRow[] = [{ asOf: '2026-10-05', valueMinor: 1_560_000, basis: 'estimate', createdAt: '2026-10-05T09:00:00Z' }];
    expect(valueOn(bought, '2026-10-05', typedLater).valueMinor).toBe(1_560_000);
    const typedEarlier: ValuationRow[] = [{ asOf: '2026-10-05', valueMinor: 1_052_000, basis: 'estimate', createdAt: '2026-10-04T23:00:00Z' }];
    expect(valueOn(bought, '2026-10-05', typedEarlier).valueMinor).toBe(1_552_000);
  });

  it('reads the cash side of a buy and a sell with no units', () => {
    expect(tradeCashMinor({ kind: 'buy', occurredOn: '2026-10-05', unitsMicro: 0, grossMinor: 500_000, feeMinor: 0, taxMinor: 0 })).toBe(500_000);
    expect(tradeCashMinor({ kind: 'sell', occurredOn: '2026-10-10', unitsMicro: 0, grossMinor: 776_000, feeMinor: 0, taxMinor: 0 })).toBe(776_000);
    expect(tradeCashMovedMinor({ kind: 'sell', occurredOn: '2026-10-10', unitsMicro: 0, grossMinor: 776_000, feeMinor: 0, taxMinor: 0 })).toBe(776_000);
  });
});
