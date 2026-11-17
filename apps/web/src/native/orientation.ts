import { ScreenOrientation } from '@capacitor/screen-orientation';
import { useEffect } from 'react';
import { isMacApp } from '../lib/mac';
import { isNative } from '../lib/pwa';

/**
 * Which way the iPhone app may turn on a page. Only Cashflow itself, at exactly `/transactions`, may go sideways,
 * where it shows the wide-screen table full screen. Everything opened from it — the Add form, a receipt, Paste a
 * list — and every other page stays upright, so no other page is ever laid out sideways (spec, settled point 1).
 */
export function rotationFor(pathname: string): 'free' | 'portrait' {
  return pathname === '/transactions' || pathname === '/transactions/' ? 'free' : 'portrait';
}

/** Upright, before the first page is drawn. Info.plist lists landscape too, so the lock is what holds it. */
export async function lockPortrait(): Promise<void> {
  try {
    await ScreenOrientation.lock({ orientation: 'portrait' });
  } catch (error) {
    console.warn('The screen was not locked upright', error);
  }
}

/** Frees the turn on entering Cashflow and locks it upright again on leaving. In the iPhone app only, not the Mac app. */
export function useCashflowRotation(pathname: string): void {
  const rotation = rotationFor(pathname);
  useEffect(() => {
    if (!isNative() || isMacApp()) return;
    const turn = rotation === 'free' ? ScreenOrientation.unlock() : ScreenOrientation.lock({ orientation: 'portrait' });
    void turn.catch((error: unknown) => console.warn('The screen turn was not set', error));
  }, [rotation]);
}
