import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));

import { isMacApp, isPhoneApp } from './mac';

const mark = globalThis as { __cicisMac?: unknown };

afterEach(() => {
  native.value = false;
  delete mark.__cicisMac;
});

describe('which app the page is in', () => {
  it('reads a browser as neither the Mac app nor the iPhone app, mark or not', () => {
    expect(isMacApp()).toBe(false);
    expect(isPhoneApp()).toBe(false);
    mark.__cicisMac = true;
    expect(isMacApp()).toBe(false);
    expect(isPhoneApp()).toBe(false);
  });

  it('reads the native shell without the mark as the iPhone app', () => {
    native.value = true;
    expect(isMacApp()).toBe(false);
    expect(isPhoneApp()).toBe(true);
  });

  it('reads the native shell with the mark as the Mac app', () => {
    native.value = true;
    mark.__cicisMac = true;
    expect(isMacApp()).toBe(true);
    expect(isPhoneApp()).toBe(false);
  });

  it('takes only a literal true as the mark', () => {
    native.value = true;
    mark.__cicisMac = 'yes';
    expect(isMacApp()).toBe(false);
  });
});
