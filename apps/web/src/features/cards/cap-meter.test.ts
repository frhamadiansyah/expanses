import { describe, expect, it } from 'vitest';
import { capMeter } from './cap-meter';

describe('capMeter', () => {
  it('stays in the tint just short of the cap, where the bar still rounds below full', () => {
    expect(capMeter(9_940, 10_000).tone).toBe('tint');
  });

  it('turns warn once the bar rounds to full, as it did before the restyle', () => {
    expect(capMeter(9_960, 10_000).tone).toBe('warn');
  });

  it('is warn past the cap, with the bar held at full', () => {
    expect(capMeter(15_000, 10_000)).toEqual({ fraction: 1, tone: 'warn' });
  });

  it('is empty and in the tint with nothing spent', () => {
    expect(capMeter(0, 10_000)).toEqual({ fraction: 0, tone: 'tint' });
  });
});
