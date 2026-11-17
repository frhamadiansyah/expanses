import { describe, expect, it } from 'vitest';
import { cardBackFigure, limitUsage } from './limit-usage';

describe('limitUsage', () => {
  it('shows instalments as part of what is used, not as a second deduction', () => {
    expect(limitUsage(30_000_000, 80_000_000, 17_500_000)).toEqual({ usedMinor: 30_000_000, heldMinor: 17_500_000, availableMinor: 50_000_000, barUsedPct: 16, barHeldPct: 22, usedPct: 38 });
  });

  it('never lets instalments hold more than is owed', () => {
    expect(limitUsage(4_000_000, 80_000_000, 17_500_000)).toMatchObject({ heldMinor: 4_000_000, availableMinor: 76_000_000, barUsedPct: 0, barHeldPct: 5 });
  });

  it('says how far over the limit a card is, and draws no bar without a limit', () => {
    expect(limitUsage(42_000_000, 40_000_000, 0)).toMatchObject({ availableMinor: -2_000_000, usedPct: 100, barUsedPct: 100 });
    expect(limitUsage(5_000_000, null, 1_000_000)).toEqual({ usedMinor: 5_000_000, heldMinor: 1_000_000, availableMinor: null, barUsedPct: 0, barHeldPct: 0, usedPct: null });
  });

  it('counts a credit on top of the limit: Rp 50.000.000 credit on a Rp 100.000.000 limit leaves Rp 150.000.000 to spend', () => {
    expect(limitUsage(-50_000_000, 100_000_000, 0)).toMatchObject({ usedMinor: 0, availableMinor: 150_000_000, usedPct: 0, barUsedPct: 0 });
  });
});

describe('cardBackFigure', () => {
  it('names what is owed Outstanding', () => {
    expect(cardBackFigure(30_000_000, 0)).toEqual({ label: 'Outstanding', minor: 30_000_000 });
    expect(cardBackFigure(0, 0)).toEqual({ label: 'Outstanding', minor: 0 });
  });

  it('names a card in credit by its credit, in the same place', () => {
    expect(cardBackFigure(0, 50_000_000)).toEqual({ label: 'Credit', minor: 50_000_000 });
  });
});
