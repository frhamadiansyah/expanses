import { eq } from 'drizzle-orm';
import type { Db } from '../database';
import { settings } from '../schema';

/*
 * The hybrid logical clock (spec §6.1). `hlc = hex(ms, 12 digits) + hex(counter, 4 digits) + '-' + deviceId`,
 * compared as strings: fixed-width hex segments make lexicographic order match (ms, counter) order, with the
 * device id as a final, harmless tie-break.
 *
 * The clock's own state — the highest `ms` this device has produced or seen, and the counter last used at that
 * `ms` — is device-wide (one clock, not one per book) and kept in `settings` under `sync.hlc`.
 */

export const HLC_SETTINGS_KEY = 'sync.hlc';

/** A change-set more than this far ahead of the receiving clock is not applied and blocks the cursor (spec §6.1). */
export const HLC_DRIFT_MS = 24 * 60 * 60 * 1000;

export interface HlcClockState {
  ms: number;
  counter: number;
}

export interface DecodedHlc extends HlcClockState {
  deviceId: string;
}

function hex(value: number, digits: number): string {
  return value.toString(16).padStart(digits, '0');
}

/** Serialises a clock reading for one device into the spec's fixed-width string form. */
export function encodeHlc(ms: number, counter: number, deviceId: string): string {
  return `${hex(ms, 12)}${hex(counter, 4)}-${deviceId}`;
}

/** The inverse of `encodeHlc`. Throws on a string that is not `<12 hex><4 hex>-<deviceId>`. */
export function decodeHlc(hlc: string): DecodedHlc {
  const dash = hlc.indexOf('-');
  if (dash !== 16) throw new Error(`"${hlc}" is not a valid hlc`);
  const ms = Number.parseInt(hlc.slice(0, 12), 16);
  const counter = Number.parseInt(hlc.slice(12, 16), 16);
  const deviceId = hlc.slice(dash + 1);
  if (!Number.isFinite(ms) || !Number.isFinite(counter) || !deviceId) throw new Error(`"${hlc}" is not a valid hlc`);
  return { ms, counter, deviceId };
}

/** Total order over encoded hlc strings — a plain string compare, as the spec states it. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function readClockState(db: Db): Promise<HlcClockState> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, HLC_SETTINGS_KEY));
  if (!row) return { ms: 0, counter: 0 };
  const parsed = JSON.parse(row.value) as Partial<HlcClockState>;
  return { ms: parsed.ms ?? 0, counter: parsed.counter ?? 0 };
}

async function writeClockState(db: Db, state: HlcClockState): Promise<void> {
  const value = JSON.stringify(state);
  await db.insert(settings).values({ key: HLC_SETTINGS_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * A local write's tick (spec §6.1): `ms = max(nowMs, lastMs)`; if `ms == lastMs` the counter advances, else it
 * resets to 0. Persists the new state before returning the encoded hlc, so two ticks never collide even across a
 * clock that runs backwards.
 */
export async function localTick(db: Db, deviceId: string, now: number = Date.now()): Promise<string> {
  const state = await readClockState(db);
  const ms = Math.max(now, state.ms);
  const counter = ms === state.ms ? state.counter + 1 : 0;
  await writeClockState(db, { ms, counter });
  return encodeHlc(ms, counter, deviceId);
}

/**
 * Applying a change-set (spec §6.1): `lastMs = max(lastMs, its ms)`. The counter is left alone — it belongs to
 * this device's own next local tick, not to what it just received.
 */
export async function receiveHlc(db: Db, hlc: string): Promise<void> {
  const { ms } = decodeHlc(hlc);
  const state = await readClockState(db);
  if (ms > state.ms) await writeClockState(db, { ms, counter: state.counter });
}

/**
 * The 24 h drift rule (spec §6.1): a change-set whose `ms` is more than `HLC_DRIFT_MS` ahead of the receiving
 * device's own clock is blocked. Pure so apply (task 4) can call it per change-set without touching the database,
 * and re-check it later once the device's own clock has moved on.
 */
export function driftBlocks(incomingMs: number, receivingNowMs: number): boolean {
  return incomingMs - receivingNowMs > HLC_DRIFT_MS;
}
