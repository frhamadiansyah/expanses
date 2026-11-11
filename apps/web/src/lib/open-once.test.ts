import { describe, expect, it } from 'vitest';
import { shouldOpen } from './open-once';

describe('shouldOpen', () => {
  it('opens when asked and ready, once', () => {
    expect(shouldOpen(true, true, false)).toBe(true);
    expect(shouldOpen(true, true, true)).toBe(false);
  });
  it('waits for the page, and never opens unasked', () => {
    expect(shouldOpen(true, false, false)).toBe(false);
    expect(shouldOpen(false, true, false)).toBe(false);
  });
});
