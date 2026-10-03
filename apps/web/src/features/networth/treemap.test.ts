import { describe, expect, it } from 'vitest';
import { squarify } from './treemap';

const area = (box: { w: number; h: number }) => box.w * box.h;
const aspect = (box: { w: number; h: number }) => Math.max(box.w / box.h, box.h / box.w);

describe('squarify', () => {
  it('gives each value a box in proportion to its share, covering the whole space', () => {
    const values = [1_169_660_942, 812_000_000, 281_200_000, 276_790_943, 20_670_000];
    const boxes = squarify(values, 100, 82);
    expect(boxes).toHaveLength(values.length);
    const whole = values.reduce((sum, value) => sum + value, 0);
    boxes.forEach((box, index) => expect(area(box)).toBeCloseTo((values[index]! / whole) * 100 * 82, 6));
    expect(boxes.reduce((sum, box) => sum + area(box), 0)).toBeCloseTo(100 * 82, 6);
    // Every box sits inside the space.
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(-1e-9);
      expect(box.y).toBeGreaterThanOrEqual(-1e-9);
      expect(box.x + box.w).toBeLessThanOrEqual(100 + 1e-9);
      expect(box.y + box.h).toBeLessThanOrEqual(82 + 1e-9);
    }
  });

  it('keeps the boxes no narrower than a strip would make them', () => {
    // Four equal shares in a near-square fall into a 2×2 grid, not four slices.
    const boxes = squarify([1, 1, 1, 1], 100, 100);
    for (const box of boxes) expect(aspect(box)).toBeCloseTo(1, 6);
  });

  it('answers in the order it was asked, whatever order it lays them out in', () => {
    const boxes = squarify([10, 60, 30], 100, 50);
    expect(area(boxes[1]!)).toBeGreaterThan(area(boxes[2]!));
    expect(area(boxes[2]!)).toBeGreaterThan(area(boxes[0]!));
  });

  it('draws one value as the whole space, and nothing as nothing', () => {
    expect(squarify([5], 100, 82)).toEqual([{ x: 0, y: 0, w: 100, h: 82 }]);
    expect(squarify([], 100, 82)).toEqual([]);
    expect(squarify([0, 0], 100, 82)).toEqual([]);
    // A share of nothing is the caller's to leave out: asked about anyway, nothing is drawn rather than a box short.
    expect(squarify([5, 0], 100, 82)).toEqual([]);
  });
});
