import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { monthlyInstalments } from './instalments';

const accounts = [
  { id: 'kpr', name: 'KPR Bintaro', currency: 'IDR' },
  { id: 'car', name: 'Car loan', currency: 'USD' },
  { id: 'yen', name: 'Yen loan', currency: 'JPY' },
] as AccountRow[];
const payments = { kpr: 7_100_000, car: 45_050, yen: 30_000 };

describe('the instalments the banks ask for each month', () => {
  it('prints each loan in its own currency and converts the total, never adding minor units as rupiah', () => {
    const out = monthlyInstalments([{ accountId: 'kpr' }, { accountId: 'car' }], accounts, payments, 'IDR', { USD: 16_250 });
    expect(out.rows).toEqual([
      { accountId: 'kpr', minor: 7_100_000, currency: 'IDR' },
      { accountId: 'car', minor: 45_050, currency: 'USD' },
    ]);
    // $450,50 at 16.250 = Rp 7.320.625; the old raw sum said Rp 7.145.050.
    expect(out.total).toEqual({ totalMinor: 14_420_625, missing: [] });
  });

  it('gives no total when a rate is missing, and names it — not the sum of the rest', () => {
    const out = monthlyInstalments([{ accountId: 'kpr' }, { accountId: 'car' }, { accountId: 'yen' }], accounts, payments, 'IDR', { USD: 16_250 });
    expect(out.total).toEqual({ totalMinor: null, missing: ['JPY'] });
    expect(out.rows.map((row) => row.currency)).toEqual(['IDR', 'USD', 'JPY']);
  });

  it('a loan whose account is unknown is read in the base currency', () => {
    expect(monthlyInstalments([{ accountId: 'gone' }], accounts, { gone: 5 }, 'IDR', {}).rows).toEqual([{ accountId: 'gone', minor: 5, currency: 'IDR' }]);
  });
});
