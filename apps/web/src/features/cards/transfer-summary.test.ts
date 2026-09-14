import { convertDetail, type RedemptionCap, type TransferPartner } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { capNote } from './transfer-summary';

const cap = (over: Partial<RedemptionCap>): RedemptionCap => ({
  window: 'month', capPoints: null, capPartnerUnits: null, shared: false, beyond: null, ...over,
});

const partner = (over: Partial<TransferPartner> = {}): TransferPartner => ({
  id: 'p', key: 'krisflyer', program: 'KrisFlyer', points: 1, partnerUnits: 1, incrementPoints: 10_000,
  validFrom: null, validTo: null, cap: null, ...over,
});

const noteFor = (p: TransferPartner, points: number) => capNote(p, convertDetail(points, p), 'points');

describe('capNote', () => {
  it('says nothing about a partner with no published ceiling', () => {
    expect(noteFor(partner(), 40_000)).toBeNull();
  });

  it('says nothing while the balance is under the ceiling', () => {
    expect(noteFor(partner({ cap: cap({ capPoints: 25_000 }) }), 20_000)).toBeNull();
  });

  it('names what the reduced rate is carrying, and that the ceiling is shared', () => {
    const livin = partner({ cap: cap({ capPoints: 25_000, shared: true, beyond: { points: 3000, partnerUnits: 1000 } }) });
    expect(noteFor(livin, 40_000)).toBe('20.000 points past the monthly ceiling (shared with the other partners) move at the reduced rate');
  });

  it('names what a hard ceiling leaves behind, and counts the window in years where that is the window', () => {
    const treats = partner({ cap: cap({ window: 'year', capPoints: 200_000 }), incrementPoints: 20_000 });
    expect(noteFor(treats, 300_000)).toBe('the yearly ceiling leaves 100.000 points behind');
  });

  it('blames the step rather than the ceiling for a remainder too small to move', () => {
    // 24.000 leaves 4.000 behind, but that is the 10.000 step, not the 25.000 ceiling.
    expect(noteFor(partner({ cap: cap({ capPoints: 25_000 }) }), 24_000)).toBeNull();
  });
});
