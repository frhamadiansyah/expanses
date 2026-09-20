import { describe, expect, it } from 'vitest';
import { rowHeight, TAP, textWidth } from './metrics';

describe('textWidth', () => {
  it('measures nothing as nothing', () => {
    expect(textWidth('', 15)).toBe(0);
  });

  it('scales with the font size — the hero figure at 34px is not the row figure at 15px', () => {
    expect(textWidth('Superindo', 15)).toBe(71);
    expect(textWidth('Superindo', 30)).toBe(141);
  });

  it('counts a narrow letter as less than a wide one', () => {
    expect(textWidth('iiii', 15)).toBeLessThan(textWidth('mmmm', 15));
  });

  it('gives every digit the same advance, so two Rp figures of equal length measure equal', () => {
    expect(textWidth('Rp 1.111.111', 15)).toBe(textWidth('Rp 9.876.543', 15));
    expect(textWidth('1', 15)).toBe(textWidth('9', 15));
  });

  it('does not mistake a 1 for a narrow letter, which is what made those two figures differ', () => {
    expect(textWidth('1', 15)).toBeGreaterThan(textWidth('i', 15));
  });
});

describe('rowHeight', () => {
  it('pads a title-only row out to the tap target rather than leaving it at its natural 42', () => {
    expect(rowHeight(false)).toBe(TAP);
  });

  it('lets a row with a subtitle grow past the tap target', () => {
    expect(rowHeight(true)).toBe(60);
  });
});
