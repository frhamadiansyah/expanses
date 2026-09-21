import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS_KEY, hasEntitlement, setPreviewEntitlement } from './entitlements';

const storage = (value: string | null) => ({ getItem: () => value });
function memory(initial: string | null = null) {
  const items = new Map<string, string>(initial === null ? [] : [[ENTITLEMENTS_KEY, initial]]);
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

describe('hasEntitlement', () => {
  it('is granted only when the list names it', () => {
    expect(hasEntitlement('foreign_securities', storage('["foreign_securities"]'))).toBe(true);
    expect(hasEntitlement('foreign_securities', storage('[]'))).toBe(false);
    expect(hasEntitlement('foreign_securities', storage(null))).toBe(false);
  });
  it('is not granted by anything it cannot read', () => {
    expect(hasEntitlement('foreign_securities', storage('{not json'))).toBe(false);
    expect(hasEntitlement('foreign_securities', storage('"foreign_securities"'))).toBe(false);
    expect(hasEntitlement('foreign_securities', null)).toBe(false);
  });
});

describe('setPreviewEntitlement', () => {
  it('grants and withdraws the one entitlement, leaving anything else the list holds', () => {
    const device = memory('["something_later"]');
    setPreviewEntitlement('foreign_securities', true, device);
    expect(hasEntitlement('foreign_securities', device)).toBe(true);
    expect(JSON.parse(device.getItem(ENTITLEMENTS_KEY)!)).toEqual(['something_later', 'foreign_securities']);
    setPreviewEntitlement('foreign_securities', false, device);
    expect(hasEntitlement('foreign_securities', device)).toBe(false);
    expect(JSON.parse(device.getItem(ENTITLEMENTS_KEY)!)).toEqual(['something_later']);
  });
  it('starts a list on a device that has none, and mends one it cannot read', () => {
    const device = memory('{not json');
    setPreviewEntitlement('foreign_securities', true, device);
    expect(JSON.parse(device.getItem(ENTITLEMENTS_KEY)!)).toEqual(['foreign_securities']);
  });
});
