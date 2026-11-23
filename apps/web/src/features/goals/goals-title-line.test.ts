import { formatMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { goalsTitleLine } from './goals-title-line';

describe('goalsTitleLine', () => {
  it('counts the running goals and names what is saved for them', () => {
    expect(goalsTitleLine({ running: 3, done: 0, savedMinor: 3_200_000_000, currency: 'IDR' })).toBe(`3 goals · ${formatMinor(3_200_000_000, 'IDR')} saved`);
  });

  it('reads one goal in the singular and adds the done ones', () => {
    expect(goalsTitleLine({ running: 1, done: 2, savedMinor: 50_000, currency: 'IDR' })).toBe(`1 goal · ${formatMinor(50_000, 'IDR')} saved · 2 done`);
  });

  it('leaves the saved figure out when every goal is done', () => {
    expect(goalsTitleLine({ running: 0, done: 4, savedMinor: 0, currency: 'IDR' })).toBe('0 goals · 4 done');
  });

  it('says so when there are no goals', () => {
    expect(goalsTitleLine({ running: 0, done: 0, savedMinor: 0, currency: 'IDR' })).toBe('No goals yet');
  });
});
