import type { Risk } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../context';
import type { Database, Db } from '../../database';
import { devicePlannedMonthlyMinor, goalHistory, goalLinksFor } from '../../repos/goal-funding';
import { goalSharingTablesExist } from '../../repos/goal-sharing-tables';
import { goalCurrencyExists } from '../../repos/goals';
import { withCapture } from '../capture';
import { uuidv5 } from '../uuidv5';
import { goalLinkOfTx, memberLeftTx } from './scope';

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
  /** The goal's currency the amount is in, so a phone that reads the goal in another currency leaves it out (M8). */
  currency: string;
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
  // A database before 0091 has no goal currency: every goal is in the base.
  const [goal] = (await goalCurrencyExists(database.db)) ? await database.db.values<[string | null]>(sql`SELECT currency FROM goals WHERE id = ${goalId}`) : [];
  const currency = goal?.[0] ?? ws.baseCurrency;
  const lines: GoalFundingLine[] = [];
  for (const link of links) {
    lines.push({
      ref: await uuidv5(GOAL_LINE_NS, `${goalId}|${link.kind}|${link.accountId}`),
      name: link.name,
      kind: link.kind,
      amountMinor: link.goalMinor,
      risk: link.risk,
      currency,
    });
  }
  // The plan's planned figure counts the others' too, and the member's own from another device; only this phone's travels.
  return { lines, plannedMonthlyMinor: await devicePlannedMonthlyMinor(database, ws, goalId, date) };
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
    // A partner's line is theirs to write, and the share's own lines stay on this phone.
    if (entry.by !== null || entry.amountMinor === null || !entry.sourceId) continue;
    if (entry.kind === 'reached' || entry.kind === 'shared' || entry.kind === 'stopped' || entry.kind === 'left' || entry.kind === 'unshared' || entry.kind === 'ended') continue;
    rows.push({
      id: await uuidv5(GOAL_MOVE_NS, `${goalId}|${entry.sourceId}`),
      goalId,
      memberId,
      kind: entry.kind,
      occurredOn: entry.occurredOn,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      // Only a spend carries its purchase's description (C8, D9). A borrow paid for something else, which is private:
      // its line names the account the money came from, as a set-aside's does (final review I5).
      text: entry.kind === 'borrowed' ? (entry.accountName ?? '') : entry.text,
      stageId: entry.stageId ?? null,
    });
  }
  return rows;
}

/** Set once this device has written a summary for the goal: only then does it write one with nothing to say. */
const wroteKey = (goalId: string) => `goal.summary.${goalId}`;

/**
 * The ids of the moves this device wrote for the goal, as a JSON list (local, never synced). A member's other device
 * writes moves of the same member: only those this device wrote are its to change or take out (final review I4), and
 * only those are already shown here from its own records (`goalHistory`, M13).
 */
const movesKey = (goalId: string) => `goal.moves.${goalId}`;

async function writtenMovesTx(tx: Db, goalId: string): Promise<Set<string>> {
  const [row] = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${movesKey(goalId)}`);
  if (!row) return new Set();
  try {
    const ids = JSON.parse(row[0]) as unknown;
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

type StoredMove = Omit<GoalMoveRow, 'goalId' | 'memberId'>;

const sameMove = (a: StoredMove, b: GoalMoveRow) =>
  a.kind === b.kind && a.occurredOn === b.occurredOn && a.amountMinor === b.amountMinor && a.currency === b.currency && a.text === b.text && a.stageId === b.stageId;

/** One goal's summary and moves, written under capture; true when anything changed. */
async function sendOneTx(tx: Db, goalId: string, date: string): Promise<boolean> {
  const link = await goalLinkOfTx(tx, goalId);
  if (!link || link.state !== 'on') return false;
  const [me] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${link.bookId} AND state = 'active'`);
  if (!me || (await memberLeftTx(tx, goalId, me[0]))) return false;
  const memberId = me[0];
  const [owner] = await tx.values<[string, string]>(sql`SELECT g.workspace_id, w.base_currency FROM goals g JOIN workspaces w ON w.id = g.workspace_id WHERE g.id = ${goalId}`);
  if (!owner) return false;
  const ws: WorkspaceContext = { workspaceId: owner[0], baseCurrency: owner[1] };
  // The figures are read inside this transaction: `db` is all they use of a Database.
  const here = { db: tx } as unknown as Database;
  const funding = await ownGoalFunding(here, ws, goalId, date);
  const moves = await ownGoalMoves(here, ws, goalId, memberId, date);
  const [wrote] = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${wroteKey(goalId)}`);
  // A second phone of the same member, with no money of its own in the goal, says nothing and so overwrites nothing.
  if (funding.lines.length === 0 && moves.length === 0 && !wrote) return false;
  let changed = false;

  const linesJson = JSON.stringify(funding.lines.map((line) => ({ ref: line.ref, name: line.name, kind: line.kind, amountMinor: line.amountMinor, risk: line.risk, currency: line.currency })));
  const [stored] = await tx.values<[string, number]>(sql`SELECT lines_json, planned_monthly_minor FROM goal_member_funding WHERE goal_id = ${goalId} AND member_id = ${memberId}`);
  if (!stored || stored[0] !== linesJson || Number(stored[1]) !== funding.plannedMonthlyMinor) {
    await withCapture(tx, { entity: 'goal_member_funding', id: `${goalId}|${memberId}`, bookId: link.bookId }, () =>
      tx.run(sql`
        INSERT INTO goal_member_funding (goal_id, member_id, workspace_id, lines_json, planned_monthly_minor, as_of)
        VALUES (${goalId}, ${memberId}, ${ws.workspaceId}, ${linesJson}, ${funding.plannedMonthlyMinor}, ${date})
        ON CONFLICT (goal_id, member_id) DO UPDATE SET lines_json = excluded.lines_json, planned_monthly_minor = excluded.planned_monthly_minor, as_of = excluded.as_of`),
    );
    await tx.run(sql`INSERT INTO settings (key, value) VALUES (${wroteKey(goalId)}, '1') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    changed = true;
  }

  const have = new Map<string, StoredMove>();
  for (const [id, kind, occurredOn, amountMinor, currency, text, stageId] of await tx.values<[string, GoalMoveRow['kind'], string, number, string, string, string | null]>(
    sql`SELECT id, kind, occurred_on, amount_minor, currency, text, stage_id FROM goal_member_moves WHERE goal_id = ${goalId} AND member_id = ${memberId}`,
  )) have.set(id, { id, kind, occurredOn, amountMinor: Number(amountMinor), currency, text, stageId });
  const upserts = moves.filter((move) => {
    const was = have.get(move.id);
    return !was || !sameMove(was, move);
  });
  const now = new Set(moves.map((move) => move.id));
  const written = await writtenMovesTx(tx, goalId);
  // Only a move this device wrote goes when its source does: another device's of the same member is not this one's.
  const gone = [...have.keys()].filter((id) => written.has(id) && !now.has(id));
  if (written.size !== now.size || [...now].some((id) => !written.has(id))) {
    await tx.run(sql`INSERT INTO settings (key, value) VALUES (${movesKey(goalId)}, ${JSON.stringify([...now].sort())}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  }
  if (upserts.length + gone.length > 0) {
    const targets = [...upserts.map((move) => move.id), ...gone].map((id) => ({ entity: 'goal_member_move', id, bookId: link.bookId }));
    await withCapture(tx, targets, async () => {
      for (const move of upserts) {
        await tx.run(sql`
          INSERT INTO goal_member_moves (id, goal_id, workspace_id, member_id, kind, occurred_on, amount_minor, currency, text, stage_id)
          VALUES (${move.id}, ${goalId}, ${ws.workspaceId}, ${memberId}, ${move.kind}, ${move.occurredOn}, ${move.amountMinor}, ${move.currency}, ${move.text}, ${move.stageId})
          ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, occurred_on = excluded.occurred_on, amount_minor = excluded.amount_minor, currency = excluded.currency, text = excluded.text, stage_id = excluded.stage_id`);
      }
      for (const id of gone) await tx.run(sql`DELETE FROM goal_member_moves WHERE id = ${id}`);
    });
    changed = true;
  }
  return changed;
}

/** Sends this member's summary and moves for each shared goal named, as far as they changed. */
export async function sendGoalSummariesTx(tx: Db, goalIds: readonly string[], date: string): Promise<void> {
  // A goal marked dirty on a database stopped before 0109 (a migration test's) is shared nowhere.
  if (!(await goalSharingTablesExist(tx))) return;
  for (const goalId of new Set(goalIds)) await sendOneTx(tx, goalId, date);
}

/**
 * Once a day (§8.5): a rate or a price moved the counted amounts without anyone touching the goal. Every shared goal
 * this member is in is looked at; the count is the goals whose summary changed.
 */
export async function resendGoalSummaries(database: Database, date: string): Promise<number> {
  return database.transaction(async (tx) => {
    const rows = await tx.values<[string]>(sql`SELECT goal_id FROM goal_shares WHERE state = 'on' ORDER BY goal_id`);
    let changed = 0;
    for (const [goalId] of rows) if (await sendOneTx(tx, goalId, date)) changed += 1;
    return changed;
  });
}
