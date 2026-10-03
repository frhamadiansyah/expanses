import { describe, expect, it } from 'vitest';
import { chipBadge } from './ChipMenu';

describe('chipBadge', () => {
  it('counts an icon-only filter that is on', () => {
    expect(chipBadge({ active: true, iconOnly: true, count: 1 })).toBe('1');
  });

  it('says nothing while the filter is off, on a named chip, or with no count (the Sort icon)', () => {
    expect(chipBadge({ active: false, iconOnly: true, count: 1 })).toBeNull();
    expect(chipBadge({ active: true, iconOnly: false, count: 1 })).toBeNull();
    expect(chipBadge({ active: true, iconOnly: true })).toBeNull();
    expect(chipBadge({ active: true, iconOnly: true, count: 0 })).toBeNull();
  });
});
