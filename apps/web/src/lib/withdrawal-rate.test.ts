import { describe, expect, it } from 'vitest';
import { foreignMoney, fromWithdrawalsText, receiptWithdrawalLine, transferRateParts, withdrawalRateLine, withdrawalsLeftView } from './withdrawal-rate';

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

  it('on a receipt, values what no withdrawal covered at the day’s rate: the day it was spent, not today (M2)', () => {
    expect(plain(receiptWithdrawalLine({ costBaseMinor: 236_250, uncoveredMinor: 0, ratePerUnit: 525 }, 'TRY', 'IDR'))).toBe('≈ Rp 236.250 at the withdrawal rate (525)');
    expect(plain(receiptWithdrawalLine({ costBaseMinor: 238_900, uncoveredMinor: 30_000, ratePerUnit: 530.9 }, 'TRY', 'IDR'))).toBe('≈ Rp 238.900 · ₺ 300 at the day’s rate (no withdrawal recorded)');
  });

  it('writes a transfer’s Rate, and under it how far it was from the market, when one side is the base currency', () => {
    const rates = { TRY: 512, GBP: 21_000 };
    const parts = (input: Parameters<typeof transferRateParts>[0]) => {
      const out = transferRateParts(input);
      return out && { rate: plain(out.rate), market: plain(out.market) };
    };
    expect(parts({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', baseCurrency: 'IDR', ratesToBase: rates })).toEqual({ rate: 'Rp 525 per TRY', market: 'market 512 · +2,5 %' });
    expect(parts({ fromMinor: 50_000, fromCurrency: 'TRY', toMinor: 250_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: rates })).toEqual({ rate: 'Rp 500 per TRY', market: 'market 512 · −2,3 %' });
    // The owner's example (17 Nov 2026): £1.000 changed for Rp 20.700.000, the market at 21.000.
    expect(parts({ fromMinor: 100_000, fromCurrency: 'GBP', toMinor: 20_700_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: rates })).toEqual({ rate: 'Rp 20.700 per GBP', market: 'market 21.000 · −1,4 %' });
    // No rate held for the day: the rate alone.
    expect(parts({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', baseCurrency: 'IDR', ratesToBase: {} })).toEqual({ rate: 'Rp 525 per TRY', market: null });
    expect(transferRateParts({ fromMinor: 50_000, fromCurrency: 'USD', toMinor: 63_800, toCurrency: 'SGD', baseCurrency: 'IDR', ratesToBase: rates })).toBeNull();
    expect(transferRateParts({ fromMinor: 50_000, fromCurrency: 'IDR', toMinor: 50_000, toCurrency: 'IDR', baseCurrency: 'IDR', ratesToBase: rates })).toBeNull();
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
