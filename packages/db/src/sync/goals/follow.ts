import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../context';
import type { Db } from '../../database';
import { rekeyGoalTx } from '../../repos/goal-private-copy';
import { deleteGoalRowsTx } from '../../repos/goals';
import { goalSharingTablesExist } from '../../repos/goal-sharing-tables';
import type { BookContext } from '../apply';
import { addPendingSummaryGoalsTx, withCaptureSuspended } from '../capture';
import { dropEventLogRowTx } from '../events/log-rows';
import { localDate } from '../net-worth/summaries';
import type { GoalLinkView } from './authority';
import { type GoalLink, goalLinkOfTx, memberLeftTx } from './scope';

/*
 * What each phone does when a goal's link changes (shared goals §8.3 table, C13–C15, C30, D7). Nothing here is sent:
 * every phone makes the same change from the same link op, so the rows that leave scope with the link go without a
 * delete, and their clocks go with them (a later round enters at fresh clocks, and a private copy keeps nothing that
 * names the shared goal).
 *
 * - Off, or a share that ended: the sharer keeps the goal, private; every other member's phone turns its copy into a
 *   private goal under new ids (`rekeyGoalTx`) with that member's own money and History.
 * - Deleted: the sharer's phones delete the goal; every other member's phone keeps a private copy, as for off.
 * - A leave: the leaver's phones keep a private copy; every other phone drops the leaver's lines and notes who left
 *   and their last counted total.
 */

const today = () => localDate(Date.now());

/** A member's name in the book, as every screen names them. */
async function nameOfTx(tx: Db, bookId: string, memberId: string): Promise<string> {
  const [row] = await tx.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`);
  return row?.[0] ?? 'Another member';
}

/**
 * A member still in the book: one of their devices is not removed (C1). `book_members` keeps a member who left or was
 * removed, so on its own it does not say who still sees a goal. Plain SQL, for a `book_members` row aliased `m`.
 */
export const IN_BOOK = sql.raw(`EXISTS (SELECT 1 FROM book_devices d WHERE d.book_id = m.book_id AND d.member_id = m.member_id AND d.removed_at IS NULL)`);

/** Whether `memberId` still has a device in the book. */
export async function memberInBookTx(tx: Db, bookId: string, memberId: string): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM book_devices WHERE book_id = ${bookId} AND member_id = ${memberId} AND removed_at IS NULL LIMIT 1`)).length > 0;
}

/** "Rina", "Rina and Adi", "Rina, Adi and Sari": the book's other members still in it, in the order they joined. */
export async function othersNamesTx(tx: Db, bookId: string, me: string): Promise<string> {
  const names = (await tx.values<[string]>(sql`SELECT m.name FROM book_members m WHERE m.book_id = ${bookId} AND m.member_id <> ${me} AND ${IN_BOOK} ORDER BY m.joined_at, m.member_id`)).map((row) => row[0]);
  if (names.length === 0) return 'nobody else';
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One local History line of the share's own (never synced). */
export async function shareLogLineTx(
  tx: Db,
  ws: WorkspaceContext,
  goalId: string,
  line: { kind: 'shared' | 'stopped' | 'left' | 'ended'; memberName: string; amountMinor?: number | null; occurredOn: string },
): Promise<void> {
  await tx.run(sql`
    INSERT INTO goal_share_log (id, workspace_id, goal_id, kind, member_name, amount_minor, copied_from, occurred_on)
    VALUES (${uuidv7()}, ${ws.workspaceId}, ${goalId}, ${line.kind}, ${line.memberName}, ${line.amountMinor ?? null}, NULL, ${line.occurredOn})`);
}

/** The ids each goal-family entity names this goal's rows by, here, now (read before a re-key or a delete moves them). */
async function familyIdsTx(tx: Db, goalId: string, member?: string): Promise<{ entity: string; ids: string[] }[]> {
  const ids = async (query: ReturnType<typeof sql>) => (await tx.values<[string]>(query)).map((row) => row[0]);
  const byMember = member === undefined ? sql`` : sql` AND member_id = ${member}`;
  const lines = { entity: 'goal_member_funding', ids: await ids(sql`SELECT goal_id || '|' || member_id FROM goal_member_funding WHERE goal_id = ${goalId}${byMember}`) };
  const moves = { entity: 'goal_member_move', ids: await ids(sql`SELECT id FROM goal_member_moves WHERE goal_id = ${goalId}${byMember}`) };
  if (member !== undefined) return [lines, moves];
  const stages = await ids(sql`SELECT id FROM goal_stages WHERE goal_id = ${goalId}`);
  return [
    { entity: 'goal', ids: [goalId] },
    { entity: 'goal_calculator', ids: [goalId] },
    { entity: 'goal_stage', ids: stages },
    { entity: 'goal_stage_term', ids: stages },
    lines,
    moves,
  ];
}

/**
 * Carried (c): the field and kept clocks of a goal's synced rows go when they leave the book — every row of the goal,
 * or one member's lines when only that member left. A later round enters at fresh clocks; a private copy holds nothing
 * that names the shared goal's ids, and no kept clock can turn into a delete when the book is shared again
 * (`catchUpTx`). Tombstones stay: each says a row of the shared goal is gone for good, and none names a row kept here.
 */
async function clearClocksTx(tx: Db, bookId: string, goalId: string, member?: string): Promise<void> {
  for (const { entity, ids } of await familyIdsTx(tx, goalId, member)) {
    for (const id of ids) {
      await tx.run(sql`DELETE FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = ${entity} AND id = ${id}`);
      await tx.run(sql`DELETE FROM sync_kept_clocks WHERE book_id = ${bookId} AND entity = ${entity} AND id = ${id}`);
    }
  }
}

/** Members' lines of a goal dropped here, with no tombstone: all of them, or those of `only`, or all but `except`'s. */
async function dropLinesTx(tx: Db, goalId: string, who: { only?: string; except?: string } = {}): Promise<void> {
  const by = who.only !== undefined ? sql` AND member_id = ${who.only}` : who.except !== undefined ? sql` AND member_id <> ${who.except}` : sql``;
  await tx.run(sql`DELETE FROM goal_member_funding WHERE goal_id = ${goalId}${by}`);
  await tx.run(sql`DELETE FROM goal_member_moves WHERE goal_id = ${goalId}${by}`);
}

/**
 * What this device remembers of having sent for a goal (summaries.ts's keys): forgotten when the goal leaves 'on' here,
 * so a later round starts as a first send — a device whose money went into its private copy then has nothing to say,
 * and writes no empty line that would count as a part of its own at the next off (final review M2).
 */
export async function forgetSentTx(tx: Db, goalId: string): Promise<void> {
  await tx.run(sql`DELETE FROM settings WHERE key IN (${`goal.summary.${goalId}`}, ${`goal.moves.${goalId}`})`);
}

/**
 * Final review I8: the other members' lines of a goal this phone's own off or delete just came back from the log for.
 * Every line here then is from before that off in log order — one that reached the log just ahead of it was applied
 * after the off had dropped the lines here — and must not count again if sharing is turned on again. This member's own
 * line stays: a later round's is worked out afresh.
 */
export async function dropOthersLinesTx(tx: Db, bookId: string, goalId: string, me: string): Promise<void> {
  const members = await tx.values<[string]>(sql`
    SELECT member_id FROM goal_member_funding WHERE goal_id = ${goalId} AND member_id <> ${me}
    UNION SELECT member_id FROM goal_member_moves WHERE goal_id = ${goalId} AND member_id <> ${me}`);
  for (const [member] of members) await clearClocksTx(tx, bookId, goalId, member);
  await dropLinesTx(tx, goalId, { except: me });
}

/** Every line of a goal and the clocks of its rows, gone here (a delete, before the goal's rows go). */
export async function forgetGoalLinesTx(tx: Db, bookId: string, goalId: string): Promise<void> {
  await clearClocksTx(tx, bookId, goalId);
  await dropLinesTx(tx, goalId);
}

async function goalHereTx(tx: Db, ws: WorkspaceContext, goalId: string): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM goals WHERE id = ${goalId} AND workspace_id = ${ws.workspaceId}`)).length > 0;
}

/** Local tables whose rows are a member's own money or records naming a goal (not its plan, not the share's History). */
const OWN_PARTS = ['goal_earmarks', 'goal_contributions', 'goal_draws', 'trade_goal_parts', 'investment_trades', 'trade_templates', 'asset_sales', 'transactions', 'events'];

/**
 * Whether this phone holds anything of its member's own in a goal: money or a record of this phone's that names it. Only
 * then is there a private copy to keep.
 */
async function hasOwnPartTx(tx: Db, goalId: string): Promise<boolean> {
  const tables = new Set((await tx.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((row) => row[0]));
  for (const table of OWN_PARTS) {
    if (tables.has(table) && (await tx.values(sql`SELECT 1 FROM ${sql.raw(table)} WHERE goal_id = ${goalId} LIMIT 1`)).length > 0) return true;
  }
  // The member's synced line or History (from another of their devices, or an empty line sent from here) is not: the
  // copy leaves every line of the shared goal behind, so it would hold nothing (final review M2).
  return false;
}

export type UnlinkHow = 'off' | 'deleted' | 'ended';

/**
 * One phone's side of a link leaving 'on' (§8.3, C15), as this phone's member `me`. The sharer's phone keeps the goal
 * (deletes it, for 'deleted'); another member's phone keeps a private copy unless it left this round already (its copy
 * was made then). Runs with capture suspended by the caller, or paused by apply: nothing here is sent. Returns the
 * copy's id when one was made.
 */
export async function unlinkHereTx(tx: Db, ws: WorkspaceContext, link: GoalLink & { goalId: string }, me: string, how: UnlinkHow, on: string): Promise<string | null> {
  const { goalId, bookId } = link;
  await clearClocksTx(tx, bookId, goalId);
  await forgetSentTx(tx, goalId);
  if (me === link.sharedBy) {
    if (how === 'deleted') {
      if (await goalHereTx(tx, ws, goalId)) await deleteGoalRowsTx(tx, ws, goalId);
      else await dropLinesTx(tx, goalId);
      return null;
    }
    // Every line goes, this member's own too: they are worked out again if sharing is turned on again, so nothing
    // stale re-enters the book with the link — and none of another member's is this phone's to send (carried a).
    await dropLinesTx(tx, goalId);
    if (await goalHereTx(tx, ws, goalId)) await shareLogLineTx(tx, ws, goalId, { kind: how === 'off' ? 'stopped' : 'ended', memberName: await othersNamesTx(tx, bookId, me), occurredOn: on });
    return null;
  }
  if ((await memberLeftTx(tx, goalId, me)) || !(await goalHereTx(tx, ws, goalId))) {
    await dropLinesTx(tx, goalId);
    return null;
  }
  // Nothing of this member's in it — a device that joined later and read the round's end from the log, or a member who
  // never put money in: the goal just goes, with no empty copy. The household share ending keeps a copy as before.
  if (how !== 'ended' && !(await hasOwnPartTx(tx, goalId))) {
    await deleteGoalRowsTx(tx, ws, goalId);
    return null;
  }
  const copy = await rekeyGoalTx(tx, ws, goalId, {
    copiedFrom: goalId,
    logLine: { kind: how === 'ended' ? 'ended' : 'unshared', memberName: await nameOfTx(tx, bookId, link.sharedBy), occurredOn: on },
  });
  return copy.goalId;
}

/** Whose lines a leave takes out, and how much of the goal they counted: the sum of their lines, nulls left out. */
async function lastTotalTx(tx: Db, goalId: string, memberId: string): Promise<number | null> {
  const [row] = await tx.values<[string]>(sql`SELECT lines_json FROM goal_member_funding WHERE goal_id = ${goalId} AND member_id = ${memberId}`);
  if (!row) return null;
  const lines = JSON.parse(row[0]) as { amountMinor: number | null }[];
  return lines.reduce((sum, line) => sum + (typeof line.amountMinor === 'number' ? line.amountMinor : 0), 0);
}

/**
 * Another phone's side of `memberId` leaving this round (§8.3): the leaver's own other phones keep a private copy; every
 * other phone drops the leaver's lines and notes it in History with their last counted total. Capture is off.
 */
export async function followLeaveHereTx(
  tx: Db,
  ws: WorkspaceContext,
  link: GoalLink & { goalId: string },
  me: string,
  memberId: string,
  on: string,
  { tapped = false }: { tapped?: boolean } = {},
): Promise<string | null> {
  const { goalId, bookId } = link;
  if (memberId === me) {
    if (!(await goalHereTx(tx, ws, goalId))) return null;
    await clearClocksTx(tx, bookId, goalId);
    await forgetSentTx(tx, goalId);
    // The leaver's other device with nothing of theirs in the goal keeps no empty copy (M2); the phone Leave was
    // tapped on always keeps one, as its confirm says.
    if (!tapped && !(await hasOwnPartTx(tx, goalId))) {
      await deleteGoalRowsTx(tx, ws, goalId);
      return null;
    }
    const copy = await rekeyGoalTx(tx, ws, goalId, { copiedFrom: goalId, logLine: { kind: 'unshared', memberName: await nameOfTx(tx, bookId, link.sharedBy), occurredOn: on } });
    return copy.goalId;
  }
  const total = await lastTotalTx(tx, goalId, memberId);
  await clearClocksTx(tx, bookId, goalId, memberId);
  await dropLinesTx(tx, goalId, { only: memberId });
  if (await goalHereTx(tx, ws, goalId)) await shareLogLineTx(tx, ws, goalId, { kind: 'left', memberName: await nameOfTx(tx, bookId, memberId), amountMinor: total, occurredOn: on });
  return null;
}

/** The link op apply just took, followed on this phone (§8.3 table): `before` is the link as it stood here. */
export async function followGoalShareTx(tx: Db, ctx: BookContext, goalId: string, before: GoalLinkView | null): Promise<void> {
  const link = await goalLinkOfTx(tx, goalId);
  if (!link || link.bookId !== ctx.bookId) return;
  const [stateOn] = await tx.values<[string]>(sql`SELECT state_on FROM goal_shares WHERE goal_id = ${goalId}`);
  const on = stateOn?.[0] ?? today();
  const wasOn = before?.state === 'on';
  if (link.state === 'on') {
    // Turned on (again), from another of the sharer's phones: its History says so here too. Another member's phone
    // takes the goal as it arrives, beside any private copy of an earlier round (C30).
    if (!wasOn && ctx.memberId === link.sharedBy && (await goalHereTx(tx, ctx.ws, goalId))) {
      await shareLogLineTx(tx, ctx.ws, goalId, { kind: 'shared', memberName: await othersNamesTx(tx, ctx.bookId, ctx.memberId), occurredOn: on });
    }
    // Final review M12: this phone's own line of the new round, if it holds money for the goal (a sharer's phone the
    // switch was turned on from another of their devices), goes with its next own transaction, as any apply waits (R9).
    if (!wasOn) await addPendingSummaryGoalsTx(tx, [goalId]);
    return;
  }
  if (!wasOn) return;
  await unlinkHereTx(tx, ctx.ws, { ...link, goalId }, ctx.memberId, link.state === 'deleted' ? 'deleted' : 'off', on);
}

/** The leave apply just took, followed on this phone; a leave of an earlier round, or of a link not on, does nothing. */
export async function followGoalLeaveTx(tx: Db, ctx: BookContext, goalId: string, memberId: string): Promise<void> {
  const link = await goalLinkOfTx(tx, goalId);
  if (!link || link.bookId !== ctx.bookId || link.state !== 'on') return;
  if (!(await memberLeftTx(tx, goalId, memberId))) return;
  const [leftOn] = await tx.values<[string]>(sql`SELECT left_on FROM goal_share_leaves WHERE goal_id = ${goalId} AND member_id = ${memberId}`);
  await followLeaveHereTx(tx, ctx.ws, { ...link, goalId }, ctx.memberId, memberId, leftOn?.[0] ?? today());
}

/**
 * C15: the household share itself ends on this phone (stopped, left, removed, kept as its own copy). Every goal linked
 * to the book is handled as an off, locally, nothing emitted, in the transaction that ends the share — so no goal page
 * ever meets `BookReadOnlyError`. Then the book's goal links, leaves and lines go here altogether: a goal is shared again
 * only by its switch, as a new share at round 1, so a book shared again carries nothing of this share that its peers
 * would refuse (carried b), and no leave of this share counts against a later one. `me` is this phone's member, read
 * from the book's share when not given (the caller that drops the share passes it).
 */
export async function endSharedGoalsTx(tx: Db, ws: WorkspaceContext, bookId: string, me?: string): Promise<void> {
  if (!(await goalSharingTablesExist(tx))) return;
  const links = await tx.values<[string, string, string, number]>(sql`SELECT goal_id, shared_by, state, round FROM goal_shares WHERE book_id = ${bookId} ORDER BY goal_id`);
  if (links.length === 0) return;
  const member = me ?? (await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`))[0]?.[0];
  await withCaptureSuspended(tx, async () => {
    for (const [goalId, sharedBy, state, round] of links) {
      const link = { goalId, bookId, sharedBy, state: state as GoalLink['state'], round: Number(round) };
      if (member !== undefined && link.state === 'on') await unlinkHereTx(tx, ws, link, member, 'ended', today());
      else await clearClocksTx(tx, bookId, goalId);
      await forgetLinkTx(tx, bookId, goalId);
    }
  });
}

/**
 * A goal's link, its leaves and every line go here altogether, with their clocks and the log's note of the link: the
 * goal is shared again only by its switch, as a new share at round 1, which no peer refuses for a round it never saw.
 */
async function forgetLinkTx(tx: Db, bookId: string, goalId: string): Promise<void> {
  await dropLinesTx(tx, goalId);
  for (const table of ['sync_field_clocks', 'sync_kept_clocks']) {
    await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId} AND entity = 'goal_share' AND id = ${goalId}`);
    await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId} AND entity = 'goal_share_leave' AND substr(id, 1, ${goalId.length + 1}) = ${`${goalId}|`}`);
  }
  await dropEventLogRowTx(tx, bookId, 'goal_share', goalId);
  await tx.run(sql`DELETE FROM goal_share_leaves WHERE goal_id = ${goalId}`);
  await tx.run(sql`DELETE FROM goal_shares WHERE goal_id = ${goalId}`);
}

/**
 * Final review C1: a removal apply just took (a member leaving the workspace, or an owner removing a device). When it
 * took the last device of a member out of the book (`wasIn`: the member had one before it), every phone still in it
 * stops counting that member in each goal shared there, at the same place in the log, locally and with no op:
 * - a goal another member shared: as that member's Leave (C13) — their lines, planned monthly and History go, and a
 *   "Rina left" line keeps their last counted total;
 * - a goal that member shared: nobody left could turn it off (D10), so it ends here as the household share ending
 *   does (C15) — each remaining member with money of their own keeps a private copy — and the link goes, so a share
 *   started again later by its switch is a new one.
 * This phone's own member is not followed here: their devices end the household share themselves (C15).
 */
export async function followMemberGoneTx(tx: Db, ctx: BookContext, memberId: string, wasIn: boolean): Promise<void> {
  if (!wasIn || memberId === ctx.memberId || !(await goalSharingTablesExist(tx))) return;
  if (await memberInBookTx(tx, ctx.bookId, memberId)) return;
  const links = await tx.values<[string, string, number]>(sql`SELECT goal_id, shared_by, round FROM goal_shares WHERE book_id = ${ctx.bookId} AND state = 'on' ORDER BY goal_id`);
  const on = today();
  await withCaptureSuspended(tx, async () => {
    for (const [goalId, sharedBy, round] of links) {
      const link = { goalId, bookId: ctx.bookId, sharedBy, state: 'on' as const, round: Number(round) };
      if (sharedBy === memberId) {
        await unlinkHereTx(tx, ctx.ws, link, ctx.memberId, 'off', on);
        await forgetLinkTx(tx, ctx.bookId, goalId);
      } else if (!(await memberLeftTx(tx, goalId, memberId))) {
        await followLeaveHereTx(tx, ctx.ws, link, ctx.memberId, memberId, on);
      }
    }
  });
}
