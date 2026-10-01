import type { TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { loanPayments, monthYearLabel, percentBps, rateText, repaidPercent, soonerText } from './loan-view';

describe('the words on a loan page', () => {
  it('writes a rate with a decimal comma and no trailing zeros', () => {
    expect(rateText(750)).toBe('7,5%');
    expect(rateText(900)).toBe('9%');
    expect(rateText(1125)).toBe('11,25%');
  });

  it('names a month and its year', () => {
    expect(monthYearLabel('2041-09')).toBe('Sep 2041');
    expect(monthYearLabel('2039-03-25')).toBe('Mar 2039');
    expect(monthYearLabel('soon')).toBe('soon');
  });

  it('says how much sooner in years and months', () => {
    expect(soonerText(30)).toBe('2 years 6 months sooner');
    expect(soonerText(12)).toBe('1 year sooner');
    expect(soonerText(1)).toBe('1 month sooner');
    expect(soonerText(0)).toBeNull();
  });

  it('reads how much is repaid, never more than all of it', () => {
    expect(repaidPercent(700_000_000, 616_000_000)).toBe(12);
    expect(repaidPercent(700_000_000, 0)).toBe(100);
    expect(repaidPercent(700_000_000, 800_000_000)).toBe(0);
    expect(repaidPercent(0, 10)).toBe(0);
  });

  it('reads a typed share in basis points', () => {
    expect(percentBps('1')).toBe(100);
    expect(percentBps('1,5')).toBe(150);
    expect(percentBps('2.25%')).toBe(225);
    expect(percentBps('')).toBeNull();
    expect(percentBps('0')).toBeNull();
    expect(percentBps('abc')).toBeNull();
  });
});

const entry = (accountId: string, accountName: string, accountKind: 'asset' | 'liability' | 'expense', amountMinor: number) => ({
  id: `${accountId}-${amountMinor}`,
  accountId,
  accountName,
  accountKind,
  amountMinor,
  currency: 'IDR',
  fxRateToBase: 1,
  amountBaseMinor: amountMinor,
});

const tx = (id: string, occurredOn: string, entries: ReturnType<typeof entry>[]): TransactionView =>
  ({ id, occurredOn, description: id, source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null, createdAt: occurredOn, entries }) as unknown as TransactionView;

describe('loanPayments', () => {
  it('keeps what lowered the loan, newest first, with each charge by name', () => {
    const rows = [
      tx('opening', '2026-01-01', [entry('kpr', 'KPR', 'liability', -700_000_000), entry('eq', 'Opening', 'asset', 700_000_000)]),
      tx('jan', '2026-01-25', [entry('kpr', 'KPR', 'liability', 1_849_866), entry('int', 'Interest', 'expense', 5_250_000), entry('bca', 'BCA', 'asset', -7_099_866)]),
      tx('extra', '2026-02-10', [entry('kpr', 'KPR', 'liability', 50_000_000), entry('fee', 'Fees & charges', 'expense', 500_000), entry('bca', 'BCA', 'asset', -50_500_000)]),
    ];

    expect(loanPayments(rows, 'kpr')).toEqual([
      { id: 'extra', occurredOn: '2026-02-10', principalMinor: 50_000_000, charges: [{ name: 'Fees & charges', minor: 500_000 }], totalMinor: 50_500_000 },
      { id: 'jan', occurredOn: '2026-01-25', principalMinor: 1_849_866, charges: [{ name: 'Interest', minor: 5_250_000 }], totalMinor: 7_099_866 },
    ]);
  });
});
