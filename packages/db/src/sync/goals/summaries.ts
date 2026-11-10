import type { Risk } from '@expanses/core';
import type { WorkspaceContext } from '../../context';
import type { Database } from '../../database';
import { goalHistory, goalLinksFor, goalPlansFor } from '../../repos/goal-funding';
import { uuidv5 } from '../uuidv5';

/* What this phone works out, for one shared goal, of its own member's money (shared goals C5, C6, C16, C17, §7.2).
   Names and counted amounts only: no account id, balance or short-by is ever in what these return. */

/** Fixed for ever: a line's ref and a move's id already named on other devices must not change. */
export const GOAL_LINE_NS = '3d7a1c64-9e2b-4b58-8f10-a5c2e6d9b471';
export const GOAL_MOVE_NS = 'c18e5f02-7a4d-4d93-b6e1-2f9a0c3d8b56';

export interface GoalFundingLine {
  ref: string;
  name: string;
  kind: 'earmark' | 'tagged';
  /** In the goal's currency, as counted (a promise above the balance is already capped); null when this phone has no rate. */
  amountMinor: number | null;
  risk: Risk | null;
}

export interface OwnGoalFunding {
  lines: GoalFundingLine[];
  /** Standing amount plus monthly buys tagged to the goal, in the goal's currency. */
  plannedMonthlyMinor: number;
}

/** This phone's own funding of a goal, ready to send. */
export async function ownGoalFunding(database: Database, ws: WorkspaceContext, goalId: string, date: string): Promise<OwnGoalFunding> {
  // Own links only: a partner's lines, once they exist, carry an owner and are not this phone's to send.
  const links = (await goalLinksFor(database, ws, date)).filter((link) => link.goalId === goalId && !('owner' in link && link.owner));
  const lines: GoalFundingLine[] = [];
  for (const link of links) {
    lines.push({
      ref: await uuidv5(GOAL_LINE_NS, `${goalId}|${link.kind}|${link.accountId}`),
      name: link.name,
      kind: link.kind,
      amountMinor: link.goalMinor,
      risk: link.risk,
    });
  }
  const plan = (await goalPlansFor(database, ws, date)).plans.find((row) => row.goalId === goalId);
  return { lines, plannedMonthlyMinor: plan?.plannedMonthlyMinor ?? 0 };
}

export interface GoalMoveRow {
  id: string;
  goalId: string;
  memberId: string;
  kind: 'set-aside' | 'taken-back' | 'borrowed' | 'spent' | 'moved';
  occurredOn: string;
  /** Signed, in `currency`; display only. */
  amountMinor: number;
  currency: string;
  text: string;
  stageId: string | null;
}

/** This phone's History lines of a goal, all of them, each with an id that follows its local source. */
export async function ownGoalMoves(database: Database, ws: WorkspaceContext, goalId: string, memberId: string, date: string): Promise<GoalMoveRow[]> {
  const entries = (await goalHistory(database, ws, date, { limit: null }))[goalId] ?? [];
  const rows: GoalMoveRow[] = [];
  for (const entry of entries) {
    // "Reached the target" is a day, not a movement, and has no local source.
    if (entry.kind === 'reached' || entry.amountMinor === null || !entry.sourceId) continue;
    rows.push({
      id: await uuidv5(GOAL_MOVE_NS, `${goalId}|${entry.sourceId}`),
      goalId,
      memberId,
      kind: entry.kind,
      occurredOn: entry.occurredOn,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      text: entry.text,
      stageId: entry.stageId ?? null,
    });
  }
  return rows;
}
