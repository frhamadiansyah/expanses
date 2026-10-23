import type { TransferPartner } from '@expanses/core';
import type { ProgrammeHistoryRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { conversionEstimate, earnersLine, expiryNote, historyLine, parsePoints, partnerFor } from './programme-text';

const KRISFLYER: TransferPartner = { id: 'p', key: 'krisflyer', program: 'KrisFlyer', points: 3, partnerUnits: 2, incrementPoints: 30, minimumPoints: 3_000, validFrom: null, validTo: null, cap: null };

const row = (over: Partial<ProgrammeHistoryRow>): ProgrammeHistoryRow => ({
  key: 'k', kind: 'earn', on: '2026-09-20', quantity: 0, estimated: false, label: null, earnedById: null, conversionId: null, counterpart: null, ...over,
});

describe('earnersLine', () => {
  it('names the one card, counts several, and says when only conversions fill it', () => {
    expect(earnersLine([{ cardName: 'Mandiri Prioritas' }])).toBe('Mandiri Prioritas');
    expect(earnersLine([{ cardName: 'Mandiri Prioritas' }, { cardName: 'Mandiri Platinum' }])).toBe('2 cards earn here');
    expect(earnersLine([])).toBe('No card · converted in');
  });
});

describe('expiryNote', () => {
  it('says how much dies and when, or nothing', () => {
    expect(expiryNote({ expiringSoon: 3_000, nextExpiryOn: '2026-12-31' })).toBe('3.000 expire 31 Dec');
    expect(expiryNote({ expiringSoon: 0, nextExpiryOn: '2027-12-31' })).toBeNull();
  });
});

describe('historyLine', () => {
  it('shows a conversion out as what left and what arrived', () => {
    const out = row({ kind: 'convert_out', quantity: -10_000, counterpart: { programmeName: 'KrisFlyer', quantity: 6_660, unit: 'miles' } });
    expect(historyLine(out, 'points')).toMatchObject({ title: 'To KrisFlyer', value: '10.000 → 6.660 miles' });
  });

  it('shows a conversion in the same way, from the other side', () => {
    const into = row({ kind: 'convert_in', quantity: 6_660, counterpart: { programmeName: "Livin' Poin", quantity: -10_000, unit: 'points' } });
    expect(historyLine(into, 'miles')).toMatchObject({ title: "From Livin' Poin", value: '10.000 → 6.660 miles' });
  });

  it("names the card for a statement's earning, and marks what was worked out", () => {
    expect(historyLine(row({ kind: 'earn', quantity: 1_250, label: 'Mandiri Prioritas', estimated: true }), 'points')).toEqual({
      title: 'Mandiri Prioritas',
      subtitle: 'Statement of 20 Sept · estimated',
      value: '+1.250',
    });
  });

  it('signs spending and expiry below zero', () => {
    expect(historyLine(row({ kind: 'redeem', quantity: -500, label: 'Voucher' }), 'points')).toMatchObject({ title: 'Voucher', value: '−500' });
    expect(historyLine(row({ kind: 'expire', quantity: -40 }), 'points')).toMatchObject({ title: 'Expired', value: '−40' });
  });
});

describe('parsePoints', () => {
  it('reads thousands as the app writes them, and a comma as the decimal mark', () => {
    expect(parsePoints('10.000')).toBe(10_000);
    expect(parsePoints('10000')).toBe(10_000);
    expect(parsePoints(' 1.250.000 ')).toBe(1_250_000);
    expect(parsePoints('12,5')).toBe(12.5);
    expect(parsePoints('')).toBeNaN();
    expect(parsePoints('lots')).toBeNaN();
  });
});

describe('the conversion estimate', () => {
  it('finds the partner by the programme name', () => {
    expect(partnerFor(' krisflyer', [KRISFLYER])).toBe(KRISFLYER);
    expect(partnerFor('Asia Miles', [KRISFLYER])).toBeUndefined();
  });

  it('converts whole steps at the ratio and says what of the points counts', () => {
    expect(conversionEstimate(10_000, KRISFLYER, 'points')).toEqual({ received: 6_660, note: 'Converts in steps of 30: 9.990 of these points count' });
    expect(conversionEstimate(9_990, KRISFLYER, 'points')).toEqual({ received: 6_660, note: null });
  });

  it('brings nothing under the minimum, and has no estimate without a partner', () => {
    expect(conversionEstimate(2_970, KRISFLYER, 'points')).toEqual({ received: 0, note: 'Nothing moves under 3.000 points' });
    expect(conversionEstimate(10_000, undefined, 'points')).toBeNull();
  });
});
