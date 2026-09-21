import { convertMinor } from '@expanses/core';
import type { Database, RecordTradeInput, WorkspaceContext } from '@expanses/db';
import { describe, expect, it, vi } from 'vitest';
import { tradeDoor } from '../goals/set-aside-question';
import { baseCostPreview, tradeRatesForSave, withCharged } from './trade-money';

const buy = (grossMinor: number, extra: Partial<RecordTradeInput> = {}): RecordTradeInput => ({
  accountId: 'aapl', kind: 'buy', occurredOn: '2026-03-08', unitsMicro: 10_000_000, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: 'bca', ...extra,
});
// Only a typed rate touches the database (openingRateFor → checkManualRate); none of these types one.
const common = { database: {} as Database, ws: { baseCurrency: 'IDR' } as WorkspaceContext, needsRate: null, manualRate: '', where: 'Rate that day' };

describe('withCharged', () => {
  it('puts what left the rupiah account on the input, read by parseMajor', () => {
    expect(withCharged(buy(123_457), '20.000.001', 'USD', 'IDR').cashMinor).toBe(20_000_001);
  });
  it('is the set-aside door’s figure: the question weighs the rupiah that left, never the dollar cents', () => {
    expect(tradeDoor(withCharged(buy(123_457), '20.000.001', 'USD', 'IDR'))!.outflowMinor).toBe(20_000_001);
  });
  it('asks for it when the currencies differ, and leaves a one-currency trade and a unit change alone', () => {
    expect(() => withCharged(buy(123_457), ' ', 'USD', 'IDR')).toThrow(/Charged in IDR/);
    expect(() => withCharged(buy(123_457), 'abc', 'USD', 'IDR')).toThrow(/must be a number/);
    expect(() => withCharged(buy(123_457), '0', 'USD', 'IDR')).toThrow(/more than zero/);
    expect(withCharged(buy(182_500), '', 'USD', 'USD')).toEqual(buy(182_500));
    expect(withCharged(buy(0, { kind: 'unit_change' }), '', 'USD', 'IDR').cashMinor).toBeUndefined();
  });
});

describe('tradeRatesForSave', () => {
  it('works the rate out from the two amounts and asks no day rate', async () => {
    const resolveRates = vi.fn();
    const rates = await tradeRatesForSave({ ...common, input: withCharged(buy(123_457), '20.000.001', 'USD', 'IDR'), holdingCurrency: 'USD', cashCurrency: 'IDR', resolveRates, onMissing: vi.fn() });
    expect(convertMinor(123_457, 'USD', 'IDR', rates.USD!)).toBe(20_000_001);
    expect(resolveRates).not.toHaveBeenCalled();
  });

  it('works a buy’s rate out from its whole cost, fee included — what the holding line posts', async () => {
    const input = withCharged(buy(182_500, { feeMinor: 1_000 }), '28.993.000', 'USD', 'IDR');
    const rates = await tradeRatesForSave({ ...common, input, holdingCurrency: 'USD', cashCurrency: 'IDR', resolveRates: vi.fn(), onMissing: vi.fn() });
    expect(rates.USD).toBe(15_800); // 28.993.000 / 1.835,00 — the price alone would say 15.886,6
  });

  it('works a sell’s rate out from the net proceeds', async () => {
    const sell = withCharged(buy(90_000, { kind: 'sell', feeMinor: 500, unitsMicro: 4_000_000 }), '1.458.850', 'USD', 'IDR');
    const rates = await tradeRatesForSave({ ...common, input: sell, holdingCurrency: 'USD', cashCurrency: 'IDR', resolveRates: vi.fn(), onMissing: vi.fn() });
    expect(convertMinor(89_500, 'USD', 'IDR', rates.USD!)).toBe(1_458_850);
  });

  it('refuses a cross-currency trade that reached it without the charged amount', async () => {
    await expect(tradeRatesForSave({ ...common, input: buy(123_457), holdingCurrency: 'USD', cashCurrency: 'IDR', resolveRates: vi.fn(), onMissing: vi.fn() })).rejects.toThrow(/Charged in IDR/);
  });

  it('takes the day’s rate for a foreign holding paid in its own currency, through openingRateFor', async () => {
    const resolveRates = vi.fn().mockResolvedValue({ rates: { USD: 16_250 } });
    expect(await tradeRatesForSave({ ...common, input: buy(182_500, { cashAccountId: 'ibkr' }), holdingCurrency: 'USD', cashCurrency: 'USD', resolveRates, onMissing: vi.fn() })).toEqual({ USD: 16_250 });
    expect(resolveRates).toHaveBeenCalledWith(['USD'], '2026-03-08');
  });

  it('takes both day rates when neither side is the base currency', async () => {
    // openingRateFor asks one currency at a time, in `dayRates` order (sorted): SGD, then USD.
    const resolveRates = vi.fn().mockResolvedValueOnce({ rates: { SGD: 12_100 } }).mockResolvedValueOnce({ rates: { USD: 16_250 } });
    const input = withCharged(buy(182_500, { cashAccountId: 'dbs' }), '2.452,00', 'USD', 'SGD');
    expect(await tradeRatesForSave({ ...common, input, holdingCurrency: 'USD', cashCurrency: 'SGD', resolveRates, onMissing: vi.fn() })).toEqual({ SGD: 12_100, USD: 16_250 });
    expect(resolveRates.mock.calls).toEqual([[['SGD'], '2026-03-08'], [['USD'], '2026-03-08']]);
  });

  it('says which rate is missing and where to type it', async () => {
    const onMissing = vi.fn();
    const resolveRates = vi.fn().mockResolvedValue({ rates: {} });
    await expect(tradeRatesForSave({ ...common, input: buy(182_500, { cashAccountId: null }), holdingCurrency: 'USD', cashCurrency: 'USD', resolveRates, onMissing })).rejects.toThrow(/Rate that day/);
    expect(onMissing).toHaveBeenCalledWith('USD');
  });

  it('needs nothing when all of it is base, and nothing for a unit change', async () => {
    const resolveRates = vi.fn();
    expect(await tradeRatesForSave({ ...common, input: buy(8_750_000), holdingCurrency: 'IDR', cashCurrency: 'IDR', resolveRates, onMissing: vi.fn() })).toEqual({});
    expect(await tradeRatesForSave({ ...common, input: buy(0, { kind: 'unit_change' }), holdingCurrency: 'USD', cashCurrency: 'IDR', resolveRates, onMissing: vi.fn() })).toEqual({});
    expect(resolveRates).not.toHaveBeenCalled();
  });
});

describe('baseCostPreview', () => {
  const p = { holdingCurrency: 'USD', baseCurrency: 'IDR', heldRates: { USD: 16_250 } };
  it('is what left the account when paid in base, at the rate the save will work out', () => {
    expect(baseCostPreview({ ...p, cashCurrency: 'IDR', input: withCharged(buy(182_500), '28.835.000', 'USD', 'IDR') })).toEqual({ rate: 15_800, baseMinor: 28_835_000 });
    expect(baseCostPreview({ ...p, cashCurrency: 'IDR', input: withCharged(buy(182_500, { feeMinor: 1_000 }), '28.993.000', 'USD', 'IDR') })).toEqual({ rate: 15_800, baseMinor: 28_993_000 });
  });
  it('converts the whole cost at the held day rate when paid in the holding’s currency', () => {
    expect(baseCostPreview({ ...p, cashCurrency: 'USD', input: buy(182_500, { feeMinor: 1_000 }) })).toEqual({ rate: 16_250, baseMinor: convertMinor(183_500, 'USD', 'IDR', 16_250) });
  });
  it('is nothing rather than a guess when it cannot be known', () => {
    expect(baseCostPreview({ ...p, heldRates: {}, cashCurrency: 'USD', input: buy(182_500) })).toEqual({ rate: null, baseMinor: null });
    expect(baseCostPreview({ ...p, cashCurrency: 'IDR', input: null })).toEqual({ rate: null, baseMinor: null });
  });
});
