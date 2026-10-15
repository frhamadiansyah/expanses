import { describe, expect, it } from 'vitest';
import { exchangeOutPreview, exchangeResultLine, exchangeResultText, foreignMoney, fromWithdrawalsText, transferRateText, withdrawalRateLine, withdrawalsLeftView } from './withdrawal-rate';

/* Withdrawal rate §7's copy, word for word (with the app's ’). Invented figures. Intl writes a no-break space after Rp. */
const plain = (text: string | null) => text?.replace(/ /g, ' ') ?? null;

describe('the withdrawal rate’s words (§7)', () => {
  it('writes foreign money with its symbol, cents only when there are any', () => {
    expect(foreignMoney(30_000, 'TRY')).toBe('₺ 300');
    expect(foreignMoney(1_250, 'TRY')).toBe('₺ 12,50');
    expect(foreignMoney(955_000, 'TRY')).toBe('₺ 9.550');
  });

  it('says what spending costs at the withdrawal rate, and what no withdrawal covers', () => {
    expect(plain(withdrawalRateLine({ costBaseMinor: 236_250, uncoveredMinor: 0, ratePerUnit: 525 }, 'TRY', 'IDR'))).toBe('≈ Rp 236.250 at the withdrawal rate (525)');
    expect(plain(withdrawalRateLine({ costBaseMinor: 238_900, uncoveredMinor: 30_000, ratePerUnit: 530.9 }, 'TRY', 'IDR'))).toBe('≈ Rp 238.900 · ₺ 300 at today’s rate (no withdrawal recorded)');
    expect(withdrawalRateLine({ costBaseMinor: null, uncoveredMinor: 30_000, ratePerUnit: null }, 'TRY', 'IDR')).toBe('₺ 300 has no withdrawal recorded and no rate for today yet');
  });

  it('writes a transfer’s Rate against the market when one side is the base currency (R15)', () => {
    const rates = { TRY: 512 };
    expect(plain(transferRateText({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', baseCurrency: 'IDR', ratesToBase: rates }))).toBe('Rp 525 per TRY (market 512, +2,5 %)');
    expect(plain(transferRateText({ fromMinor: 50_000, fromCurrency: 'TRY', toMinor: 250_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: rates }))).toBe('Rp 500 per TRY (market 512, −2,3 %)');
    expect(plain(transferRateText({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', baseCurrency: 'IDR', ratesToBase: {} }))).toBe('Rp 525 per TRY');
    expect(transferRateText({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: rates })).toBeNull();
  });

  it('works out an exchange out of a foreign account, and says the gain or loss (§5, §7)', () => {
    expect(exchangeOutPreview({ costBaseMinor: 262_500, receivedMinor: 250_000, receivedCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: {} })).toEqual({ receivedBaseMinor: 250_000, gainLossBaseMinor: -12_500 });
    expect(exchangeOutPreview({ costBaseMinor: 8_125_000, receivedMinor: 63_800, receivedCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: { SGD: 12_680 } })).toEqual({ receivedBaseMinor: 8_089_840, gainLossBaseMinor: -35_160 });
    expect(exchangeOutPreview({ costBaseMinor: 1, receivedMinor: 1, receivedCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: {} })).toBeNull();
    expect(exchangeOutPreview({ costBaseMinor: null, receivedMinor: 1, receivedCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: {} })).toBeNull();
    expect(plain(exchangeResultText(exchangeResultLine(-12_500, 'IDR')))).toBe('Exchange loss Rp 12.500 (recorded as spending)');
    expect(plain(exchangeResultText(exchangeResultLine(7_500, 'IDR')))).toBe('Exchange gain Rp 7.500 (recorded as income)');
    expect(exchangeResultLine(0, 'IDR').title).toBe('No exchange gain or loss');
  });

  it('names the withdrawals a spend came from', () => {
    expect(fromWithdrawalsText([{ lotId: 'w1', lotDate: '2026-11-12' }], '2026-11-20')).toBe('From the 12 Nov withdrawal');
    expect(fromWithdrawalsText([{ lotId: 'w1', lotDate: '2025-11-12' }], '2026-11-20')).toBe('From the 12 Nov 2025 withdrawal');
    expect(fromWithdrawalsText([{ lotId: 'w1', lotDate: '2026-11-02' }, { lotId: 'w2', lotDate: '2026-11-09' }], '2026-11-20')).toBe('From 2 withdrawals');
    expect(fromWithdrawalsText([], '2026-11-20')).toBeNull();
  });

  it('lists the withdrawals left in a pocket, and a shortfall in words', () => {
    const view = withdrawalsLeftView(
      {
        accountId: 'lira',
        currency: 'TRY',
        costBaseMinor: 5_013_750,
        shortfallMinor: 30_000,
        open: [{ lotId: 'w1', lotDate: '2026-11-02', minor: 1_000_000, costBaseMinor: 5_250_000, leftMinor: 955_000, leftCostBaseMinor: 5_013_750 }],
      },
      'IDR',
      '2026-11-20',
    );
    expect(plain(view.costText)).toBe('Rp 5.013.750');
    expect(view.rows).toEqual([{ key: 'w1-0', title: '2 Nov', value: '₺ 9.550 of ₺ 10.000 · Rp 525' }]);
    expect(view.shortfallText).toBe('₺ 300 spent with no withdrawal recorded, valued at the day’s rate');
  });
});
