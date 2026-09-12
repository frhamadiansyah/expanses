import { describe, expect, it } from 'vitest';
import { type Position, positionAfter, type TradeAccounts, TradeError, type TradeInput, type TradeRecord, tradeDescription, tradePostings } from '../src/index';

const accounts: TradeAccounts = {
  holdingAccountId: 'gold',
  holdingCurrency: 'IDR',
  cashAccountId: 'bca',
  cashCurrency: 'IDR',
  realizedGainsCategoryId: 'gains',
  investmentIncomeCategoryId: 'investment-income',
  finalTaxCategoryId: 'final-tax',
};

const record = (partial: Partial<TradeRecord> & Pick<TradeRecord, 'kind' | 'occurredOn'>): TradeRecord => ({
  id: 't1',
  accountId: 'gold',
  createdAt: '2026-01-01T00:00:00Z',
  unitsMicro: 0,
  grossMinor: 0,
  feeMinor: 0,
  taxMinor: 0,
  ...partial,
});

/** 10 units that cost Rp 10.000.000, so the average cost is Rp 1.000.000 a unit. */
const heldTen: Position = positionAfter([record({ kind: 'buy', occurredOn: '2024-02-03', unitsMicro: 10_000_000, grossMinor: 10_000_000 })]);
const empty: Position = positionAfter([]);

const input = (partial: Partial<TradeInput> & Pick<TradeInput, 'kind'>): TradeInput => ({
  occurredOn: '2026-09-12',
  unitsMicro: 0,
  grossMinor: 0,
  feeMinor: 0,
  taxMinor: 0,
  ...partial,
});

const amountFor = (lines: { accountId: string; amountMinor: number }[], accountId: string) =>
  lines.filter((l) => l.accountId === accountId).reduce((sum, l) => sum + l.amountMinor, 0);
const sum = (lines: { amountMinor: number }[]) => lines.reduce((total, l) => total + l.amountMinor, 0);

describe('tradePostings', () => {
  it('debits the holding with fees included and credits cash on a buy', () => {
    const lines = tradePostings(input({ kind: 'buy', unitsMicro: 2_000_000, grossMinor: 3_980_000, feeMinor: 20_000 }), empty, accounts);
    expect(amountFor(lines, 'gold')).toBe(4_000_000);
    expect(amountFor(lines, 'bca')).toBe(-4_000_000);
    expect(sum(lines)).toBe(0);
  });

  it('credits the holding by average cost and books the gain on a sell', () => {
    const lines = tradePostings(input({ kind: 'sell', unitsMicro: 5_000_000, grossMinor: 8_000_000 }), heldTen, accounts);
    expect(amountFor(lines, 'gold')).toBe(-5_000_000);
    expect(amountFor(lines, 'bca')).toBe(8_000_000);
    expect(amountFor(lines, 'gains')).toBe(-3_000_000);
    expect(sum(lines)).toBe(0);
  });

  it('debits realized gains when a sell loses money', () => {
    const lines = tradePostings(input({ kind: 'sell', unitsMicro: 5_000_000, grossMinor: 4_000_000 }), heldTen, accounts);
    expect(amountFor(lines, 'gains')).toBe(1_000_000);
    expect(sum(lines)).toBe(0);
  });

  it('books the withheld tax and nets the cash on a sell', () => {
    const lines = tradePostings(input({ kind: 'sell', unitsMicro: 5_000_000, grossMinor: 8_000_000, feeMinor: 12_000, taxMinor: 8_000 }), heldTen, accounts);
    expect(amountFor(lines, 'bca')).toBe(8_000_000 - 12_000 - 8_000);
    expect(amountFor(lines, 'final-tax')).toBe(8_000);
    expect(amountFor(lines, 'gains')).toBe(-(8_000_000 - 12_000 - 5_000_000));
    expect(sum(lines)).toBe(0);
  });

  it('books gross income, the tax expense and net cash on a dividend', () => {
    const lines = tradePostings(input({ kind: 'income', grossMinor: 540_000, taxMinor: 54_000 }), heldTen, accounts);
    expect(amountFor(lines, 'bca')).toBe(486_000);
    expect(amountFor(lines, 'final-tax')).toBe(54_000);
    expect(amountFor(lines, 'investment-income')).toBe(-540_000);
    expect(sum(lines)).toBe(0);
  });

  it('posts a coupon with no tax as plain income', () => {
    const lines = tradePostings(input({ kind: 'income', grossMinor: 266_667 }), heldTen, accounts);
    expect(amountFor(lines, 'bca')).toBe(266_667);
    expect(lines.some((l) => l.accountId === 'final-tax')).toBe(false);
    expect(sum(lines)).toBe(0);
  });

  it('posts nothing for a unit change', () => {
    expect(tradePostings(input({ kind: 'unit_change', unitsMicro: 8_000_000 }), heldTen, accounts)).toEqual([]);
  });

  it('uses the holding currency on the holding line and the cash currency on the cash line', () => {
    const usd: TradeAccounts = { ...accounts, holdingAccountId: 'bbca-us', holdingCurrency: 'USD', cashAccountId: 'jenius', cashCurrency: 'USD' };
    const lines = tradePostings(input({ kind: 'buy', unitsMicro: 1_000_000, grossMinor: 98_700 }), empty, usd);
    expect(lines.every((l) => l.currency === 'USD')).toBe(true);
  });

  it('refuses zero or negative units on a buy and a sell', () => {
    expect(() => tradePostings(input({ kind: 'buy', unitsMicro: 0, grossMinor: 1_000 }), empty, accounts)).toThrow(TradeError);
    expect(() => tradePostings(input({ kind: 'sell', unitsMicro: -1, grossMinor: 1_000 }), heldTen, accounts)).toThrow(TradeError);
  });

  it('refuses negative amounts', () => {
    expect(() => tradePostings(input({ kind: 'buy', unitsMicro: 1_000_000, grossMinor: -1 }), empty, accounts)).toThrow(TradeError);
    expect(() => tradePostings(input({ kind: 'buy', unitsMicro: 1_000_000, grossMinor: 1_000, feeMinor: -1 }), empty, accounts)).toThrow(TradeError);
  });

  it('refuses a sell beyond the position', () => {
    expect(() => tradePostings(input({ kind: 'sell', unitsMicro: 11_000_000, grossMinor: 1_000 }), heldTen, accounts)).toThrow(/10/);
  });
});

describe('tradeDescription', () => {
  it('names what happened in plain words', () => {
    expect(tradeDescription(input({ kind: 'buy', unitsMicro: 2_000_000, grossMinor: 3_980_000 }), 'Antam gold bars')).toBe('Bought 2 Antam gold bars');
    expect(tradeDescription(input({ kind: 'sell', unitsMicro: 5_000_000, grossMinor: 8_000_000 }), 'Antam gold bars')).toBe('Sold 5 Antam gold bars');
    expect(tradeDescription(input({ kind: 'income', grossMinor: 540_000 }), 'BBCA shares')).toBe('Income from BBCA shares');
  });
});

describe('a holding in another currency', () => {
  const crossCurrency: TradeAccounts = { ...accounts, holdingAccountId: 'us-fund', holdingCurrency: 'USD', currencyExchangeAccountId: 'exchange' };

  it('moves the money through Currency Exchange and balances each currency', () => {
    const lines = tradePostings(input({ kind: 'buy', unitsMicro: 1_000_000, grossMinor: 98_700, cashMinor: 16_000_000 }), empty, crossCurrency);
    expect(amountFor(lines, 'us-fund')).toBe(98_700);
    expect(amountFor(lines, 'bca')).toBe(-16_000_000);
    expect(sum(lines.filter((l) => l.currency === 'USD'))).toBe(0);
    expect(sum(lines.filter((l) => l.currency === 'IDR'))).toBe(0);
  });

  it('asks for the amount in the cash currency', () => {
    expect(() => tradePostings(input({ kind: 'buy', unitsMicro: 1_000_000, grossMinor: 98_700 }), empty, crossCurrency)).toThrow(TradeError);
    expect(() => tradePostings(input({ kind: 'buy', unitsMicro: 1_000_000, grossMinor: 98_700 }), empty, crossCurrency)).toThrow(/IDR/);
  });
});
