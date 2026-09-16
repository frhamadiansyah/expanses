import { describe, expect, it } from 'vitest';
import { categoryColour, ringSlices, shade } from './category-colours';

describe('a colour per category', () => {
  it('gives the same category the same colour every time', () => {
    expect(categoryColour('groceries')).toBe(categoryColour('groceries'));
    expect(categoryColour('groceries')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps neighbouring categories apart', () => {
    const colours = new Set(['groceries', 'fuel', 'health', 'rent', 'shopping'].map(categoryColour));
    expect(colours.size).toBeGreaterThan(3);
  });

  it('lightens a child by its place, and leaves an only child alone', () => {
    expect(shade('#1d4ed8', 0, 4)).toBe('rgb(29 78 216)');
    expect(shade('#1d4ed8', 0, 1)).toBe('rgb(29 78 216)');
    expect(shade('#1d4ed8', 3, 4)).not.toBe('rgb(29 78 216)');
  });
});

describe('the slices a ring shows', () => {
  const items = [
    { id: 'a', totalMinor: 4_000_000 },
    { id: 'b', totalMinor: 3_000_000 },
    { id: 'c', totalMinor: 2_000_000 },
    { id: 'd', totalMinor: 40_000 },
    { id: 'e', totalMinor: 0 },
  ];

  it('orders them largest first and drops what was never spent', () => {
    const { shown } = ringSlices(items);
    expect(shown.map((s) => s.item.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves a sliver out of the ring, to be gathered as Other', () => {
    const { rest } = ringSlices(items);
    expect(rest.map((item) => item.id)).toEqual(['d']);
  });

  it('never shows more slices than it can tell apart', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, totalMinor: 1_000_000 }));
    const { shown, rest } = ringSlices(many);
    expect(shown).toHaveLength(8);
    expect(rest).toHaveLength(12);
  });

  it('holds its nerve when nothing was spent at all', () => {
    expect(ringSlices([])).toEqual({ shown: [], rest: [] });
  });
});
