import { eq } from 'drizzle-orm';
import type { Tx } from '../database';
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

/** The counter's width is 4 hex digits (spec §6.1): the highest value it can hold before it must roll into `ms`. */
export const MAX_HLC_COUNTER = 0xffff;

/** The ms segment's width is 12 hex digits: the highest value `encodeHlc` accepts. */
export const MAX_HLC_MS = 0xffffffffffff;

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

/**
 * Serialises a clock reading for one device into the spec's fixed-width string form. Throws on a `ms` or `counter`
 * that would not fit its fixed width — every caller that advances the clock (`localTick`, `localTickRange`,
 * `splitIntoChangeSets`) rolls the counter into `ms` before it gets here (see `stepHlcState`), so this is a
 * contract check, not a path any of them is expected to hit.
 */
export function encodeHlc(ms: number, counter: number, deviceId: string): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_HLC_MS) throw new Error(`hlc ms out of range: ${ms}`);
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_HLC_COUNTER) throw new Error(`hlc counter out of range: ${counter}`);
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

/**
 * One clock step at a fixed `ms`, rolling into the next `ms` when the counter would overflow its 4-hex-digit width
 * (spec ruling: on overflow, `ms += 1, counter = 0`). Shared by `localTick`, `localTickRange` and
 * `splitIntoChangeSets` (via `SplitStart`) so a reservation and the hlcs later assigned from it always agree.
 */
export function stepHlcState(state: HlcClockState): HlcClockState {
  return state.counter >= MAX_HLC_COUNTER ? { ms: state.ms + 1, counter: 0 } : { ms: state.ms, counter: state.counter + 1 };
}

async function readClockState(tx: Tx): Promise<HlcClockState> {
  const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, HLC_SETTINGS_KEY));
  if (!row) return { ms: 0, counter: 0 };
  const parsed = JSON.parse(row.value) as Partial<HlcClockState>;
  return { ms: parsed.ms ?? 0, counter: parsed.counter ?? 0 };
}

async function writeClockState(tx: Tx, state: HlcClockState): Promise<void> {
  const value = JSON.stringify(state);
  await tx.insert(settings).values({ key: HLC_SETTINGS_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * A local write's tick (spec §6.1): `ms = max(nowMs, lastMs)`; if `ms == lastMs` the counter advances (rolling
 * into `ms` on overflow), else it resets to 0. Persists the new state before returning the encoded hlc.
 *
 * Takes a `Tx`, not a plain `Db` — it must run from inside the caller's own `database.transaction()` (spec §6.3:
 * capture always does). That transaction holds `Database`'s single mutex for its *entire* duration, so the read
 * here and the write below can never be interleaved by another tick, another receive, or anything else touching
 * this `Database`: nothing else runs until the transaction returns. Calling this against `database.db` directly
 * would not be safe — that handle only holds the mutex per individual query, not across the read-then-write pair —
 * which is exactly why the type asks for a `Tx` and not a `Db`.
 */
export async function localTick(tx: Tx, deviceId: string, now: number = Date.now()): Promise<string> {
  const state = await readClockState(tx);
  const next = now > state.ms ? { ms: now, counter: 0 } : stepHlcState(state);
  await writeClockState(tx, next);
  return encodeHlc(next.ms, next.counter, deviceId);
}

/**
 * Reserves `n` consecutive clock ticks at once — what cutting a local write into several change-sets needs, so the
 * counters assigned to them are never handed out again by a later `localTick` (spec §6.2; see `reserveAndSplit` in
 * split.ts, which is how a caller should normally reach this). Returns the first reading; the rest follow by
 * `stepHlcState`, the exact function this reservation itself used to skip past them, so the two sequences always
 * agree. Same `Tx` requirement as `localTick`, and for the same reason.
 */
export async function localTickRange(tx: Tx, deviceId: string, n: number, now: number = Date.now()): Promise<HlcClockState> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`localTickRange: n must be a positive integer, got ${n}`);
  const state = await readClockState(tx);
  let next = now > state.ms ? { ms: now, counter: 0 } : stepHlcState(state);
  const start = next;
  for (let i = 1; i < n; i += 1) next = stepHlcState(next);
  await writeClockState(tx, next);
  void deviceId; // deviceId is not part of the persisted state; kept in the signature to mirror localTick's shape.
  return start;
}

/**
 * Applying a change-set (spec §6.1, corrected): the standard HLC receive rule. If the remote `ms` is strictly
 * ahead, this device's clock adopts it wholesale — `ms` **and** `counter` — rather than keeping its own counter,
 * which would let a local write made right after receiving sort *before* the change-set that caused it. If the
 * `ms` ties, the higher counter wins, for the same reason. An older or equal-and-lower message changes nothing:
 * this device's clock is already ahead of it. Same `Tx` requirement as `localTick` — apply (task 4) already runs
 * inside its own transaction per change-set (spec §7.1), which is where this is called from.
 */
export async function receiveHlc(tx: Tx, hlc: string): Promise<void> {
  const { ms, counter } = decodeHlc(hlc);
  const state = await readClockState(tx);
  if (ms > state.ms) await writeClockState(tx, { ms, counter });
  else if (ms === state.ms && counter > state.counter) await writeClockState(tx, { ms, counter });
}

/**
 * The 24 h drift rule (spec §6.1): a change-set whose `ms` is more than `HLC_DRIFT_MS` ahead of the receiving
 * device's own clock is blocked. Pure so apply (task 4) can call it per change-set without touching the database,
 * and re-check it later once the device's own clock has moved on.
 */
export function driftBlocks(incomingMs: number, receivingNowMs: number): boolean {
  return incomingMs - receivingNowMs > HLC_DRIFT_MS;
}
