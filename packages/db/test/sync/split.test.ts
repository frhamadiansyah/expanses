import { describe, expect, it } from 'vitest';
import { decodeHlc } from '../../src/sync/hlc';
import { MAX_CHANGE_SET_BYTES, MAX_OPS_PER_CHANGE_SET, splitIntoChangeSets } from '../../src/sync/split';
import type { Op } from '../../src/sync/types';

function upsert(id: string, fields: Record<string, unknown> = { a: 1 }): Op {
  return { entity: 'purchase', id, op: 'upsert', fields };
}

describe('splitIntoChangeSets', () => {
  it('returns nothing for no ops', () => {
    expect(splitIntoChangeSets([], 'member-1', { ms: 1, counter: 0, deviceId: 'd' })).toEqual([]);
  });

  it('keeps a small batch in one change-set, at the starting hlc', () => {
    const ops = [upsert('a'), upsert('b'), upsert('c')];
    const [changeSet, ...rest] = splitIntoChangeSets(ops, 'member-1', { ms: 1_000, counter: 5, deviceId: 'device-a' });
    expect(rest).toHaveLength(0);
    expect(changeSet).toEqual({ v: 1, hlc: expect.any(String), member: 'member-1', ops });
    expect(decodeHlc(changeSet!.hlc)).toEqual({ ms: 1_000, counter: 5, deviceId: 'device-a' });
  });

  it('cuts a 3,000-op import into fifteen change-sets of 200 ops each, in order', () => {
    const ops = Array.from({ length: 3_000 }, (_, i) => upsert(`row-${i}`));
    const changeSets = splitIntoChangeSets(ops, 'member-1', { ms: 1, counter: 0, deviceId: 'device-a' });
    expect(changeSets).toHaveLength(15);
    for (const cs of changeSets) expect(cs.ops).toHaveLength(MAX_OPS_PER_CHANGE_SET);
    expect(changeSets.flatMap((cs) => cs.ops)).toEqual(ops);
  });

  it('gives consecutive hlcs (counter + 1 each), same ms and device', () => {
    const ops = Array.from({ length: 450 }, (_, i) => upsert(`row-${i}`));
    const changeSets = splitIntoChangeSets(ops, 'member-1', { ms: 9_000, counter: 3, deviceId: 'device-a' });
    expect(changeSets.length).toBeGreaterThan(1);
    const decoded = changeSets.map((cs) => decodeHlc(cs.hlc));
    for (const d of decoded) {
      expect(d.ms).toBe(9_000);
      expect(d.deviceId).toBe('device-a');
    }
    const counters = decoded.map((d) => d.counter);
    expect(counters).toEqual(counters.map((_, i) => 3 + i));
  });

  it('starts a new change-set once 64 KB of JSON would be exceeded, without truncating any op', () => {
    const big = 'x'.repeat(2_000);
    const ops = Array.from({ length: 60 }, (_, i) => upsert(`row-${i}`, { note: big }));
    const changeSets = splitIntoChangeSets(ops, 'member-1', { ms: 1, counter: 0, deviceId: 'device-a' });
    expect(changeSets.length).toBeGreaterThan(1);
    for (const cs of changeSets) {
      expect(new TextEncoder().encode(JSON.stringify(cs)).length).toBeLessThanOrEqual(MAX_CHANGE_SET_BYTES);
    }
    expect(changeSets.flatMap((cs) => cs.ops)).toEqual(ops);
  });

  it('still emits a lone op that alone is over the byte budget, rather than dropping it', () => {
    const huge = 'x'.repeat(MAX_CHANGE_SET_BYTES + 1_000);
    const ops = [upsert('a', { note: huge })];
    const changeSets = splitIntoChangeSets(ops, 'member-1', { ms: 1, counter: 0, deviceId: 'device-a' });
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]!.ops).toEqual(ops);
  });
});
