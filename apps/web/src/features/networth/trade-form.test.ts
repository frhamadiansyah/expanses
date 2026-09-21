import { positionAfter, type TradeRecord } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { draftFromTrade, draftToInput, emptyTradeDraft, prefillCharged, pricePreview, sellPreview, tradeFormReady, type TradeDraft, typedAmount, waitingForPostedMoney } from './trade-form';

const TODAY = '2026-09-12';
const draft = (overrides: Partial<TradeDraft> = {}): TradeDraft => ({ ...emptyTradeDraft('gold', 'bca', TODAY), ...overrides });

const held = positionAfter([
  {
    id: 't1',
    accountId: 'gold',
    kind: 'buy',
    occurredOn: '2024-02-03',
    createdAt: '2024-02-03T00:00:00Z',
    unitsMicro: 10_000_000,
    grossMinor: 13_100_000,
    feeMinor: 0,
    taxMinor: 0,
  } satisfies TradeRecord,
]);

describe('draftToInput', () => {
  it('reads units and amounts typed the Indonesian way', () => {
    const input = draftToInput(draft({ units: '2', gross: '3.980.000', fee: '20.000' }), 'IDR', TODAY);
    expect(input).toMatchObject({ kind: 'buy', unitsMicro: 2_000_000, grossMinor: 3_980_000, feeMinor: 20_000, taxMinor: 0, cashAccountId: 'bca' });
  });

  it('treats an empty cash account as an opening position', () => {
    expect(draftToInput(draft({ units: '2', gross: '3.980.000', cashAccountId: '' }), 'IDR', TODAY).cashAccountId).toBeNull();
  });

  it('needs units and an amount on a buy', () => {
    expect(() => draftToInput(draft({ gross: '3.980.000' }), 'IDR', TODAY)).toThrow(/how many units/);
    expect(() => draftToInput(draft({ units: '2' }), 'IDR', TODAY)).toThrow(/what it cost/);
    expect(() => draftToInput(draft({ units: '0', gross: '1.000' }), 'IDR', TODAY)).toThrow(/more than zero/);
  });

  it('asks for proceeds on a sell', () => {
    expect(() => draftToInput(draft({ kind: 'sell', units: '2' }), 'IDR', TODAY)).toThrow(/proceeds/);
  });

  it('ignores units on a dividend and asks for the gross amount', () => {
    const input = draftToInput(draft({ kind: 'income', gross: '540.000', tax: '54.000' }), 'IDR', TODAY);
    expect(input).toMatchObject({ kind: 'income', unitsMicro: 0, grossMinor: 540_000, taxMinor: 54_000 });
    expect(() => draftToInput(draft({ kind: 'income' }), 'IDR', TODAY)).toThrow(/amount before tax/);
  });

  it('takes a unit change with no money', () => {
    const input = draftToInput(draft({ kind: 'unit_change', units: '8.000' }), 'IDR', TODAY);
    expect(input).toMatchObject({ kind: 'unit_change', unitsMicro: 8_000_000_000, grossMinor: 0, cashAccountId: null });
  });

  it('refuses a date after today and rubbish numbers', () => {
    expect(() => draftToInput(draft({ units: '2', gross: '1.000', occurredOn: '2026-09-13' }), 'IDR', TODAY)).toThrow(/after today/);
    expect(() => draftToInput(draft({ units: 'ten', gross: '1.000' }), 'IDR', TODAY)).toThrow(/Units must be a number/);
    expect(() => draftToInput(draft({ units: '2', gross: 'lots' }), 'IDR', TODAY)).toThrow(/must be a number/);
  });
});

describe('pricePreview', () => {
  it('works out the price per unit typed', () => {
    expect(pricePreview(draft({ units: '2', gross: '3.980.000' }), 'IDR')).toBe(1_990_000_000_000);
  });

  it('is null until both are filled in', () => {
    expect(pricePreview(draft({ units: '2' }), 'IDR')).toBeNull();
    expect(pricePreview(draft({ gross: '3.980.000' }), 'IDR')).toBeNull();
  });
});

describe('sellPreview', () => {
  it('shows what the sale gives up and what it gains', () => {
    expect(sellPreview(draft({ kind: 'sell', units: '5', gross: '9.000.000' }), held, 'IDR')).toEqual({ basisMinor: 6_550_000, realizedMinor: 2_450_000 });
  });

  it('takes fees off the gain', () => {
    expect(sellPreview(draft({ kind: 'sell', units: '5', gross: '9.000.000', fee: '50.000' }), held, 'IDR')).toEqual({ basisMinor: 6_550_000, realizedMinor: 2_400_000 });
  });

  it('is null when more units are typed than held, or on a buy', () => {
    expect(sellPreview(draft({ kind: 'sell', units: '11', gross: '9.000.000' }), held, 'IDR')).toBeNull();
    expect(sellPreview(draft({ kind: 'buy', units: '5', gross: '9.000.000' }), held, 'IDR')).toBeNull();
    expect(sellPreview(draft({ kind: 'sell', units: '5', gross: '9.000.000' }), undefined, 'IDR')).toBeNull();
  });
});

describe('pre-filled amounts', () => {
  it('are written in the app’s number format, as the owner types them — and read back to the same figure', () => {
    expect(typedAmount(10_447_125, 'IDR')).toBe('10.447.125');
    expect(typedAmount(182_500, 'USD')).toBe('1.825,00');
    expect(typedAmount(0, 'USD')).toBe('0,00');
    const draft = { ...emptyTradeDraft('aapl', 'bca', '2026-03-08'), units: '10', gross: typedAmount(182_525, 'USD'), fee: typedAmount(1_000, 'USD') };
    expect(draftToInput(draft, 'USD', '2026-03-08')).toMatchObject({ grossMinor: 182_525, feeMinor: 1_000 });
  });
  it('fill an edit from the trade in that format, never raw', () => {
    const trade = { kind: 'sell' as const, accountId: 'bbca', occurredOn: '2026-03-08', unitsMicro: 1_500_000_000, grossMinor: 14_662_500, feeMinor: 21_994, taxMinor: 14_663, cashAccountId: 'bca', goalId: null };
    expect(draftFromTrade(trade, 'IDR')).toEqual({
      kind: 'sell', accountId: 'bbca', occurredOn: '2026-03-08', units: '1.500', gross: '14.662.500', fee: '21.994', tax: '14.663', cashAccountId: 'bca', goalId: '',
    });
  });
});

// m3 (8e6): the edit pre-fill only while the trade still pays from the account it was posted through.
describe('prefillCharged', () => {
  const p = { editingCashAccountId: 'bca', cashAccountId: 'bca', postedCash: 14_588_501, cashCurrency: 'IDR', typed: '' };

  it('fills the empty row with what the trade posted, on the same account', () => {
    // Written as the owner types it (ruling 4's pre-fill format), not the raw '14588501'.
    expect(prefillCharged(p)).toBe('14.588.501');
    expect(prefillCharged({ ...p, postedCash: 182_500, cashCurrency: 'USD' })).toBe('1.825,00');
  });

  it('leaves it alone once the owner has switched to a different account', () => {
    expect(prefillCharged({ ...p, cashAccountId: 'ibkr' })).toBeNull();
  });

  it('treats Opening Balances (null) as its own account, not as "any account"', () => {
    expect(prefillCharged({ ...p, editingCashAccountId: null, cashAccountId: '' })).toBe('14.588.501');
    expect(prefillCharged({ ...p, editingCashAccountId: null })).toBeNull();
  });

  it('never overwrites a row the owner has already typed into', () => {
    expect(prefillCharged({ ...p, typed: '1' })).toBeNull();
  });
});

// m3 (8e7): Save must not race the read of what a reworked trade posted.
describe('waitingForPostedMoney and tradeFormReady', () => {
  it('is only waiting while editing a trade whose posted money is still pending', () => {
    expect(waitingForPostedMoney(true, true)).toBe(true);
    expect(waitingForPostedMoney(true, false)).toBe(false);
    expect(waitingForPostedMoney(false, true)).toBe(false);
  });

  it('is ready only when the question is answered and nothing is still pending', () => {
    expect(tradeFormReady(true, false)).toBe(true);
    expect(tradeFormReady(true, true)).toBe(false);
    expect(tradeFormReady(false, false)).toBe(false);
  });
});
