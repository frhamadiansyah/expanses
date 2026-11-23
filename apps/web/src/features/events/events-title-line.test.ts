import { describe, expect, it } from 'vitest';
import { eventsTitleLine } from './DesktopEvents';

describe('eventsTitleLine (the Mac Events title line, v1)', () => {
  it('counts the events running or ahead and the ones that are over', () => {
    expect(eventsTitleLine(2, 3)).toBe('2 now and next · 3 past');
  });
  it('says nought rather than leaving a group out', () => {
    expect(eventsTitleLine(0, 1)).toBe('0 now and next · 1 past');
  });
});
