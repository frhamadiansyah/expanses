import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { type CaptureTarget, withCapture, withCaptureSuspended } from '../sync/capture';
import { meetsVersion } from '../sync/events/version';
import { followLeaveHereTx, forgetGoalLinesTx, IN_BOOK, othersNamesTx, shareLogLineTx, unlinkHereTx } from '../sync/goals/follow';
import { type GoalLink, goalLinkOfTx } from '../sync/goals/scope';
import { sendGoalSummariesTx } from '../sync/goals/summaries';
import { SHARED_GOALS_MIN_APP_VERSION } from '../sync/goals/version';
import { localDate } from '../sync/net-worth/summaries';
import { freezeEmergencyOutgoingTx } from './goal-calculators';
import { goalSharingTablesExist } from './goal-sharing-tables';
import { GoalDbError } from './goals';
import { listSharedBooks } from './sharing';

/*
 * Which workspaces a goal can be shared into (shared goals §8.6, C3, D6): active workspace books with another current
 * member, where every device not removed already runs a build that knows shared goals.
 */

export interface GoalShareTarget {
  bookId: string;
  bookName: string;
  /** This device's member. */
  me: string;
  /** The other current members, in the order they joined: everyone here will see the goal (C31). */
  others: { memberId: string; name: string }[];
}

export async function goalShareTargets(database: Database): Promise<GoalShareTarget[]> {
  const out: GoalShareTarget[] = [];
  for (const shared of await listSharedBooks(database)) {
    if (shared.state !== 'active' || shared.kind !== 'workspace') continue;
    const inBook = new Set(
      (await database.db.values<[string]>(sql`SELECT DISTINCT member_id FROM book_devices WHERE book_id = ${shared.bookId} AND removed_at IS NULL`)).map((row) => row[0]),
    );
    // Only who is still in the workspace sees the goal (C1, C31): `book_members` keeps a member who left.
    const others = shared.members.filter((m) => m.memberId !== shared.memberId && inBook.has(m.memberId)).map(({ memberId, name }) => ({ memberId, name }));
    if (others.length === 0) continue;
    const versions = await database.db.values<[string | null]>(sql`SELECT app_version FROM book_devices WHERE book_id = ${shared.bookId} AND removed_at IS NULL`);
    if (!versions.every(([v]) => meetsVersion(v, SHARED_GOALS_MIN_APP_VERSION))) continue;
    const [book] = await database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${shared.bookId}`);
    if (!book) continue;
    out.push({ bookId: shared.bookId, bookName: book[0], me: shared.memberId, others });
  }
  return out;
}

/* ------------------------------------------------------------ share, off, delete, Leave (§8.2, §8.3, C12–C14, D10) */

const today = () => localDate(Date.now());

/** This phone's member in a book, or null when the book is not shared here. */
async function memberInTx(tx: Db, bookId: string): Promise<string | null> {
  const [row] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
  return row?.[0] ?? null;
}

async function nameInTx(tx: Db, bookId: string, memberId: string): Promise<string> {
  const [row] = await tx.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`);
  return row?.[0] ?? 'Another member';
}

async function requireGoalTx(tx: Db, ws: WorkspaceContext, goalId: string): Promise<void> {
  const found = await tx.values(sql`SELECT 1 FROM goals WHERE id = ${goalId} AND workspace_id = ${ws.workspaceId}`);
  if (found.length === 0) throw new GoalDbError('Goal not found in this workspace');
}

/** A link that is on, with this phone's member in its book; refused otherwise. */
async function onLinkTx(tx: Db, goalId: string): Promise<{ link: GoalLink & { goalId: string }; me: string }> {
  const link = (await goalSharingTablesExist(tx)) ? await goalLinkOfTx(tx, goalId) : null;
  const me = link ? await memberInTx(tx, link.bookId) : null;
  if (!link || link.state !== 'on' || me === null) throw new GoalDbError('This goal is not shared');
  return { link: { ...link, goalId }, me };
}

/**
 * Shares a goal into a household workspace (§8.2), or turns it on again there (round + 1). One transaction under
 * capture with the link and every row of the goal as targets, so the link goes out first and the goal, its stages,
 * terms and calculator follow whole, then this member's line and History go through the summary send, so the others see
 * it from the start.
 */
export async function shareGoal(database: Database, ws: WorkspaceContext, goalId: string, bookId: string): Promise<void> {
  const target = (await goalShareTargets(database)).find((t) => t.bookId === bookId);
  if (!target) throw new GoalDbError('A goal is shared only into a shared workspace with another member, where every phone runs a current version');
  const date = today();
  await database.transaction(async (tx) => {
    await requireGoalTx(tx, ws, goalId);
    const link = await goalLinkOfTx(tx, goalId);
    if (link?.state === 'on') return;
    if (link?.state === 'deleted') throw new GoalDbError('This goal was deleted');
    if (link && link.bookId !== bookId) throw new GoalDbError('This goal was shared in another workspace, and is shared only there');
    if (link && link.sharedBy !== target.me) throw new GoalDbError(`Only ${await nameInTx(tx, bookId, link.sharedBy)} can share this goal again`);
    const stageIds = (await tx.values<[string]>(sql`SELECT id FROM goal_stages WHERE goal_id = ${goalId} ORDER BY sort, due_on, id`)).map((row) => row[0]);
    const targets: CaptureTarget[] = [
      { entity: 'goal_share', id: goalId },
      { entity: 'goal', id: goalId },
      ...stageIds.map((id) => ({ entity: 'goal_stage', id })),
      ...stageIds.map((id) => ({ entity: 'goal_stage_term', id })),
      { entity: 'goal_calculator', id: goalId },
    ];
    await withCapture(tx, targets, async () => {
      // The sharer's outgoing is frozen into an emergency fund's working before the link is written (D8).
      const [working] = await tx.values<[string]>(sql`SELECT kind FROM goal_calculators WHERE goal_id = ${goalId}`);
      if (working?.[0] === 'emergency') await freezeEmergencyOutgoingTx(tx, ws, goalId, date);
      if (link) await tx.run(sql`UPDATE goal_shares SET state = 'on', state_on = ${date}, round = round + 1 WHERE goal_id = ${goalId}`);
      else {
        await tx.run(sql`
          INSERT INTO goal_shares (goal_id, book_id, workspace_id, shared_by, state, state_on, round)
          VALUES (${goalId}, ${bookId}, ${ws.workspaceId}, ${target.me}, 'on', ${date}, 1)`);
      }
    });
    // One path for sending: this member's line (once there is money in it, §11) and History go as the daily send does.
    await sendGoalSummariesTx(tx, [goalId], date);
    await shareLogLineTx(tx, ws, goalId, { kind: 'shared', memberName: await othersNamesTx(tx, bookId, target.me), occurredOn: date });
  });
}

/**
 * The sharer turns sharing off (C12, C14): only the link goes out, as 'off'. Here the goal stays, private, and every
 * member's line of it goes locally — the others' were never this phone's to send, and turning it on again would
 * otherwise send them (carried a). Every other phone makes its own copy from the link.
 */
export async function stopSharingGoal(database: Database, ws: WorkspaceContext, goalId: string): Promise<void> {
  await database.transaction(async (tx) => {
    await requireGoalTx(tx, ws, goalId);
    const { link, me } = await onLinkTx(tx, goalId);
    if (me !== link.sharedBy) throw new GoalDbError(`Only ${await nameInTx(tx, link.bookId, link.sharedBy)} can stop sharing this goal`);
    const date = today();
    await withCapture(tx, { entity: 'goal_share', id: goalId }, () => tx.run(sql`UPDATE goal_shares SET state = 'off', state_on = ${date} WHERE goal_id = ${goalId}`));
    await withCaptureSuspended(tx, () => unlinkHereTx(tx, ws, { ...link, state: 'off' }, me, 'off', date));
  });
}

/**
 * For `deleteGoal`, inside its transaction and before the goal's rows go: on the sharer's phone the link goes to
 * 'deleted' (the only op sent), and the members' lines and the share's History of the goal go locally. Every other
 * phone keeps a private copy from the link. True when the goal was shared at the time.
 */
export async function markGoalDeletedTx(tx: Db, goalId: string): Promise<boolean> {
  if (!(await goalSharingTablesExist(tx))) return false;
  const link = await goalLinkOfTx(tx, goalId);
  if (!link) return false;
  const wasOn = link.state === 'on';
  const me = await memberInTx(tx, link.bookId);
  if (me === null || me !== link.sharedBy || link.state === 'deleted') return wasOn;
  const date = today();
  await withCapture(tx, { entity: 'goal_share', id: goalId }, () => tx.run(sql`UPDATE goal_shares SET state = 'deleted', state_on = ${date} WHERE goal_id = ${goalId}`));
  // The goal itself is the caller's to delete; what only the share made goes here.
  await withCaptureSuspended(tx, async () => {
    await forgetGoalLinesTx(tx, link.bookId, goalId);
    await tx.run(sql`DELETE FROM goal_share_log WHERE goal_id = ${goalId}`);
  });
  return wasOn;
}

/**
 * Another member leaves a shared goal (C13): the leave for the current round goes out, then this phone's copy becomes a
 * private goal under new ids (C30) with this member's own money and History. For everyone else it stays shared.
 */
export async function leaveSharedGoal(database: Database, ws: WorkspaceContext, goalId: string): Promise<{ copyGoalId: string }> {
  return database.transaction(async (tx) => {
    await requireGoalTx(tx, ws, goalId);
    const { link, me } = await onLinkTx(tx, goalId);
    const sharer = await nameInTx(tx, link.bookId, link.sharedBy);
    if (me === link.sharedBy) throw new GoalDbError(`${sharer} shared this goal, so it is turned off rather than left`);
    const date = today();
    await withCapture(tx, { entity: 'goal_share_leave', id: `${goalId}|${me}` }, () =>
      tx.run(sql`
        INSERT INTO goal_share_leaves (goal_id, member_id, workspace_id, round, left_on) VALUES (${goalId}, ${me}, ${ws.workspaceId}, ${link.round}, ${date})
        ON CONFLICT (goal_id, member_id) DO UPDATE SET round = excluded.round, left_on = excluded.left_on`),
    );
    const copy = await withCaptureSuspended(tx, () => followLeaveHereTx(tx, ws, link, me, me, date));
    return { copyGoalId: copy! };
  });
}

/* ------------------------------------------------------------ views */

export interface GoalShareView {
  goalId: string;
  bookId: string;
  bookName: string;
  sharedBy: string;
  sharedByName: string;
  state: 'on' | 'off' | 'deleted';
  round: number;
  /** This phone's member in the book. */
  me: string;
  isSharer: boolean;
  /** Everyone in the book, in the order they joined (C31, C33). */
  members: { memberId: string; name: string }[];
  /** Members who left in the current round. */
  left: string[];
}

async function viewOf(database: Database, goalId: string, bookId: string, sharedBy: string, state: string, round: number): Promise<GoalShareView | null> {
  const me = await memberInTx(database.db, bookId);
  if (me === null) return null;
  const [book] = await database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`);
  const everyone = (await database.db.values<[string, string, number]>(
    sql`SELECT m.member_id, m.name, ${IN_BOOK} FROM book_members m WHERE m.book_id = ${bookId} ORDER BY m.joined_at, m.member_id`,
  )).map(([memberId, name, inBook]) => ({ memberId, name, inBook: Boolean(inBook) }));
  // Who sees the goal now (C31): a member who left the workspace, or whose devices were all removed, no longer does (C1).
  const members = everyone.filter((m) => m.inBook || m.memberId === me).map(({ memberId, name }) => ({ memberId, name }));
  const left = (await database.db.values<[string]>(sql`SELECT member_id FROM goal_share_leaves WHERE goal_id = ${goalId} AND round = ${round} ORDER BY left_on, member_id`)).map(
    (row) => row[0],
  );
  return {
    goalId,
    bookId,
    bookName: book?.[0] ?? '',
    sharedBy,
    sharedByName: everyone.find((m) => m.memberId === sharedBy)?.name ?? 'Another member',
    state: state as GoalShareView['state'],
    round,
    me,
    isSharer: me === sharedBy,
    members,
    left,
  };
}

/** A goal's link as this phone has it, in any state, or null when it is not shared in a book shared here. */
export async function goalShareOf(database: Database, goalId: string): Promise<GoalShareView | null> {
  if (!(await goalSharingTablesExist(database.db))) return null;
  const [row] = await database.db.values<[string, string, string, number]>(sql`SELECT book_id, shared_by, state, round FROM goal_shares WHERE goal_id = ${goalId}`);
  return row ? viewOf(database, goalId, row[0], row[1], row[2], Number(row[3])) : null;
}

/** Every goal shared now, by goal id (the Goals list's initials). */
export async function goalSharesOf(database: Database): Promise<Record<string, GoalShareView>> {
  if (!(await goalSharingTablesExist(database.db))) return {};
  const out: Record<string, GoalShareView> = {};
  const rows = await database.db.values<[string, string, string, string, number]>(sql`SELECT goal_id, book_id, shared_by, state, round FROM goal_shares WHERE state = 'on' ORDER BY goal_id`);
  for (const [goalId, bookId, sharedBy, state, round] of rows) {
    const view = await viewOf(database, goalId, bookId, sharedBy, state, Number(round));
    if (view) out[goalId] = view;
  }
  return out;
}

/** The private copy this phone made of a shared goal (C30), when it still exists here: for a link opened after. */
export async function privateCopyOf(database: Database, sharedGoalId: string): Promise<string | null> {
  if (!(await goalSharingTablesExist(database.db))) return null;
  const [row] = await database.db.values<[string]>(sql`
    SELECT l.goal_id FROM goal_share_log l JOIN goals g ON g.id = l.goal_id
    WHERE l.copied_from = ${sharedGoalId} ORDER BY l.occurred_on DESC, l.id DESC LIMIT 1`);
  return row?.[0] ?? null;
}
