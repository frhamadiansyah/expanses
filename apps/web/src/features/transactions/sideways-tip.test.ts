import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterDismiss, afterSideways, afterVisit, readTip, tipShown, writeTip } from './sideways-tip';

afterEach(() => vi.unstubAllGlobals());

describe('the sideways tip', () => {
  it('shows for the first few visits only', () => {
    expect(tipShown({ seen: 0, done: false })).toBe(true);
    expect(tipShown({ seen: 2, done: false })).toBe(true);
    expect(tipShown({ seen: 3, done: false })).toBe(false);
  });

  it('never shows again once the table was opened sideways, or the tip was closed', () => {
    expect(tipShown(afterSideways({ seen: 0, done: false }))).toBe(false);
    expect(tipShown(afterDismiss({ seen: 0, done: false }))).toBe(false);
  });

  it('counts a visit', () => {
    expect(afterVisit({ seen: 1, done: false })).toEqual({ seen: 2, done: false });
  });

  it('reads as never seen when storage refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('refused');
      },
      setItem: () => {
        throw new Error('refused');
      },
    });
    expect(readTip()).toEqual({ seen: 0, done: false });
    expect(() => writeTip({ seen: 1, done: true })).not.toThrow();
  });

  it('keeps what was written', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) });
    writeTip({ seen: 2, done: true });
    expect(kept.has('expanses.sideways-tip')).toBe(true);
    expect(readTip()).toEqual({ seen: 2, done: true });
  });

  it('reads anything malformed as never seen', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"seen":"lots"}', setItem: () => undefined });
    expect(readTip()).toEqual({ seen: 0, done: false });
  });
});
