import type { DepositAutomationRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { defaultInto, landedMinor, landsText, moneyOutDraft, moneyOutMode, readMoneyOut, termInterest } from './deposit-money-out';

const settings: DepositAutomationRow = {
  accountId: 'dep', enabled: false, enabledOn: null, atMaturity: 'principal', interestPaid: 'at_maturity', payoutAccountId: null,
  termMonths: 3, termStartedOn: null, keepRate: true, taxBps: 2_000, taxExempt: false,
};
const terms = { maturesOn: '2026-10-15', rateBps: 425 };
const draft = { intoAccountId: 'bca', occurredOn: '2026-09-01', principal: '50.000.000', interest: '0', tax: '0', penalty: '' };

describe('which it is', () => {
  it('breaks early before the maturity, and withdraws on it, after it, or with no maturity known', () => {
    expect(moneyOutMode('2026-10-15', '2026-10-14')).toBe('early');
    expect(moneyOutMode('2026-10-15', '2026-10-15')).toBe('withdraw');
    expect(moneyOutMode('2026-10-15', '2026-11-01')).toBe('withdraw');
    expect(moneyOutMode(null, '2026-10-01')).toBe('withdraw');
  });
});

describe('what lands', () => {
  it('is principal + interest − tax − penalty', () => {
    expect(landedMinor({ principalMinor: 50_000_000, grossMinor: 535_616, taxMinor: 107_123, penaltyMinor: 0 })).toBe(50_428_493);
    expect(landsText('early', { ...draft, penalty: '250.000' }, 'IDR')).toBe(landsText('early', { ...draft, principal: '49.750.000' }, 'IDR'));
  });

  it('reads typed money as the app does, and ignores the row a mode does not show', () => {
    expect(readMoneyOut('early', { ...draft, interest: '10.000', tax: '999', penalty: '16.500' }, 'IDR')).toEqual({
      principalMinor: 50_000_000, grossMinor: 10_000, taxMinor: 0, penaltyMinor: 16_500,
    });
    expect(readMoneyOut('withdraw', { ...draft, interest: '535.616', tax: '107.123', penalty: '5' }, 'IDR')).toMatchObject({ taxMinor: 107_123, penaltyMinor: 0 });
    expect(readMoneyOut('early', { ...draft, principal: '10.000,50' }, 'USD').principalMinor).toBe(1_000_050);
  });

  it('shows a dash while the figures do not add up', () => {
    expect(landsText('withdraw', { ...draft, interest: '1.000', tax: '2.000' }, 'IDR')).toBe('—');
    expect(landsText('early', { ...draft, principal: '1.000', penalty: '2.000' }, 'IDR')).toBe('—');
    expect(landsText('early', { ...draft, principal: '' }, 'IDR')).toBe('—');
    expect(() => readMoneyOut('early', { ...draft, principal: '0' }, 'IDR')).toThrow('Say how much came back');
  });
});

describe('what the sheet opens with', () => {
  it('works out the term’s interest as the maturity payout does', () => {
    expect(termInterest(50_000_000, terms, settings)).toBe(535_616);
    // Paid monthly: only the last month is still owed at the maturity.
    expect(termInterest(50_000_000, terms, { ...settings, interestPaid: 'monthly' })).toBe(174_657);
  });

  it('withdraws with the interest and its tax, and breaks early with none', () => {
    const base = { balanceMinor: 50_000_000, currency: 'IDR', terms, settings, intoAccountId: 'bca', today: '2026-10-20' };
    expect(moneyOutDraft({ ...base, mode: 'withdraw' })).toEqual({ intoAccountId: 'bca', occurredOn: '2026-10-20', principal: '50000000', interest: '535616', tax: '107123', penalty: '' });
    expect(moneyOutDraft({ ...base, mode: 'withdraw', settings: { ...settings, taxExempt: true } }).tax).toBe('0');
    expect(moneyOutDraft({ ...base, mode: 'early' })).toMatchObject({ interest: '0', tax: '0' });
  });

  it('lands in the payout account the settings chose, else a current account', () => {
    const choices = [{ id: 'wallet', subtype: 'ewallet' as const }, { id: 'bca', subtype: 'bank' as const }];
    expect(defaultInto(choices, 'wallet')).toBe('wallet');
    expect(defaultInto(choices, null)).toBe('bca');
    expect(defaultInto(choices, 'gone')).toBe('bca');
    expect(defaultInto([], null)).toBe('');
  });
});
