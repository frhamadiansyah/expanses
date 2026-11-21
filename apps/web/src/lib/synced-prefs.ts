import { type Database, putSyncedPref, syncedPrefRows } from '@expanses/db';

/*
 * Link my devices (spec §2.1): the few choices kept in localStorage that change what the app counts or does — the health
 * ratios' settings, the account a bill's fund is set aside in, the events already converted, the joint accounts' order,
 * the favourite and recent currencies, the name used when sharing. localStorage stays the place each screen reads
 * them from (synchronously, as before); every write is copied into `settings` under `pref.<key>`, which the owner's
 * other devices receive, and at each open — and after a sync brought something — `settings` is copied back.
 * A view choice (List or Table, a hidden balance) is not here: each device keeps its own.
 */

export const SYNCED_PREF_KEYS: readonly string[] = [
  'health.ratio-settings',
  'expanses.sinking-account',
  'cicis.events.converted',
  'wallet.joint-order',
  'expanses.currency.favorites',
  'expanses.currency.recent',
  'cicis.sharing.name',
];

export const prefSettingKey = (key: string) => `pref.${key}`;

let sink: Database | null = null;

/** Where `mirrorPref` copies to: the open database. Set by the open, cleared by a restore. */
export function setPrefDatabase(database: Database | null): void {
  sink = database;
}

/** A synced choice was written to localStorage (or removed, `null`): the same goes into `settings`. Never throws. */
export function mirrorPref(key: string, value: string | null): void {
  if (!sink || !SYNCED_PREF_KEYS.includes(key)) return;
  const write = putSyncedPref(sink, key, value);
  void write.catch((error: unknown) => console.warn('A choice could not be kept for the other devices', error));
}

/**
 * `settings` into localStorage, each synced choice: what another device chose wins over what this one last read. A
 * choice only localStorage holds (made before this build) goes into `settings` once, so it reaches the others.
 */
export async function hydratePrefs(database: Database, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): Promise<void> {
  if (!storage) return;
  const stored = await syncedPrefRows(database);
  for (const key of SYNCED_PREF_KEYS) {
    const kept = stored.get(key);
    try {
      if (kept !== undefined) {
        if (storage.getItem(key) !== kept) storage.setItem(key, kept);
        continue;
      }
      const local = storage.getItem(key);
      if (local !== null) await putSyncedPref(database, key, local, true);
    } catch (error) {
      console.warn('A choice could not be read across devices', error);
    }
  }
}
