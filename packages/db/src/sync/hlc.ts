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
 * Serialises the read-then-write pair every clock-advancing function below does, per `db` handle. A single query
 * through `database.db` (or a `tx`) is already serialized by `Database`'s own mutex, but that only covers one
 * query at a time — two callers reading, then both writing, would race and one tick would be lost. Keyed on the
 * exact `Db` object passed in: the same object every caller within one `Database` reuses (`database.db`, or the
 * single `direct` handle every transaction gets), so repeated calls through either are serialised against
 * themselves. A `database.db` call cannot itself race a `transaction()` call, since `Database`'s own mutex already
 * only ever runs one of its queries or one whole transaction at a time.
 */
const clockLocks = new WeakMap<Db, Promise<unknown>>();

function withClockLock<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const tail = clockLocks.get(db) ?? Promise.resolve();
  const result = tail.then(fn, fn);
  clockLocks.set(
    db,
    result.catch(() => undefined),
  );
  return result;
}

/**
 * A local write's tick (spec §6.1): `ms = max(nowMs, lastMs)`; if `ms == lastMs` the counter advances (rolling
 * into `ms` on overflow), else it resets to 0. Persists the new state before returning the encoded hlc, so two
 * ticks — even concurrent ones — never collide, and a clock that runs backwards never repeats a value.
 */
export async function localTick(db: Db, deviceId: string, now: number = Date.now()): Promise<string> {
  return withClockLock(db, async () => {
    const state = await readClockState(db);
    const next = now > state.ms ? { ms: now, counter: 0 } : stepHlcState(state);
    await writeClockState(db, next);
    return encodeHlc(next.ms, next.counter, deviceId);
  });
}

/**
 * Reserves `n` consecutive clock ticks at once — what `splitIntoChangeSets` needs when a local write is cut into
 * several change-sets, so the counters it assigns are never handed out again by a later `localTick` (spec §6.2).
 * Returns the first reading; the caller (or `splitIntoChangeSets`) derives the rest with `stepHlcState`, the exact
 * function this reservation itself used to skip past them, so the two sequences always agree.
 */
export async function localTickRange(db: Db, deviceId: string, n: number, now: number = Date.now()): Promise<HlcClockState> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`localTickRange: n must be a positive integer, got ${n}`);
  return withClockLock(db, async () => {
    const state = await readClockState(db);
    let next = now > state.ms ? { ms: now, counter: 0 } : stepHlcState(state);
    const start = next;
    for (let i = 1; i < n; i += 1) next = stepHlcState(next);
    await writeClockState(db, next);
    void deviceId; // deviceId is not part of the persisted state; kept in the signature to mirror localTick's shape.
    return start;
  });
}

/**
 * Applying a change-set (spec §6.1, corrected): the standard HLC receive rule. If the remote `ms` is strictly
 * ahead, this device's clock adopts it wholesale — `ms` **and** `counter` — rather than keeping its own counter,
 * which would let a local write made right after receiving sort *before* the change-set that caused it. If the
 * `ms` ties, the higher counter wins, for the same reason. An older or equal-and-lower message changes nothing:
 * this device's clock is already ahead of it.
 */
export async function receiveHlc(db: Db, hlc: string): Promise<void> {
  const { ms, counter } = decodeHlc(hlc);
  await withClockLock(db, async () => {
    const state = await readClockState(db);
    if (ms > state.ms) await writeClockState(db, { ms, counter });
    else if (ms === state.ms && counter > state.counter) await writeClockState(db, { ms, counter });
  });
}

/**
 * The 24 h drift rule (spec §6.1): a change-set whose `ms` is more than `HLC_DRIFT_MS` ahead of the receiving
 * device's own clock is blocked. Pure so apply (task 4) can call it per change-set without touching the database,
 * and re-check it later once the device's own clock has moved on.
 */
export function driftBlocks(incomingMs: number, receivingNowMs: number): boolean {
  return incomingMs - receivingNowMs > HLC_DRIFT_MS;
}
