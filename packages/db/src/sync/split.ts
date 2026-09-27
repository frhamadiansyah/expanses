import type { Tx } from '../database';
import { encodeHlc, localTickRange, stepHlcState, type HlcClockState } from './hlc';
import type { ChangeSet, Op } from './types';

/*
 * Cutting a local database transaction's ops into change-sets (spec §6.2): at most 200 ops and 64 KB of JSON each,
 * consecutive hlcs (counter + 1 each, rolling into `ms` on overflow), in op order. An import of 3,000 rows is
 * fifteen entries.
 *
 * The hlcs assigned here must never collide with a later `localTick`'s — so the caller reserves them first, with
 * `localTickRange(tx, deviceId, n)`, and hands the reservation's start to `assignHlcs`/`splitIntoChangeSets` as
 * `start`. Getting `n` (how many change-sets there will be) needs the same grouping this file computes, before any
 * hlc exists to put in them; `groupOps` does that half on its own, sized against a placeholder hlc of the same
 * fixed length any real one will have, so the byte count it computes is exact regardless of what `start` ends up
 * being. `reserveAndSplit` is the one call that does both, off a single grouping — the count it reserves and the
 * number of change-sets it hands back can never disagree, because they are the same `groups` value.
 */

export const MAX_OPS_PER_CHANGE_SET = 200;
export const MAX_CHANGE_SET_BYTES = 64 * 1024;

const encoder = new TextEncoder();

function byteSizeOf(changeSet: ChangeSet): number {
  return encoder.encode(JSON.stringify(changeSet)).length;
}

/** A single op's own JSON does not fit in one change-set (spec §6.2): it is refused, never emitted over budget. */
export class OpTooLargeError extends Error {
  constructor(readonly op: Op) {
    super(`op ${op.entity}:${op.id} alone exceeds ${MAX_CHANGE_SET_BYTES} bytes of change-set JSON`);
    this.name = 'OpTooLargeError';
  }
}

/** Where a change-set's hlc starts: a reservation from `localTickRange`, plus the device id cutting it. */
export interface SplitStart extends HlcClockState {
  deviceId: string;
}

/**
 * Groups `ops` (already in the order they must apply) by the spec's limits, without assigning any hlc yet. Sized
 * against a zero-valued, correctly-shaped placeholder hlc for `deviceId` — every real hlc has exactly the same
 * length (fixed-width ms and counter), so the byte count is identical either way.
 */
function groupOps(ops: readonly Op[], member: string, deviceId: string): Op[][] {
  const placeholderHlc = encodeHlc(0, 0, deviceId);
  const groups: Op[][] = [];
  let current: Op[] = [];

  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
  };

  for (const op of ops) {
    const trial = [...current, op];
    const trialChangeSet: ChangeSet = { v: 1, hlc: placeholderHlc, member, ops: trial };
    const overSize = trial.length > MAX_OPS_PER_CHANGE_SET || byteSizeOf(trialChangeSet) > MAX_CHANGE_SET_BYTES;
    if (overSize) {
      if (current.length > 0) {
        flush();
        current.push(op);
      } else {
        // A lone op that alone is already over budget cannot be split smaller: refused outright (spec §6.2 ruling).
        const alone: ChangeSet = { v: 1, hlc: placeholderHlc, member, ops: [op] };
        if (byteSizeOf(alone) > MAX_CHANGE_SET_BYTES) throw new OpTooLargeError(op);
        current.push(op); // over MAX_OPS_PER_CHANGE_SET alone is impossible (limit is 200, an op is one).
      }
    } else {
      current.push(op);
    }
  }
  flush();
  return groups;
}

/** Assigns consecutive hlcs (spec §6.2) to already-cut groups, starting at `start`. Pure: no reservation happens here. */
function assignHlcs(groups: readonly Op[][], member: string, start: SplitStart): ChangeSet[] {
  let hlcState: HlcClockState = { ms: start.ms, counter: start.counter };
  const changeSets: ChangeSet[] = [];
  for (const [i, group] of groups.entries()) {
    if (i > 0) hlcState = stepHlcState(hlcState);
    changeSets.push({ v: 1, hlc: encodeHlc(hlcState.ms, hlcState.counter, start.deviceId), member, ops: group });
  }
  return changeSets;
}

/**
 * Cuts `ops` into `ChangeSet`s no larger than the spec's limits, each carrying the next hlc after the previous
 * one's — starting at `start`, which must already be reserved (via `localTickRange`) for exactly as many
 * change-sets as this produces. Empty input yields no change-sets and reserves nothing.
 *
 * Callers reserving their own `start` (rather than going through `reserveAndSplit`) must reserve exactly
 * `countChangeSets(ops, member, start.deviceId)` ticks — get that wrong and this silently assigns hlcs a
 * `localTickRange` reservation never covered. `reserveAndSplit` is the version that can't get it wrong.
 */
export function splitIntoChangeSets(ops: readonly Op[], member: string, start: SplitStart): ChangeSet[] {
  return assignHlcs(groupOps(ops, member, start.deviceId), member, start);
}

/** How many change-sets `splitIntoChangeSets(ops, ...)` will produce — what to reserve with `localTickRange` first. */
export function countChangeSets(ops: readonly Op[], member: string, deviceId: string): number {
  return groupOps(ops, member, deviceId).length;
}

/**
 * Reserves exactly as many hlcs as `ops` needs and cuts them into change-sets, off one grouping — so the count
 * reserved and the number of change-sets produced can never disagree (the bug fix round 1 found: reserving `n`
 * separately from cutting let the two drift apart under a change to either). Must run with a `tx` from inside the
 * caller's own `database.transaction()` (spec §6.3 — capture always does): `localTickRange` needs the whole
 * transaction held for its read-then-write to be safe, and this is not itself a transaction boundary.
 */
export async function reserveAndSplit(tx: Tx, deviceId: string, member: string, ops: readonly Op[], now?: number): Promise<ChangeSet[]> {
  const groups = groupOps(ops, member, deviceId);
  if (groups.length === 0) return [];
  const start = await localTickRange(tx, deviceId, groups.length, now);
  return assignHlcs(groups, member, { ...start, deviceId });
}
