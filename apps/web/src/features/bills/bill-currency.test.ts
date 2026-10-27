import { billWindow } from '@expanses/core';
import type { BookMoney, MonthlyBill } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { billCurrencyOf, billsInReadCurrency, chargedEstimate, settledOf, summaryOf } from './bill-view';

const bill = (over: Partial<MonthlyBill>): MonthlyBill => ({
  id: over.name ?? 'x',
  name: 'x',
  categoryAccountId: 'c',
  moneyAccountId: 'm',
  amountMinor: 100,
  dayOfMonth: 1,
  payByDay: null,
  startsMonth: '2026-08',
  active: true,
  currency: null,
  repeat: 'monthly',
  repeatMonth: null,
  repeatEvery: null,
  billMonth: '2026-09',
  window: billWindow('2026-09', 1, null),
  state: 'open',
  days: 5,
  paidOn: null,
  paidMinor: null,
  paidCurrency: null,
  chargedMinor: null,
  chargedCurrency: null,
  paymentId: null,
  estimateMinor: 100,
  payableMonths: ['2026-09'],
  pausedUntil: null,
  pauseFrom: '2026-09',
  ...over,
});

// SGD is worth 12 500 rupiah here, USD 16 000. Reading in rupiah.
const RATES: Record<string, number> = { SGD: 12_500, USD: 16_000 };
const idrMoney = (converts: boolean, foreign: boolean): BookMoney => {
  const real = (minor: number, from: string) => (from === 'IDR' ? minor : from in RATES ? Math.round((minor / 100) * RATES[from]!) : null);
  return { converts, currency: 'IDR', convert: converts ? real : (minor) => minor, ...(foreign ? { convertForeign: real } : {}), missing: () => [] };
};
const life = bill({ name: 'Life cover', currency: 'SGD', amountMinor: 12_000, estimateMinor: 12_000 });
const internet = bill({ name: 'Biznet', amountMinor: 450_000, estimateMinor: 450_000 });
const currencyOf = (b: MonthlyBill) => billCurrencyOf(b, [{ id: 'm', currency: 'IDR' }], 'IDR');

describe('a bill in a currency of its own', () => {
  it('is written in its own currency, and a bill with none follows its payer', () => {
    expect(currencyOf(life)).toBe('SGD');
    expect(currencyOf(internet)).toBe('IDR');
    expect(billCurrencyOf(internet, [{ id: 'm', currency: 'USD' }], 'IDR')).toBe('USD');
    expect(billCurrencyOf(internet, [], 'IDR')).toBe('IDR');
  });

  it('totals in the reading currency from the bill’s currency, not the payer’s, where the workspace converts', () => {
    const { rows, unconverted } = billsInReadCurrency([life, internet], idrMoney(true, true), currencyOf);
    expect(rows.map((r) => r.amountMinor)).toEqual([1_500_000, 450_000]);
    expect(summaryOf(rows, '2026-09-08').totalMinor).toBe(1_950_000);
    expect(unconverted).toEqual([]);
  });

  it('converts it too where the workspace reads in the owner’s own money, and leaves the rest untouched', () => {
    const { rows } = billsInReadCurrency([life, internet], idrMoney(false, true), currencyOf);
    expect(rows.map((r) => r.amountMinor)).toEqual([1_500_000, 450_000]);
    expect(rows[1]).toBe(internet);
  });

  it('with no foreign conversion asked for, a workspace in the owner’s money gets its rows back as they were', () => {
    const { rows } = billsInReadCurrency([life, internet], idrMoney(false, false), currencyOf);
    expect(rows).toEqual([life, internet]);
  });

  it('counts a bill whose currency has no rate as nothing and names it', () => {
    const odd = bill({ name: 'Odd', currency: 'CHF', amountMinor: 5_000 });
    const { rows, unconverted } = billsInReadCurrency([odd, internet], idrMoney(false, true), currencyOf);
    expect(rows[0]!.amountMinor).toBe(0);
    expect(unconverted).toEqual([{ currency: 'CHF', onDate: odd.window.opensOn }]);
  });

  it('counts a paid foreign bill for what the account was charged', () => {
    const paid = bill({
      name: 'Life cover', currency: 'SGD', state: 'paid', amountMinor: 12_000, paidMinor: 12_000, paidCurrency: 'SGD', chargedMinor: 1_510_000, chargedCurrency: 'IDR', paidOn: '2026-09-05',
    });
    const { rows } = billsInReadCurrency([paid], idrMoney(false, true), currencyOf);
    expect(rows[0]!.paidMinor).toBe(1_510_000);
    expect(settledOf(rows)[0]?.paidMinor).toBe(1_510_000);
  });

  it('estimates the charge at the day’s rate, crossing the base when neither side is it', () => {
    const base = { baseCurrency: 'IDR', rates: RATES };
    expect(chargedEstimate({ ...base, amountMinor: 12_000, billCurrency: 'SGD', payerCurrency: 'IDR' })).toBe(1_500_000);
    expect(chargedEstimate({ ...base, amountMinor: 16_000, billCurrency: 'USD', payerCurrency: 'SGD' })).toBe(20_480);
    expect(chargedEstimate({ ...base, amountMinor: 12_000, billCurrency: 'SGD', payerCurrency: 'SGD' })).toBeNull();
    expect(chargedEstimate({ ...base, amountMinor: 12_000, billCurrency: 'CHF', payerCurrency: 'IDR' })).toBeNull();
    expect(chargedEstimate({ ...base, amountMinor: 0, billCurrency: 'SGD', payerCurrency: 'IDR' })).toBeNull();
  });
});
