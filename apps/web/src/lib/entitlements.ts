import { useSyncExternalStore } from 'react';

/** What the paid tier unlocks. Never the ability to record something owned — only the convenience (spec §6.5). */
export type Entitlement = 'foreign_securities';
const KNOWN: readonly Entitlement[] = ['foreign_securities'];

/**
 * The one place that says what is granted. Today its source is a device-local list, written by the preview switch on
 * the hidden developer settings screen (the owner's ruling) and by the end-to-end tests; when store purchases exist,
 * this module reads them instead and nothing else changes.
 */
export const ENTITLEMENTS_KEY = 'expanses.entitlements';

type Readable = Pick<Storage, 'getItem'>;
type Writable = Pick<Storage, 'getItem' | 'setItem'>;

function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Every string the list holds, as written — so a switch never drops an entry this build does not know. */
function storedList(storage: Readable | null): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(ENTITLEMENTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function grantedEntitlements(storage: Readable | null = deviceStorage()): ReadonlySet<Entitlement> {
  const listed = storedList(storage);
  return new Set(KNOWN.filter((known) => listed.includes(known)));
}

export const hasEntitlement = (entitlement: Entitlement, storage?: Readable | null): boolean =>
  grantedEntitlements(storage === undefined ? deviceStorage() : storage).has(entitlement);

const listeners = new Set<() => void>();

/** The preview switch: grants or withdraws one entitlement on this device. Withdrawing is exactly a lapse. */
export function setPreviewEntitlement(entitlement: Entitlement, on: boolean, storage: Writable | null = deviceStorage()): void {
  if (!storage) return;
  const rest = storedList(storage).filter((item) => item !== entitlement);
  storage.setItem(ENTITLEMENTS_KEY, JSON.stringify(on ? [...rest, entitlement] : rest));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab flipping the switch reaches this one too.
  const onStorage = (event: StorageEvent) => event.key === ENTITLEMENTS_KEY && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Read on every change of the list, so a screen already open follows the switch. */
export function useEntitlement(entitlement: Entitlement): boolean {
  return useSyncExternalStore(subscribe, () => hasEntitlement(entitlement), () => false);
}
