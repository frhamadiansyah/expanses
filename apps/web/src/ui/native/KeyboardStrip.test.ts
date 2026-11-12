import { describe, expect, it } from 'vitest';
import { keyboardDock } from './KeyboardStrip';

/* Figures read from an iPhone 17 Pro simulator on iOS 26.2 with One line open (layout viewport 874 tall). */
describe('where a bar docked on the keyboard stands', () => {
  it('page scrolled to its foot: the keyboard top is the layout foot, so no inset, but the keyboard is up', () => {
    expect(keyboardDock(874, { offsetTop: 376, height: 498 })).toEqual({ inset: 0, shown: true });
  });

  it('page scrolled only a little: the inset is what lies between the showing part and the layout foot', () => {
    // innerHeight read 799 here; the layout viewport is still 874, and the bar belongs 225 above its foot.
    expect(keyboardDock(874, { offsetTop: 83, height: 566 })).toEqual({ inset: 225, shown: true });
  });

  it('no keyboard: the whole page showing', () => {
    expect(keyboardDock(874, { offsetTop: 0, height: 874 })).toEqual({ inset: 0, shown: false });
  });

  it('a short gap is not a keyboard', () => {
    expect(keyboardDock(874, { offsetTop: 0, height: 800 }).shown).toBe(false);
  });
});
