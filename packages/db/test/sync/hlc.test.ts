import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NodeExecutor } from '../../src/node';
import { compareHlc, decodeHlc, driftBlocks, encodeHlc, HLC_DRIFT_MS, localTick, receiveHlc } from '../../src/sync/hlc';
import { setupDb } from '../helpers';

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
    const first = await localTick(database.db, 'device-a', 1_000_000);
    const second = await localTick(database.db, 'device-a', 500_000); // clock jumped back
    const third = await localTick(database.db, 'device-a', 500_000); // still behind, and repeated
    expect(compareHlc(first, second)).toBeLessThan(0);
    expect(compareHlc(second, third)).toBeLessThan(0);
    // The counter advances at the same ms; it does not reset just because the wall clock repeats a value it already passed.
    expect(decodeHlc(second).ms).toBe(decodeHlc(first).ms);
    expect(decodeHlc(third).ms).toBe(decodeHlc(first).ms);
  });

  it('resets the counter once the wall clock moves past the stored ms', async () => {
    const { database } = await fresh();
    const first = await localTick(database.db, 'device-a', 1_000_000);
    const second = await localTick(database.db, 'device-a', 1_000_000); // same ms: counter bumps
    const third = await localTick(database.db, 'device-a', 2_000_000); // clock caught up: counter resets
    expect(decodeHlc(first).counter).toBe(0);
    expect(decodeHlc(second).counter).toBe(1);
    expect(decodeHlc(third)).toEqual({ ms: 2_000_000, counter: 0, deviceId: 'device-a' });
  });

  it('persists state in settings under sync.hlc', async () => {
    const { database } = await fresh();
    await localTick(database.db, 'device-a', 42);
    const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${'sync.hlc'}`);
    expect(row).toBeDefined();
  });
});

describe('receiveHlc', () => {
  it('advances the stored ms to the received hlc, so the next local tick jumps ahead of it', async () => {
    const { database } = await fresh();
    await localTick(database.db, 'device-a', 1_000);
    await receiveHlc(database.db, encodeHlc(5_000, 3, 'device-b'));
    const next = await localTick(database.db, 'device-a', 1_000); // this device's own clock is still behind
    expect(decodeHlc(next).ms).toBe(5_000);
  });

  it('never moves the stored ms backwards', async () => {
    const { database } = await fresh();
    await localTick(database.db, 'device-a', 10_000);
    await receiveHlc(database.db, encodeHlc(1_000, 9, 'device-b')); // older than what we already have
    const next = await localTick(database.db, 'device-a', 1);
    expect(decodeHlc(next).ms).toBe(10_000);
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
