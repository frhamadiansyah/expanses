import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pwa', () => ({ isNative: () => false }));

import { rotationFor } from './orientation';

describe('which routes may turn sideways', () => {
  it('frees Cashflow itself, with or without its trailing slash', () => {
    expect(rotationFor('/transactions')).toBe('free');
    expect(rotationFor('/transactions/')).toBe('free');
  });

  it('keeps every page opened from Cashflow upright, and every other page too', () => {
    for (const path of ['/transactions/new', '/transactions/paste', '/transactions/line', '/transactions/abc', '/budget', '/']) {
      expect(rotationFor(path)).toBe('portrait');
    }
  });
});
