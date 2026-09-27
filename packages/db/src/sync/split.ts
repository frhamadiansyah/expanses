import { encodeHlc } from './hlc';
import type { ChangeSet, Op } from './types';

/*
 * Cutting a local database transaction's ops into change-sets (spec §6.2): at most 200 ops and 64 KB of JSON each,
 * consecutive hlcs (counter + 1 each), in op order. An import of 3,000 rows is fifteen entries.
 */

export const MAX_OPS_PER_CHANGE_SET = 200;
export const MAX_CHANGE_SET_BYTES = 64 * 1024;

const encoder = new TextEncoder();

function byteSizeOf(changeSet: ChangeSet): number {
  return encoder.encode(JSON.stringify(changeSet)).length;
}

/** Where a change-set's hlc starts: the ms and counter of its first op, and the device cutting it. */
export interface SplitStart {
  ms: number;
  counter: number;
  deviceId: string;
}

/**
 * Cuts `ops` (already in the order they must apply) into `ChangeSet`s no larger than the spec's limits, each
 * carrying the next hlc after the previous one's. Empty input yields no change-sets.
 */
export function splitIntoChangeSets(ops: readonly Op[], member: string, start: SplitStart): ChangeSet[] {
  const changeSets: ChangeSet[] = [];
  let counter = start.counter;
  let current: Op[] = [];

  const flush = () => {
    if (current.length === 0) return;
    changeSets.push({ v: 1, hlc: encodeHlc(start.ms, counter, start.deviceId), member, ops: current });
    counter += 1;
    current = [];
  };

  for (const op of ops) {
    const trial = [...current, op];
    const trialChangeSet: ChangeSet = { v: 1, hlc: encodeHlc(start.ms, counter, start.deviceId), member, ops: trial };
    const overSize = trial.length > MAX_OPS_PER_CHANGE_SET || byteSizeOf(trialChangeSet) > MAX_CHANGE_SET_BYTES;
    // A lone op over budget cannot be split smaller: it goes out on its own rather than being dropped.
    if (overSize && current.length > 0) {
      flush();
      current.push(op);
    } else {
      current.push(op);
    }
  }
  flush();
  return changeSets;
}
