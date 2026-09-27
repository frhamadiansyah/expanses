import { Capacitor } from '@capacitor/core';

/** True inside the Capacitor iOS/Android shell, where the app is already installed and served by the app itself. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

export function registerServiceWorker(): void {
  // The native shell serves every file from the app bundle: an offline cache would only be a second copy that can go stale.
  if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}

/** Asks the browser not to evict this origin's storage. Returns null when unsupported. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export function isStandalone(): boolean {
  return isNative() || window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
