import { describe, expect, it } from 'vitest';
import { formatMinor } from '@expanses/core';
import type { FeeYearRecord } from '@expanses/db';
import { challengeCoversFee, earlierFeeText, feeRows, feeToGo, lineDate } from './fee-line';

describe('which fee year a challenge is about', () => {
  it('covers the year the challenge was kept for', () => expect(challengeCoversFee(2026, 2026)).toBe(true));
  it('does not cover last year’s challenge, kept on the card a year on', () => expect(challengeCoversFee(2025, 2026)).toBe(false));
  it('does not cover next year’s challenge, which shows its own progress', () => expect(challengeCoversFee(2027, 2026)).toBe(false));
  it('covers nothing without a challenge', () => expect(challengeCoversFee(null, 2026)).toBe(false));
});

/*
 * The Fee waiver page's fee lines (owner, 13 Nov 2026), invented figures. Every value is plain: a date and money, and
 * a date in the fee year this page covers drops its year.
 */
const rp = (minor: number) => formatMinor(minor, 'IDR');
const record = (over: Partial<FeeYearRecord>): FeeYearRecord => ({
  year: 2026,
  covered: '2026-10-15',
  charge: null,
  beforeApp: false,
  reversal: null,
  marked: false,
  lines: ['pending'],
  state: 'pending',
  ...over,
});

describe('a fee line’s date', () => {
  it('drops the year in the covered fee year, and keeps it in another', () => {
    expect(lineDate('2026-10-15', 2026)).toBe('15 Oct');
    expect(lineDate('2027-02-02', 2026)).toBe('2 Feb 2027');
  });
});

describe('the fee lines', () => {
  it('reads Pending with the covered date and the card’s fee', () => {
    expect(feeRows(record({}), 1_150_000, 'IDR')).toEqual([{ kind: 'pending', title: 'Pending', value: `15 Oct · ${rp(1_150_000)}`, transactionId: null }]);
    expect(feeRows(record({}), null, 'IDR')[0]!.value).toBe('15 Oct');
  });
  it('reads the charge and the reversal from their own rows', () => {
    const rows = feeRows(
      record({ charge: { transactionId: 'c', on: '2026-10-16', amountMinor: 1_150_000 }, reversal: { transactionId: 'r', on: '2027-02-02', amountMinor: 1_100_000, ours: false }, lines: ['charged', 'reversal'], state: 'waived' }),
      1_150_000,
      'IDR',
    );
    expect(rows).toEqual([
      { kind: 'charged', title: 'Charged', value: `16 Oct · ${rp(1_150_000)}`, transactionId: 'c' },
      { kind: 'reversal', title: 'Reversal', value: `2 Feb 2027 · ${rp(1_100_000)}`, transactionId: 'r' },
    ]);
  });
  it('reads a charge before the app as any charge, with the card’s fee (owner, 22 Nov 2026)', () => {
    const rows = feeRows(record({ beforeApp: true, reversal: { transactionId: 'r', on: '2026-11-13', amountMinor: 1_150_000, ours: true }, lines: ['charged-before-app', 'reversal'], state: 'waived' }), 1_150_000, 'IDR');
    expect(rows[0]).toEqual({ kind: 'charged-before-app', title: 'Charged', value: `15 Oct · ${rp(1_150_000)}`, transactionId: null });
  });
  it('reads a charge before the app as its date alone when the card has no fee amount', () => {
    const rows = feeRows(record({ beforeApp: true, reversal: { transactionId: 'r', on: '2026-11-13', amountMinor: 1_150_000, ours: true }, lines: ['charged-before-app', 'reversal'], state: 'waived' }), null, 'IDR');
    expect(rows[0]).toEqual({ kind: 'charged-before-app', title: 'Charged', value: '15 Oct', transactionId: null });
  });
  it('reads Waived as not charged', () => {
    expect(feeRows(record({ marked: true, lines: ['waived'], state: 'waived' }), 1_150_000, 'IDR')[0]).toEqual({ kind: 'waived', title: 'Waived', value: `not charged · ${rp(1_150_000)}`, transactionId: null });
  });
  it('keeps every year on a year page', () => {
    expect(feeRows(record({ charge: { transactionId: 'c', on: '2026-10-16', amountMinor: 1_150_000 }, lines: ['charged'], state: 'charged' }), 1_150_000, 'IDR', true)[0]!.value).toBe(`16 Oct 2026 · ${rp(1_150_000)}`);
  });
});

describe('an earlier year’s line', () => {
  it('reads reversed, charged or waived, with that year’s own money', () => {
    expect(earlierFeeText(record({ charge: { transactionId: 'c', on: '2025-10-15', amountMinor: 950_000 }, reversal: { transactionId: 'r', on: '2025-11-02', amountMinor: 940_000, ours: false }, state: 'waived' }), 'IDR')).toBe(`Reversed · ${rp(940_000)}`);
    expect(earlierFeeText(record({ charge: { transactionId: 'c', on: '2025-10-15', amountMinor: 950_000 }, state: 'charged' }), 'IDR')).toBe(`Charged · ${rp(950_000)}`);
    expect(earlierFeeText(record({ marked: true, state: 'waived' }), 'IDR')).toBe('Waived · not charged');
  });
});

describe('what is left to spend, short', () => {
  it('reads millions as jt in rupiah, the way the app shortens them', () => {
    expect(feeToGo(18_000_000, 'IDR')).toBe(rp(0).replace('0', '18 jt'));
    expect(feeToGo(8_600_000, 'IDR')).toBe(rp(0).replace('0', '8,6 jt'));
    expect(feeToGo(450_000, 'IDR')).toBe(rp(450_000));
  });
  it('reads any other currency in full', () => expect(feeToGo(1_800_00, 'USD')).toBe(formatMinor(1_800_00, 'USD')));
  it('is null with nothing left', () => expect(feeToGo(0, 'IDR')).toBeNull());
});
