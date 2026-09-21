import { describe, expect, it } from 'vitest';
import { rowHeight, TAP, tapReach, textWidth } from './metrics';

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

describe('tapReach', () => {
  it('reaches half the shortfall on each side, so a 28px segment is 44 to a thumb', () => {
    expect(28 + tapReach(28) * 2).toBeGreaterThanOrEqual(TAP);
    expect(tapReach(28)).toBe(8);
  });

  it('rounds the reach up, so an odd shortfall clears the floor instead of landing a pixel under it', () => {
    expect(27 + tapReach(27) * 2).toBeGreaterThanOrEqual(TAP);
    expect(tapReach(27)).toBe(9);
  });

  it('asks for nothing from a control that already clears the floor, rather than shrinking it', () => {
    expect(tapReach(TAP)).toBe(0);
    expect(tapReach(60)).toBe(0);
  });
});
