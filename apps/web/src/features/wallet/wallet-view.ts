import { useSyncExternalStore } from 'react';

/**
 * How Wallet lays its cards out, on this device: the pile (`stack`), two columns of whole faces with a caption each
 * (`grid`), or one card at a time with its recent rows under it (`carousel`). The same cards, in the same order,
 * read three ways; a way of looking at the money and not a fact about it, so one device's choice, never synced.
 */
export const WALLET_VIEWS = ['stack', 'grid', 'carousel'] as const;
export type WalletView = (typeof WALLET_VIEWS)[number];

/** What each view is called in the View menu. */
export const WALLET_VIEW_LABELS: Record<WalletView, string> = { stack: 'Stack', grid: 'Grid', carousel: 'Carousel' };

export const WALLET_VIEW_KEY = 'wallet.view';

const DEFAULT: WalletView = 'stack';

/** The view this device chose, or the stack. A value it does not know, or storage that cannot be read, reads as the stack. */
export function readWalletView(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): WalletView {
  try {
    const raw = storage?.getItem(WALLET_VIEW_KEY);
    return WALLET_VIEWS.find((view) => view === raw) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Remembers the choice; the stack, being the default, is remembered as nothing. Storage that refuses leaves it for this visit. */
export function writeWalletView(view: WalletView, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (view === DEFAULT) storage?.removeItem(WALLET_VIEW_KEY);
    else storage?.setItem(WALLET_VIEW_KEY, view);
  } catch {
    /* Nothing to do: the cards are still laid out the new way, it is only not remembered. */
  }
}

// One copy for the page and its corner, so the menu's tick and the cards agree without a reload.
let current: WalletView | null = null;
const listeners = new Set<() => void>();
const snapshot = () => (current ??= readWalletView());
const notify = () => {
  for (const listen of listeners) listen();
};
// Another tab of the app choosing a view agrees with it, as the Balance box's eye does.
const onStorage = (event: StorageEvent) => {
  if (event.key !== WALLET_VIEW_KEY && event.key !== null) return;
  current = readWalletView();
  notify();
};
const subscribe = (listen: () => void) => {
  if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

export function useWalletView(): WalletView {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function changeWalletView(view: WalletView): void {
  current = view;
  writeWalletView(view);
  notify();
}
