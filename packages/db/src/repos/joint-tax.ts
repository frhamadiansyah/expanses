import { type CoretaxInputs, jointCoretaxInputs, type JointWaiting } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { receivedItems } from '../sync/net-worth/summaries';
import { activeNetWorthGroup, pendingCounts } from './net-worth-sharing';
import { coretaxInputsFor } from './tax-inputs';

/*
 * The inputs a year's tax report reads (joint-net-worth §8.4; task 10). Separate tax IDs, or no group: this phone's own
 * `coretaxInputsFor`, unchanged. One tax ID, for the workspace the group lives in: the same own inputs plus every
 * received item's slice for the year, and what the report is still waiting for — an item whose year-end has not
 * reached this phone, and each member's count of items not yet shared (D8, `nw_pending`).
 */

export interface JointReport {
  workspaceBookId: string;
  /** The group's members, in the active proposal's order. */
  members: string[];
  /** This device's member. */
  me: string;
  /** Received items with no row for the year yet: their owner's phone has not sent its year-end. */
  waiting: JointWaiting[];
  /** Each member's count of items still hidden (D8); the report is incomplete while any is above zero. */
  pending: Record<string, number>;
  /** Each received item's id — what its rows are keyed by, never an account on this phone — and its owner's member id. */
  received: Record<string, string>;
}

export async function reportInputsFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<{ inputs: CoretaxInputs; joint: JointReport | null }> {
  const own = await coretaxInputsFor(database, ws, taxYear);
  const group = await activeNetWorthGroup(database);
  if (!group || group.mode !== 'joint') return { inputs: own, joint: null };
  const [home] = await database.db.values<[string]>(sql`SELECT workspace_id FROM books WHERE id = ${group.workspaceBookId}`);
  if (home?.[0] !== ws.workspaceId) return { inputs: own, joint: null };
  const received = (await receivedItems(database, group.groupBookId)).filter((item) => group.members.includes(item.owner));
  const { inputs, waiting } = jointCoretaxInputs(own, received, taxYear);
  const counts = await pendingCounts(database, group.groupBookId);
  const pending = Object.fromEntries(Object.entries(counts).filter(([member, count]) => group.members.includes(member) && count > 0));
  return {
    inputs,
    joint: { workspaceBookId: group.workspaceBookId, members: group.members, me: group.me, waiting, pending, received: Object.fromEntries(received.map((item) => [item.itemId, item.owner])) },
  };
}
