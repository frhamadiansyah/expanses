import type { BookMoney, DraftRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { notRecordedTotal } from './not-recorded';

const draft = (amountMinor: number, currency: string): Pick<DraftRow, 'amountMinor' | 'currency' | 'occurredOn'> => ({ amountMinor, currency, occurredOn: '2026-11-03' });

/** A workspace that reads in the owner's own rupiah: `convert` hands every figure back, as it does for the ledger. */
const rupiah = (rates: Record<string, number> = {}): BookMoney => ({
  converts: false,
  currency: 'IDR',
  convert: (amountMinor) => amountMinor,
  convertForeign: (amountMinor, currency) => (currency === 'IDR' ? amountMinor : rates[currency] === undefined ? null : Math.round(amountMinor * rates[currency]!)),
  missing: () => [],
});

describe('notRecordedTotal', () => {
  it('adds up drafts in the workspace’s own currency as they are, money in and out alike', () => {
    expect(notRecordedTotal([draft(250_000, 'IDR'), draft(-75_000, 'IDR')], rupiah())).toEqual({ minor: 325_000, approximate: false });
  });

  it('brings a draft read in another currency across at the stored rate, and says the sum is approximate', () => {
    expect(notRecordedTotal([draft(250_000, 'IDR'), draft(94_300, 'KRW')], rupiah({ KRW: 11 }))).toEqual({ minor: 1_287_300, approximate: true });
  });

  it('gives no total while a rate is missing: won are never added up as rupiah', () => {
    expect(notRecordedTotal([draft(250_000, 'IDR'), draft(94_300, 'KRW')], rupiah())).toBeNull();
  });

  it('gives no total when the money cannot convert at all', () => {
    const { convertForeign: _none, ...plain } = rupiah({ KRW: 11 });
    expect(notRecordedTotal([draft(94_300, 'KRW')], plain)).toBeNull();
    expect(notRecordedTotal([draft(250_000, 'IDR')], plain)).toEqual({ minor: 250_000, approximate: false });
  });

  it('converts through the workspace’s own reading when the workspace is in another currency than the owner’s', () => {
    const dollars: BookMoney = { converts: true, currency: 'USD', convert: (amountMinor, currency) => (currency === 'USD' ? amountMinor : currency === 'IDR' ? Math.round(amountMinor / 165) : null), missing: () => [] };
    expect(notRecordedTotal([draft(1_250, 'USD'), draft(330_000, 'IDR')], dollars)).toEqual({ minor: 3_250, approximate: true });
    expect(notRecordedTotal([draft(94_300, 'KRW')], dollars)).toBeNull();
  });
});
