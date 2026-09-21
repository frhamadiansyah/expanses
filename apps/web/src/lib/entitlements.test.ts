import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENTITLEMENTS_KEY, hasEntitlement, setPreviewEntitlement, subscribeEntitlements, useEntitlement } from './entitlements';

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

describe('the device list', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is read when no storage is given, and an explicit null reads — and writes — nothing, never the device', () => {
    const device = memory('["foreign_securities"]');
    vi.stubGlobal('window', { localStorage: device });
    expect(hasEntitlement('foreign_securities')).toBe(true);
    expect(hasEntitlement('foreign_securities', null)).toBe(false);
    expect(() => setPreviewEntitlement('foreign_securities', false, null)).not.toThrow();
    expect(hasEntitlement('foreign_securities')).toBe(true);
  });
});

describe('an open screen follows the switch', () => {
  const storageEvent = (key: string | null) => Object.assign(new Event('storage'), { key });

  it('is told when this tab flips it, and stops being told once it lets go', () => {
    const listener = vi.fn();
    const stop = subscribeEntitlements(listener, new EventTarget());
    setPreviewEntitlement('foreign_securities', true, memory());
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setPreviewEntitlement('foreign_securities', false, memory());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is told when another tab flips it, and not for anything else stored', () => {
    const listener = vi.fn();
    const events = new EventTarget();
    const stop = subscribeEntitlements(listener, events);
    events.dispatchEvent(storageEvent('something.else'));
    expect(listener).not.toHaveBeenCalled();
    events.dispatchEvent(storageEvent(ENTITLEMENTS_KEY));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    events.dispatchEvent(storageEvent(ENTITLEMENTS_KEY));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('grants nothing before the device is read', () => {
    const Probe = () => createElement('span', null, String(useEntitlement('foreign_securities')));
    expect(renderToString(createElement(Probe))).toBe('<span>false</span>');
  });
});
