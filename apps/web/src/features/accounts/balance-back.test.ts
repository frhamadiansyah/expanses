import { describe, expect, it } from 'vitest';
import { backLayout, backRadius, MAX_SPARK, MIN_SPARK } from './balance-back';

describe('backLayout', () => {
  it('draws the line on a phone-width card, with the foreign line kept', () => {
    // A 358 px wide card is 226 px tall.
    const layout = backLayout(226, 2);
    expect(layout.foreign).toBe(true);
    expect(layout.spark).toBeGreaterThanOrEqual(MIN_SPARK);
    expect(layout.spark).toBeLessThanOrEqual(MAX_SPARK);
  });
  it('gives the line more room when there is no foreign line', () => {
    expect(backLayout(226, 1).spark!).toBeGreaterThanOrEqual(backLayout(226, 2).spark!);
  });
  it('drops the foreign line before the drawing on a card that is short', () => {
    const layout = backLayout(180, 2);
    expect(layout.foreign).toBe(false);
    expect(layout.spark).not.toBeNull();
  });
  it('drops the drawing, keeping figure and account line, when the card is too short for it', () => {
    expect(backLayout(120, 2)).toEqual({ foreign: false, spark: null });
  });
  it('never asks for less than one account line', () => {
    expect(backLayout(226, 0).foreign).toBe(false);
  });
  it('is capped at the height the page draws the line at', () => {
    expect(backLayout(600, 1).spark).toBe(MAX_SPARK);
  });
});

describe('backRadius', () => {
  it('is 14.4 at the face width and scales with it', () => {
    expect(backRadius(240)).toBe(14);
    expect(backRadius(358)).toBe(21);
  });
});
