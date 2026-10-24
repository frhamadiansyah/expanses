import { DEFAULT_DEBT_SERVICE_BPS, EMERGENCY_BASES, type RatioSettings } from '@expanses/core';
import { useSyncExternalStore } from 'react';

/**
 * The two settings the ratios are read with, on this device: what the emergency fund counts and which debt-servicing
 * guide it is graded against. They were state on the Financial health screen, forgotten on the way out; now they are
 * set on its Settings page and read back on the screen, so they are kept here, in the one place both pages reach.
 * A way of reading the money and not a fact about it, so one device's choice, never synced.
 */
export type HealthSettings = Pick<RatioSettings, 'emergencyBase' | 'debtServiceBenchmarkBps'>;

export const HEALTH_SETTINGS_KEY = 'health.ratio-settings';

const DEFAULTS: HealthSettings = { debtServiceBenchmarkBps: DEFAULT_DEBT_SERVICE_BPS };

/**
 * What this device remembered, or the defaults. The base stays unset until it is switched: until then the screen
 * reads the emergency goal's own. Storage that cannot be read (a private window) reads as the defaults.
 */
export function readHealthSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): HealthSettings {
  try {
    const raw = storage?.getItem(HEALTH_SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof HealthSettings, unknown>>;
    const base = EMERGENCY_BASES.find((each) => each === parsed.emergencyBase);
    const bps = typeof parsed.debtServiceBenchmarkBps === 'number' && parsed.debtServiceBenchmarkBps > 0 ? parsed.debtServiceBenchmarkBps : DEFAULT_DEBT_SERVICE_BPS;
    return base ? { emergencyBase: base, debtServiceBenchmarkBps: bps } : { debtServiceBenchmarkBps: bps };
  } catch {
    return DEFAULTS;
  }
}

/** Remembers the settings; storage that cannot be written leaves them for this visit only. */
export function writeHealthSettings(settings: HealthSettings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(HEALTH_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* Nothing to do: the ratios still read the new setting, it is only not remembered. */
  }
}

// One copy for every screen that reads it, so a change on Settings is seen on Financial health without a reload.
let current: HealthSettings | null = null;
const listeners = new Set<() => void>();
const snapshot = () => (current ??= readHealthSettings());
const subscribe = (listen: () => void) => {
  listeners.add(listen);
  return () => void listeners.delete(listen);
};

export function useHealthSettings(): HealthSettings {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function changeHealthSettings(change: Partial<HealthSettings>): void {
  current = { ...snapshot(), ...change };
  writeHealthSettings(current);
  for (const listen of listeners) listen();
}
