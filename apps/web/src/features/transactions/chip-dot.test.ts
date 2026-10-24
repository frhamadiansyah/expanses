import { describe, expect, it } from 'vitest';
import { chipDot } from './ChipMenu';

describe('chipDot', () => {
  it('marks an icon-only filter that is on', () => {
    expect(chipDot({ active: true, iconOnly: true, count: 1 })).toBe(true);
  });

  it('says nothing while the filter is off, on a named chip, or with no count (the Sort icon)', () => {
    expect(chipDot({ active: false, iconOnly: true, count: 1 })).toBe(false);
    expect(chipDot({ active: true, iconOnly: false, count: 1 })).toBe(false);
    expect(chipDot({ active: true, iconOnly: true })).toBe(false);
    expect(chipDot({ active: true, iconOnly: true, count: 0 })).toBe(false);
  });
});
