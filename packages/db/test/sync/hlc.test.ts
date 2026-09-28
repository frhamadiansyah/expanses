import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/database';
import type { NodeExecutor } from '../../src/node';
import { settings } from '../../src/schema';
import {
  compareHlc,
  decodeHlc,
  driftBlocks,
  encodeHlc,
  HLC_DRIFT_MS,
  localTick,
  localTickRange,
  MAX_HLC_COUNTER,
  MAX_HLC_MS,
  receiveHlc,
  stepHlcState,
} from '../../src/sync/hlc';
import { reserveAndSplit, splitIntoChangeSets } from '../../src/sync/split';
import type { Op } from '../../src/sync/types';
import { setupDb } from '../helpers';

function upsert(id: string): Op {
  return { entity: 'purchase', id, op: 'upsert', fields: { a: 1 } };
}

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function fresh() {
  const db = await setupDb();
  executor = db.executor;
  return db;
}

// hlc.ts's clock functions take a `Tx`, not a plain `Db` — they must run from inside the caller's own
// `database.transaction()` (see hlc.ts's own comment on why). These small wrappers are what any real caller
// looks like: open one transaction, do the clock op, done.
function tick(database: Database, deviceId: string, now?: number): Promise<string> {
  return database.transaction((tx) => localTick(tx, deviceId, now));
}

function tickRange(database: Database, deviceId: string, n: number, now?: number) {
  return database.transaction((tx) => localTickRange(tx, deviceId, n, now));
}

function receive(database: Database, hlc: string): Promise<void> {
  return database.transaction((tx) => receiveHlc(tx, hlc));
}

describe('encodeHlc / decodeHlc', () => {
  it('round-trips ms, counter and deviceId', () => {
    const hlc = encodeHlc(1_700_000_000_000, 7, 'device-a');
    expect(decodeHlc(hlc)).toEqual({ ms: 1_700_000_000_000, counter: 7, deviceId: 'device-a' });
  });

  it('pads ms to 12 hex digits and counter to 4', () => {
    const hlc = encodeHlc(1, 1, 'd');
    expect(hlc).toBe('000000000001' + '0001' + '-d');
  });

  it('rejects a string with no dash at the fixed position', () => {
    expect(() => decodeHlc('not-an-hlc')).toThrow();
  });

  it('throws on a counter or ms that would not fit its fixed width', () => {
    expect(() => encodeHlc(0, MAX_HLC_COUNTER, 'd')).not.toThrow();
    expect(() => encodeHlc(0, MAX_HLC_COUNTER + 1, 'd')).toThrow();
    expect(() => encodeHlc(0, -1, 'd')).toThrow();
    expect(() => encodeHlc(MAX_HLC_MS, 0, 'd')).not.toThrow();
    expect(() => encodeHlc(MAX_HLC_MS + 1, 0, 'd')).toThrow();
    expect(() => encodeHlc(-1, 0, 'd')).toThrow();
  });
});

describe('stepHlcState', () => {
  it('advances the counter at the same ms', () => {
    expect(stepHlcState({ ms: 5, counter: 0 })).toEqual({ ms: 5, counter: 1 });
  });

  it('rolls into the next ms and resets the counter once the counter would overflow', () => {
    expect(stepHlcState({ ms: 5, counter: MAX_HLC_COUNTER })).toEqual({ ms: 6, counter: 0 });
  });
});

describe('compareHlc', () => {
  it('orders by ms first, regardless of device id', () => {
    const earlier = encodeHlc(100, 0, 'zzz');
    const later = encodeHlc(200, 0, 'aaa');
    expect(compareHlc(earlier, later)).toBeLessThan(0);
    expect(compareHlc(later, earlier)).toBeGreaterThan(0);
  });

  it('orders by counter when ms ties', () => {
    const first = encodeHlc(100, 0, 'device');
    const second = encodeHlc(100, 1, 'device');
    expect(compareHlc(first, second)).toBeLessThan(0);
  });

  it('is a total order: device id breaks a tie on ms and counter', () => {
    const a = encodeHlc(100, 0, 'a');
    const b = encodeHlc(100, 0, 'b');
    expect(compareHlc(a, b)).toBeLessThan(0);
    expect(compareHlc(a, a)).toBe(0);
  });
});

describe('localTick', () => {
  it('is monotonic even when the system clock runs backwards', async () => {
    const { database } = await fresh();
    const first = await tick(database, 'device-a', 1_000_000);
    const second = await tick(database, 'device-a', 500_000); // clock jumped back
    const third = await tick(database, 'device-a', 500_000); // still behind, and repeated
    expect(compareHlc(first, second)).toBeLessThan(0);
    expect(compareHlc(second, third)).toBeLessThan(0);
    // The counter advances at the same ms; it does not reset just because the wall clock repeats a value it already passed.
    expect(decodeHlc(second).ms).toBe(decodeHlc(first).ms);
    expect(decodeHlc(third).ms).toBe(decodeHlc(first).ms);
  });

  it('resets the counter once the wall clock moves past the stored ms', async () => {
    const { database } = await fresh();
    const first = await tick(database, 'device-a', 1_000_000);
    const second = await tick(database, 'device-a', 1_000_000); // same ms: counter bumps
    const third = await tick(database, 'device-a', 2_000_000); // clock caught up: counter resets
    expect(decodeHlc(first).counter).toBe(0);
    expect(decodeHlc(second).counter).toBe(1);
    expect(decodeHlc(third)).toEqual({ ms: 2_000_000, counter: 0, deviceId: 'device-a' });
  });

  it('persists state in settings under sync.hlc', async () => {
    const { database } = await fresh();
    await tick(database, 'device-a', 42);
    const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${'sync.hlc'}`);
    expect(row).toBeDefined();
  });

  it('rolls ms forward and resets the counter once the counter would overflow', async () => {
    const { database } = await fresh();
    // Seed the clock state right at the counter's max, at a fixed ms.
    await database.db.insert(settings).values({ key: 'sync.hlc', value: JSON.stringify({ ms: 1_000, counter: MAX_HLC_COUNTER }) });
    const next = await tick(database, 'device-a', 500); // clock behind: stays at the stored ms, steps the counter
    expect(decodeHlc(next)).toEqual({ ms: 1_001, counter: 0, deviceId: 'device-a' });
  });

  it('never hands out the same hlc twice even from concurrent database.transaction() callers (the bug fix round 2 found)', async () => {
    const { database } = await fresh();
    // Each `tick()` opens its own transaction; `Database`'s single mutex means only one runs at a time, but before
    // this fix, hlc.ts's own read-then-write raced independently of that mutex whenever two different `Db`/`Tx`
    // handles were involved (`database.db` vs. a transaction's `tx`, or two transactions in a row racing this
    // file's separate lock). Now there is no lock in hlc.ts at all — correctness comes entirely from each call
    // running inside one transaction, which is what every one of these concurrent callers does.
    const results = await Promise.all(Array.from({ length: 20 }, () => tick(database, 'device-a', 1_000)));
    expect(new Set(results).size).toBe(20);
  });
});

describe('localTickRange', () => {
  it('reserves n consecutive ticks and returns the first', async () => {
    const { database } = await fresh();
    const start = await tickRange(database, 'device-a', 5, 1_000);
    expect(start).toEqual({ ms: 1_000, counter: 0 });
    // The reservation is consumed: the next ordinary tick starts after all 5 reserved steps, not after just 1.
    const next = await tick(database, 'device-a', 1_000);
    let expected = start;
    for (let i = 0; i < 5; i += 1) expected = stepHlcState(expected);
    expect(decodeHlc(next)).toEqual({ ...expected, deviceId: 'device-a' });
  });

  it('rolls into the next ms mid-reservation on counter overflow, same as stepHlcState', async () => {
    const { database } = await fresh();
    // Seed the clock one step below the counter's max, then reserve across the boundary.
    const seeded = JSON.stringify({ ms: 2_000, counter: MAX_HLC_COUNTER - 1 });
    await database.db.insert(settings).values({ key: 'sync.hlc', value: seeded }).onConflictDoUpdate({ target: settings.key, set: { value: seeded } });
    const first = await tickRange(database, 'device-a', 1, 500); // clock behind: one step from the seeded state
    expect(first).toEqual({ ms: 2_000, counter: MAX_HLC_COUNTER });
    const second = await tickRange(database, 'device-a', 1, 500); // one more step: rolls over
    expect(second).toEqual({ ms: 2_001, counter: 0 });
  });

  it('a real localTick after a split never collides with any hlc the split used (regression: reserved counters must be consumed)', async () => {
    const { database } = await fresh();
    const ops = Array.from({ length: 450 }, (_, i) => upsert(`row-${i}`)); // needs 3 change-sets at 200/set
    const n = 3;
    const start = await tickRange(database, 'device-a', n, 5_000);
    const changeSets = splitIntoChangeSets(ops, 'member-1', { ...start, deviceId: 'device-a' });
    expect(changeSets).toHaveLength(n);

    const usedHlcs = changeSets.map((cs) => cs.hlc);
    const nextTick = await tick(database, 'device-a', 5_000); // same wall-clock reading as the split used

    expect(usedHlcs).not.toContain(nextTick);
    for (const used of usedHlcs) expect(compareHlc(nextTick, used)).toBeGreaterThan(0);
  });

  it("the last hlc reserveAndSplit hands out equals the clock's persisted state (the helper never under- or over-reserves)", async () => {
    const { database } = await fresh();
    const ops = Array.from({ length: 450 }, (_, i) => upsert(`row-${i}`));
    const changeSets = await database.transaction((tx) => reserveAndSplit(tx, 'device-a', 'member-1', ops, 5_000));
    const lastAssigned = decodeHlc(changeSets[changeSets.length - 1]!.hlc);
    const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${'sync.hlc'}`);
    expect(JSON.parse(row![0])).toEqual({ ms: lastAssigned.ms, counter: lastAssigned.counter });
  });
});

describe('receiveHlc', () => {
  it('advances the stored ms to the received hlc, so the next local tick jumps ahead of it', async () => {
    const { database } = await fresh();
    await tick(database, 'device-a', 1_000);
    await receive(database, encodeHlc(5_000, 3, 'device-b'));
    const next = await tick(database, 'device-a', 1_000); // this device's own clock is still behind
    expect(decodeHlc(next).ms).toBe(5_000);
  });

  it('never moves the stored ms backwards, and leaves the counter alone too', async () => {
    const { database } = await fresh();
    const own = await tick(database, 'device-a', 10_000); // ms=10_000, counter=0
    await receive(database, encodeHlc(1_000, 9, 'device-b')); // older than what we already have
    const next = await tick(database, 'device-a', 1);
    expect(decodeHlc(next)).toEqual({ ms: 10_000, counter: decodeHlc(own).counter + 1, deviceId: 'device-a' });
  });

  it('adopts the remote counter too when ms ties (standard HLC receive), not just ms', async () => {
    const { database } = await fresh();
    await tick(database, 'device-a', 1_000); // ms=1_000, counter=0
    await receive(database, encodeHlc(1_000, 9, 'device-b')); // same ms, higher counter
    const next = await tick(database, 'device-a', 1_000);
    expect(decodeHlc(next)).toEqual({ ms: 1_000, counter: 10, deviceId: 'device-a' });
  });

  it('does nothing when ms ties and the remote counter is not higher', async () => {
    const { database } = await fresh();
    await tick(database, 'device-a', 1_000); // ms=1_000, counter=0
    await receive(database, encodeHlc(1_000, 0, 'device-b')); // same ms, same counter
    const next = await tick(database, 'device-a', 1_000);
    expect(decodeHlc(next)).toEqual({ ms: 1_000, counter: 1, deviceId: 'device-a' }); // as if the receive never happened
  });

  it('causality: a local write made right after receiving always sorts after what it received (the bug this fixes)', async () => {
    const { database } = await fresh();
    await tick(database, 'device-a', 1_000);
    const remote = encodeHlc(1_000, 5, 'device-b'); // same ms, higher counter than device-a has ticked to
    await receive(database, remote);
    const causallyAfter = await tick(database, 'device-a', 1_000);
    // Before the fix, the stored counter stayed at device-a's own (lower) value, so this could sort *before* `remote`
    // despite happening causally after receiving it.
    expect(compareHlc(causallyAfter, remote)).toBeGreaterThan(0);
  });
});

describe('the 24h drift rule', () => {
  it('blocks a change-set whose ms is more than 24h ahead of the receiving clock', () => {
    const now = 1_000_000;
    expect(driftBlocks(now + HLC_DRIFT_MS + 1, now)).toBe(true);
    expect(driftBlocks(now + HLC_DRIFT_MS, now)).toBe(false);
  });

  it('releases once the device clock passes ms - 24h', () => {
    const incomingMs = 10_000_000;
    const stillBlocked = incomingMs - HLC_DRIFT_MS - 1;
    const noLongerBlocked = incomingMs - HLC_DRIFT_MS;
    expect(driftBlocks(incomingMs, stillBlocked)).toBe(true);
    expect(driftBlocks(incomingMs, noLongerBlocked)).toBe(false);
  });
});
