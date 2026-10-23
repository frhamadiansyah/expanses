import { tradeCashMinor } from '@expanses/core';
import type { RecordTradeInput } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { SPLIT } from './goal-parts-form';
import { cashAtRate, detailMinor, emptyTradeDetails, pairRate, type TradeDetailsDraft, withDetails } from './trade-details';

const gold = (kind: 'buy' | 'sell', grossMinor: number, extra: Partial<RecordTradeInput> = {}): RecordTradeInput => ({
  accountId: 'antam', kind, occurredOn: '2026-05-04', unitsMicro: 5_000_000, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: 'bank', goalId: null, ...extra,
});
const details = (patch: Partial<TradeDetailsDraft> = {}): TradeDetailsDraft => ({ ...emptyTradeDetails(), ...patch });
const idr = { holdingCurrency: 'IDR', cashCurrency: 'IDR', baseCurrency: 'IDR', byMoney: false };

describe('withDetails', () => {
  it('leaves the trade as the sheet made it when nothing is typed behind the toggle', () => {
    expect(withDetails(gold('buy', 9_350_000), details(), idr)).toEqual(gold('buy', 9_350_000));
  });

  it('puts the fee on top of the total paid: the cost is the two together', () => {
    const input = withDetails(gold('buy', 9_350_000), details({ fee: '42.500' }), idr);
    expect(input.feeMinor).toBe(42_500);
    expect(input.grossMinor).toBe(9_350_000);
    expect(tradeCashMinor(input)).toBe(9_392_500);
  });

  it('takes a sell’s fee and tax withheld off what reaches the account', () => {
    const input = withDetails(gold('sell', 8_700_000), details({ fee: '15.000', tax: '130.500' }), idr);
    expect([input.feeMinor, input.taxMinor]).toEqual([15_000, 130_500]);
    expect(tradeCashMinor(input)).toBe(8_554_500);
  });

  it('keeps a listed share’s worked-out fee and tax while those rows are empty, and a typed one replaces it', () => {
    const listed = gold('sell', 6_150_000, { feeMinor: 9_225, taxMinor: 6_150 });
    expect(withDetails(listed, details(), idr)).toMatchObject({ feeMinor: 9_225, taxMinor: 6_150 });
    expect(withDetails(listed, details({ fee: '7.000' }), idr)).toMatchObject({ feeMinor: 7_000, taxMinor: 6_150 });
  });

  it('refuses a fee that is not an amount, in the row’s own name', () => {
    expect(() => withDetails(gold('buy', 9_350_000), details({ fee: 'abc' }), idr)).toThrow('Fee must be an amount');
    expect(() => withDetails(gold('buy', 9_350_000), details({ tax: 'x' }), idr)).toThrow('Tax withheld must be an amount');
  });

  it('carries the goal, or the split between goals by units', () => {
    expect(withDetails(gold('buy', 9_350_000), details({ goalId: 'hajj' }), idr).goalId).toBe('hajj');
    const split = withDetails(
      gold('sell', 8_700_000),
      details({ goalId: SPLIT, parts: [{ goalId: 'hajj', amount: '3' }, { goalId: 'school', amount: '2' }] }),
      idr,
    );
    expect(split.goalId).toBeNull();
    expect(split.goalParts).toEqual([
      { goalId: 'hajj', unitsMicro: 3_000_000, moneyMinor: 0 },
      { goalId: 'school', unitsMicro: 2_000_000, moneyMinor: 0 },
    ]);
  });

  it('splits a fund tracked by money by its amount', () => {
    const input = withDetails(
      gold('buy', 500_000, { unitsMicro: 0 }),
      details({ goalId: SPLIT, parts: [{ goalId: 'hajj', amount: '200.000' }] }),
      { ...idr, byMoney: true },
    );
    expect(input.goalParts).toEqual([{ goalId: 'hajj', unitsMicro: 0, moneyMinor: 200_000 }]);
  });

  it('refuses parts that take more than the trade', () => {
    expect(() => withDetails(gold('buy', 9_350_000), details({ goalId: SPLIT, parts: [{ goalId: 'hajj', amount: '6' }] }), idr)).toThrow(/more than this trade/);
  });

  it('asks for the rate that day when the money account is in another currency, and converts what moved at it', () => {
    const usdCash = { ...idr, cashCurrency: 'USD' };
    expect(() => withDetails(gold('buy', 9_350_000), details(), usdCash)).toThrow('Type the rate that day');
    expect(() => withDetails(gold('buy', 9_350_000), details({ rate: 'lots' }), usdCash)).toThrow('Rate that day must be a number');
    // Rp 9.350.000 + Rp 50.000 fee left a dollar account at Rp 16.000 a dollar: US$587,50.
    expect(withDetails(gold('buy', 9_350_000), details({ fee: '50.000', rate: '16000' }), usdCash).cashMinor).toBe(58_750);
  });

  it('a dollar holding paid from a rupiah account reads the rate as rupiah per dollar', () => {
    const usdFund = { holdingCurrency: 'USD', cashCurrency: 'IDR', baseCurrency: 'IDR', byMoney: false };
    expect(withDetails(gold('buy', 50_000), details({ rate: '16300' }), usdFund).cashMinor).toBe(8_150_000);
  });

  it('a sell whose fee took all of it moves nothing, so no rate is asked', () => {
    const input = withDetails(gold('sell', 100_000), details({ fee: '100.000' }), { ...idr, cashCurrency: 'USD' });
    expect(input.cashMinor).toBeUndefined();
  });
});

describe('pairRate', () => {
  it('reads in the workspace’s currency per one of the other, either way round', () => {
    expect(pairRate('USD', 'IDR', 'IDR')).toEqual({ from: 'USD', to: 'IDR' });
    expect(pairRate('IDR', 'USD', 'IDR')).toEqual({ from: 'USD', to: 'IDR' });
  });
  it('with neither in the workspace’s currency, the account’s currency per one of the holding’s; none for one currency', () => {
    expect(pairRate('USD', 'SGD', 'IDR')).toEqual({ from: 'USD', to: 'SGD' });
    expect(pairRate('IDR', 'IDR', 'IDR')).toBeNull();
  });
});

describe('cashAtRate', () => {
  it('converts both ways round at the same typed rupiah-per-dollar rate', () => {
    expect(cashAtRate(1_000, 'USD', 'IDR', 'IDR', 16_300)).toBe(163_000);
    expect(cashAtRate(163_000, 'IDR', 'USD', 'IDR', 16_300)).toBe(1_000);
  });
});

describe('detailMinor', () => {
  it('an empty row stands for its fallback', () => {
    expect(detailMinor('', 'IDR', 'Fee')).toBe(0);
    expect(detailMinor('  ', 'IDR', 'Fee', 9_225)).toBe(9_225);
    expect(detailMinor('0', 'IDR', 'Fee', 9_225)).toBe(0);
  });
});
