import { describe, expect, it } from 'vitest';
import {
  assumedReturnBps, bandHint, DEFAULT_INFLATION_BPS, DRAWDOWN_RETURN_BPS, EDUCATION_INFLATION_BPS, EMERGENCY_RETURN_BPS,
  RETIREMENT_RETURN_BPS, RETURN_BANDS, returnBandFor,
} from '../src/index';

describe('the assumed return by horizon', () => {
  it.each([
    [1, 400], [12, 400], [13, 500], [36, 500], [37, 600], [60, 600], [61, 800], [240, 800],
  ])('%i months away prefills %i bps', (months, bps) => {
    expect(assumedReturnBps(months)).toBe(bps);
  });

  it('names the band and its range in the hint, and says it is a fund figure', () => {
    expect(bandHint(returnBandFor(48))).toBe('6% · 3 to 5 years · typically 5–7%, net of fund fees; a deposit taxed at source earns less');
  });
});

describe('no prefill is a fantasy', () => {
  it('keeps every default and every band at or below 10%, and 18% nowhere', () => {
    const all = [
      DEFAULT_INFLATION_BPS, RETIREMENT_RETURN_BPS, DRAWDOWN_RETURN_BPS, EDUCATION_INFLATION_BPS, EMERGENCY_RETURN_BPS,
      ...RETURN_BANDS.flatMap((band) => [band.returnBps, band.lowBps, band.highBps]),
    ];
    expect(Math.max(...all)).toBeLessThanOrEqual(1000);
    expect(all).not.toContain(1800);
  });

  it('pairs 10% while saving with 3.5% inflation — a real return near 6.3%, not 1.9%', () => {
    const real = (1 + RETIREMENT_RETURN_BPS / 10_000) / (1 + DEFAULT_INFLATION_BPS / 10_000) - 1;
    expect(real).toBeCloseTo(0.0628, 4);
  });
});
