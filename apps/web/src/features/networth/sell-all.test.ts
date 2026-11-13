import { describe, expect, it } from 'vitest';
import { keepsAll } from './sell-all';

describe('a sell’s All, while the amount row is tidied', () => {
  it('stays on when leaving the row writes back the same figure', () => {
    // The desktop's blur and the keypad's DONE both write the settled text: no dots, the same rupiah.
    expect(keepsAll(true, '1234567', 1_234_567, 'IDR')).toBe(true);
    expect(keepsAll(true, '1.234.567', 1_234_567, 'IDR')).toBe(true);
    expect(keepsAll(true, '642.90', 64_290, 'USD')).toBe(true);
  });

  it('ends on a figure that is not the whole', () => {
    expect(keepsAll(true, '12345670', 1_234_567, 'IDR')).toBe(false);
    expect(keepsAll(true, '1234566', 1_234_567, 'IDR')).toBe(false);
    // Cleared with ×: no longer All.
    expect(keepsAll(true, '', 1_234_567, 'IDR')).toBe(false);
    // An expression still being typed is not the same figure.
    expect(keepsAll(true, '1234567+1', 1_234_567, 'IDR')).toBe(false);
  });

  it('never turns All on by itself', () => {
    expect(keepsAll(false, '1234567', 1_234_567, 'IDR')).toBe(false);
    // Nothing worked out to compare with (no NAV yet): any write is a change.
    expect(keepsAll(true, '1234567', null, 'IDR')).toBe(false);
  });
});
