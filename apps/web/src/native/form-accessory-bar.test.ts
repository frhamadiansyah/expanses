import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pwa', () => ({ isNative: () => false }));

import { FormAccessoryBar, hideFormAccessoryBar } from './form-accessory-bar';

const plugin = () => ({ setVisible: vi.fn(async (_: { visible: boolean }) => undefined) });

describe('the form bar over the keyboard while One line is open', () => {
  it('in the iOS app, is hidden on open and shown again on close', () => {
    const bar = plugin();
    const restore = hideFormAccessoryBar(bar, true);
    expect(bar.setVisible).toHaveBeenCalledTimes(1);
    expect(bar.setVisible).toHaveBeenLastCalledWith({ visible: false });
    restore();
    expect(bar.setVisible).toHaveBeenCalledTimes(2);
    expect(bar.setVisible).toHaveBeenLastCalledWith({ visible: true });
  });

  it('opened again after a close, is hidden again', () => {
    const bar = plugin();
    hideFormAccessoryBar(bar, true)();
    hideFormAccessoryBar(bar, true);
    expect(bar.setVisible.mock.calls.map(([options]) => options.visible)).toEqual([false, true, false]);
  });

  it('in a browser, nothing is asked of the plugin', () => {
    const bar = plugin();
    hideFormAccessoryBar(bar, false)();
    expect(bar.setVisible).not.toHaveBeenCalled();
  });

  it('a shell without the plugin (a refusal or a throw) never stops the line opening or closing', async () => {
    const refusing = { setVisible: vi.fn(() => Promise.reject(new Error('not implemented'))) };
    expect(() => hideFormAccessoryBar(refusing, true)()).not.toThrow();
    const throwing = {
      setVisible: vi.fn(() => {
        throw new Error('missing');
      }),
    };
    expect(() => hideFormAccessoryBar(throwing, true)()).not.toThrow();
    await Promise.resolve();
  });

  it('the web stand-in does nothing', async () => {
    await expect(FormAccessoryBar.setVisible({ visible: false })).resolves.toBeUndefined();
  });
});
