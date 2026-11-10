import { sql } from 'drizzle-orm';
import type { Db } from '../../database';
import { eventLogRowTx, noteEventLogOpTx } from '../events/log-rows';
import { entityOf, GOAL_FAMILY, parseOpId, type RowEntity } from '../shared-entities';
import type { Op } from '../types';
import { GOAL_SHARE_ENTITIES, goalWriteRefusal, type GoalLinkView } from './authority';

/*
 * Where a shared goal's rows stand (shared goals §8.3 option b, §8.4). A goal-family row is in the household book only
 * while its goal's link is 'on', so turning sharing off, deleting the goal or leaving takes the rest out of scope
 * together. Such a row leaves with its link and sends nothing: a delete of a goal, stage or move would tombstone it for
 * ever (a later round could never bring it back), and the sharer's phone would be judged for deleting the partner's
 * summary. Every phone does its own follow-up instead.
 *
 * Apply reads the link as the log has it, at the op's place in the log, not this phone's own unsent change to it: a
 * sharer's second phone that turned sharing off a moment ago still takes an edit the log has before that off, as every
 * other phone does. It is kept by the same bookkeeping shared events use (`events/log-rows.ts`).
 */

export type GoalLink = GoalLinkView & { bookId: string };

/** A goal's link as stored on this phone, or null when it was never shared. */
export async function goalLinkOfTx(tx: Db, goalId: string): Promise<GoalLink | null> {
  const [row] = await tx.values<[string, string, string, number]>(sql`SELECT book_id, shared_by, state, round FROM goal_shares WHERE goal_id = ${goalId}`);
  return row ? { bookId: row[0], sharedBy: row[1], state: row[2] as GoalLink['state'], round: Number(row[3]) } : null;
}

/** Entities that name their goal in their key. */
const KEYED_BY_GOAL: Readonly<Record<string, string>> = { goal: 'id', goal_share: 'goal_id', goal_share_leave: 'goal_id', goal_calculator: 'goal_id', goal_member_funding: 'goal_id' };

/** Entities that name their goal in a column: read from the row here first, so a partial edit (no goalId) is placed. */
const GOAL_COLUMN_OF: Readonly<Record<string, { table: string; key: string }>> = {
  goal_stage: { table: 'goal_stages', key: 'id' },
  goal_stage_term: { table: 'goal_stage_terms', key: 'stage_id' },
  goal_member_move: { table: 'goal_member_moves', key: 'id' },
};

/** The goal a goal-family (or link) row belongs to: its key, the row stored here, else the fields it carries. */
export async function goalOfRowTx(tx: Db, entity: string, key: Record<string, string>, fields: Record<string, unknown>): Promise<string | null> {
  const keyed = KEYED_BY_GOAL[entity];
  if (keyed) return key[keyed] ?? null;
  const column = GOAL_COLUMN_OF[entity];
  if (!column) return null;
  const [row] = await tx.values<[string]>(sql`SELECT goal_id FROM ${sql.raw(column.table)} WHERE ${sql.raw(column.key)} = ${key[column.key] ?? null}`);
  if (row) return row[0];
  return typeof fields.goalId === 'string' ? fields.goalId : null;
}

/** Whether `memberId` left the goal in its link's current round (a leave from an earlier round is stale). */
export async function memberLeftTx(tx: Db, goalId: string, memberId: string): Promise<boolean> {
  const rows = await tx.values(sql`
    SELECT 1 FROM goal_share_leaves l JOIN goal_shares s ON s.goal_id = l.goal_id
    WHERE l.goal_id = ${goalId} AND l.member_id = ${memberId} AND l.round = s.round`);
  return rows.length > 0;
}

/**
 * Whether a goal-family row that is no longer in the book left with its link: the link is not 'on' (off, deleted, or
 * gone), or this phone's member left this round. Capture then sends no delete for it.
 */
export async function leftWithLinkTx(tx: Db, entity: string, key: Record<string, string>, values: Record<string, unknown>): Promise<boolean> {
  if (!GOAL_FAMILY.has(entity)) return false;
  const goalId = await goalOfRowTx(tx, entity, key, values);
  if (goalId === null) return false;
  const link = await goalLinkOfTx(tx, goalId);
  if (link === null || link.state !== 'on') return true;
  const [me] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${link.bookId}`);
  return me ? memberLeftTx(tx, goalId, me[0]) : false;
}

/** A link's fields (`sharedBy`, `state`, `stateOn`, `round`) as the log has them, or null when it never took one here. */
async function loggedLinkTx(tx: Db, bookId: string, goalId: string): Promise<Record<string, unknown> | null> {
  return (await eventLogRowTx(tx, bookId, 'goal_share', goalId))?.values ?? null;
}

/** A link op the log took, kept for the decisions after it. */
export async function noteGoalLinkTx(tx: Db, bookId: string, op: Op, hlc: string): Promise<void> {
  if (op.entity === 'goal_share' && op.op === 'upsert') await noteEventLogOpTx(tx, bookId, op, hlc);
}

const viewOf = (fields: Record<string, unknown> | null): GoalLinkView | null =>
  fields ? { sharedBy: String(fields.sharedBy), state: fields.state as GoalLinkView['state'], round: Number(fields.round) } : null;

/** The link apply decides by: the log's; this phone's stored one only for a link the log never gave it here. */
async function linkForApplyTx(tx: Db, bookId: string, goalId: string): Promise<GoalLink | null> {
  const logged = viewOf(await loggedLinkTx(tx, bookId, goalId));
  if (logged) return { ...logged, bookId };
  return goalLinkOfTx(tx, goalId);
}

/** A row's synced fields as stored here, by field name, or null. Goal rows are found by their key alone (uuids). */
async function storedFieldsTx(tx: Db, entity: RowEntity, key: Record<string, string>): Promise<Record<string, unknown> | null> {
  const columns = Object.entries(entity.fields);
  const where = sql.join(
    entity.keyColumns.map((c) => sql`${sql.raw(c)} = ${key[c] ?? null}`),
    sql` AND `,
  );
  const [row] = await tx.values<unknown[]>(sql`SELECT ${sql.raw(columns.map(([, c]) => c).join(', '))} FROM ${sql.raw(entity.table)} WHERE ${where}`);
  return row ? Object.fromEntries(columns.map(([f], i) => [f, row[i]])) : null;
}

/**
 * Whether apply drops a peer's op for a goal-family row: its goal's link is not 'on' in this book as the log has it
 * (the goal ended, or was never shared here), or this phone's member left this round. Dropped as ended, the same on
 * every phone, so never recorded as a skip; a leaver's drop is its own phones' alone (§8.3). A summary or move of a
 * member who left this round is dropped too: the other phones dropped that member's lines when the leave arrived, and
 * one sent after it (a second phone not yet told) would bring them back.
 */
export async function goalOpDroppedTx(tx: Db, bookId: string, memberId: string, entity: RowEntity, op: Op): Promise<boolean> {
  if (!GOAL_FAMILY.has(entity.entity)) return false;
  const key = parseOpId(entity, op.id);
  const fields = op.op === 'upsert' ? op.fields : {};
  const goalId = await goalOfRowTx(tx, entity.entity, key, fields);
  if (goalId === null) return true;
  const link = await linkForApplyTx(tx, bookId, goalId);
  if (link === null || link.state !== 'on' || link.bookId !== bookId) return true;
  if (await memberLeftTx(tx, goalId, memberId)) return true;
  const lineOf =
    entity.entity === 'goal_member_funding' ? key.member_id : entity.entity === 'goal_member_move' ? ((await storedFieldsTx(tx, entity, key))?.memberId ?? fields.memberId) : null;
  return typeof lineOf === 'string' && (await memberLeftTx(tx, goalId, lineOf));
}

/**
 * Why a peer's op on a link or a goal's own row is refused (the text after "AUTHORITY: "), or null: `goalWriteRefusal`
 * against the row as it stood and the link, the link itself as the log has it. With `own`, this phone's own link op
 * back from the log, judged against the log alone (the stored row already holds it): one the log has no account of yet
 * is its first word, already judged at capture.
 */
export async function goalOpRefusalTx(tx: Db, bookId: string, entity: RowEntity, op: Op, member: string | null, own = false): Promise<string | null> {
  if (!GOAL_SHARE_ENTITIES.has(entity.entity)) return null;
  const key = parseOpId(entity, op.id);
  const goalId = await goalOfRowTx(tx, entity.entity, key, op.op === 'upsert' ? op.fields : {});
  const logged = goalId === null ? null : await loggedLinkTx(tx, bookId, goalId);
  if (own && logged === null) return null;
  // A goal rides one book: its link names it. An op for it in another book would write a second link over the first.
  const stored = goalId === null ? null : await goalLinkOfTx(tx, goalId);
  if (stored !== null && stored.bookId !== bookId) return 'the goal is shared in another book';
  const linkRow = logged ?? (goalId === null ? null : await storedFieldsTx(tx, entityOf('goal_share') as RowEntity, { goal_id: goalId }));
  const before = entity.entity === 'goal_share' ? linkRow : await storedFieldsTx(tx, entity, key);
  const after = op.op === 'delete' ? null : { ...(before ?? {}), ...op.fields };
  return goalWriteRefusal(entity.entity, before, after, key, member, viewOf(linkRow));
}
