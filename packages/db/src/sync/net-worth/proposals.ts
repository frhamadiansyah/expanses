import { canPropose, uuidv7, type FilingMode, type GroupState } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../database';
import { activeNetWorthGroup, groupDissolved, groupStateOf, NetWorthError, proposalOf, refreshPendingCount } from '../../repos/net-worth-sharing';
import { groupLogWorkspaceOf, viewMember } from '../authority';
import { withCapture } from '../capture';
import type { SyncOnceResult } from '../engine';
import { localTick } from '../hlc';
import { SharingError } from '../seed';
import { buildOpId, entityOf } from '../shared-entities';
import { SyncTransportError } from '../types';
import {
  abandonLostGroupLog,
  admitToGroupLog,
  devicesToAdmit,
  dissolveGroupLog,
  groupLogOf,
  groupMembersReady,
  leaveGroupLog,
  linkOf,
  openGroupLog,
  type GroupLogHost,
} from './group-log';

/*
 * The net-worth group's proposals and answers (joint-net-worth spec §6, task 5). State is derived, never stored
 * (`deriveGroup`, @expanses/core): this module writes the log's `nw_proposal` and `nw_answer` rows and keeps the group
 * log in step with what they say.
 *
 * - Propose: the group log (made, joined, or — when two members made one at the same moment — the one the link names),
 *   the invited members let in, then the proposal and the proposer's own `confirm`.
 * - Answer: `confirm` or `decline`; a proposal once active can only be left (task 2 review), so `decline` is refused.
 * - Cancel: the proposer's, and never of an active proposal. A group log left with nothing active or pending dissolves.
 * - Leave: `left` on the active proposal, then out of the group log — or, when fewer than two would be left, the group
 *   dissolves (§6): the log deleted and the link closed (authority.ts `writeOnceBroken`).
 * - After every workspace sync (`afterWorkspaceSync`): a lost lone log is abandoned, a dissolved group's log deleted, a
 *   member's later devices let in, and this member's pending count (D8) written.
 */

/** A sync that may fail on the relay: the scheduler's next run does it then. */
async function quietly(run: Promise<unknown>): Promise<void> {
  try {
    await run;
  } catch (error) {
    if (!(error instanceof SyncTransportError)) throw error;
  }
}

async function workspaceMember(host: GroupLogHost, workspaceBookId: string): Promise<string> {
  const [row] = await host.database.db.values<[string, string]>(sql`SELECT member_id, state FROM shared_books WHERE book_id = ${workspaceBookId}`);
  if (!row || row[1] !== 'active') throw new SharingError('NOT_FOUND', 'This workspace is not shared from this device');
  return row[0];
}

async function requireGroupLog(host: GroupLogHost, workspaceBookId: string): Promise<{ groupBookId: string; me: string }> {
  const me = await workspaceMember(host, workspaceBookId);
  const groupBookId = await groupLogOf(host, workspaceBookId);
  if (!groupBookId) throw new NetWorthError('not-listed', "You're not in this workspace's net-worth group");
  return { groupBookId, me };
}

/**
 * The group log to propose in: the one this device is in; else, when the link names one, the one this device is let
 * into (a sync or two joins it — and abandons a lone log of its own that lost the link, `afterWorkspaceSync`); else a
 * new one. `GROUP_EXISTS` when the workspace has a group this device is not let into.
 */
async function ensureGroupLog(host: GroupLogHost, workspaceBookId: string): Promise<string> {
  await quietly(host.syncOnce(workspaceBookId));
  const mine = await groupLogOf(host, workspaceBookId);
  if (mine) return mine;
  if (await linkOf(host.database, workspaceBookId)) {
    await quietly(host.syncOnce(workspaceBookId));
    const joined = await groupLogOf(host, workspaceBookId);
    if (joined) return joined;
    throw new SharingError('GROUP_EXISTS', 'This workspace already has a net-worth group');
  }
  return openGroupLog(host, workspaceBookId);
}

/**
 * Proposes a filing mode and members (§6 Setup, Change). This member is always listed; `members` names the others (it
 * may name this member too). `invalid` when the proposal cannot be made (`canPropose`, or someone not in the
 * workspace); `other-group` when this person is in another workspace's group (§4); `not-ready` with each outdated
 * device when a listed member's device runs an app too old (§9). Returns the proposal's id.
 */
export async function proposeNetWorth(host: GroupLogHost, workspaceBookId: string, input: { mode: FilingMode; members: string[] }): Promise<string> {
  const me = await workspaceMember(host, workspaceBookId);
  const members = [me, ...input.members.filter((m) => m !== me)];
  if (!canPropose(input.mode, members)) {
    throw new NetWorthError('invalid', input.mode === 'joint' ? 'One tax ID is for exactly two people' : 'Choose at least one other person');
  }
  const known = await host.database.transaction(async (tx) => {
    for (const member of members) {
      const view = await viewMember(tx, workspaceBookId, member);
      if (!view || view.deleted) return false;
    }
    return true;
  });
  if (!known) throw new NetWorthError('invalid', 'Everyone you choose must be in this workspace');
  const other = await activeNetWorthGroup(host.database);
  if (other && other.workspaceBookId !== workspaceBookId) throw new NetWorthError('other-group', 'You already share your net worth in another workspace');
  const ready = await groupMembersReady(host, workspaceBookId, members);
  if (!ready.ready) throw new NetWorthError('not-ready', 'Every device must run the latest app first', ready.outdated);

  const groupBookId = await ensureGroupLog(host, workspaceBookId);
  const others = members.filter((m) => m !== me);
  await admitToGroupLog(host, workspaceBookId, others);
  const proposalId = uuidv7();
  await host.database.transaction(async (tx) => {
    const createdHlc = await localTick(tx, host.device.deviceId, host.now());
    await withCapture(tx, { entity: 'nw_proposal', id: proposalId, bookId: groupBookId }, async () => {
      await tx.run(sql`
        INSERT INTO nw_proposals (book_id, proposal_id, mode, members_json, proposed_by, created_hlc, cancelled)
        VALUES (${groupBookId}, ${proposalId}, ${input.mode}, ${JSON.stringify(members)}, ${me}, ${createdHlc}, 0)`);
    });
    await writeAnswerTx(tx, groupBookId, proposalId, me, 'confirm');
  });
  // The workspace's sync sends the invites (in the link) and syncs the group log after it.
  await quietly(host.syncOnce(workspaceBookId));
  return proposalId;
}

async function writeAnswerTx(tx: Tx, groupBookId: string, proposalId: string, memberId: string, answer: 'confirm' | 'decline' | 'left'): Promise<void> {
  const id = buildOpId(entityOf('nw_answer'), { proposal_id: proposalId, member_id: memberId });
  await withCapture(tx, { entity: 'nw_answer', id, bookId: groupBookId }, async () => {
    await tx.run(sql`
      INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, ${proposalId}, ${memberId}, ${answer})
      ON CONFLICT (book_id, proposal_id, member_id) DO UPDATE SET answer = excluded.answer`);
  });
}

/** The proposal, read after a sync of the group log; `not-listed` when this member is not on it. */
async function listedProposal(host: GroupLogHost, groupBookId: string, proposalId: string, me: string) {
  await quietly(host.syncOnce(groupBookId));
  const found = await proposalOf(host.database.db, groupBookId, proposalId);
  if (!found || !found.proposal.members.includes(me)) throw new NetWorthError('not-listed', "You're not asked on that proposal");
  return found;
}

/** Confirm or decline a proposal this member is listed on (§6 Confirm). `activated` for a decline of one once active. */
export async function answerNetWorth(host: GroupLogHost, workspaceBookId: string, proposalId: string, answer: 'confirm' | 'decline'): Promise<void> {
  const { groupBookId, me } = await requireGroupLog(host, workspaceBookId);
  const { activated } = await listedProposal(host, groupBookId, proposalId, me);
  if (answer === 'decline' && activated) throw new NetWorthError('activated', 'This is how your household shares now: to stop, stop sharing your net worth');
  await host.database.transaction((tx) => writeAnswerTx(tx, groupBookId, proposalId, me, answer));
  await quietly(host.syncOnce(groupBookId));
}

/**
 * The proposer withdraws a proposal not yet active (§6 Change). When nothing is left active or waiting, the group log
 * is dissolved: a setup that never happened leaves nothing behind.
 */
export async function cancelNetWorth(host: GroupLogHost, workspaceBookId: string, proposalId: string): Promise<void> {
  const { groupBookId, me } = await requireGroupLog(host, workspaceBookId);
  const { proposal, activated } = await listedProposal(host, groupBookId, proposalId, me);
  if (proposal.proposedBy !== me) throw new NetWorthError('not-proposer', 'Only who proposed it can cancel it');
  if (activated) throw new NetWorthError('activated', 'This is how your household shares now: to stop, stop sharing your net worth');
  await host.database.transaction((tx) =>
    withCapture(tx, { entity: 'nw_proposal', id: proposalId, bookId: groupBookId }, async () => {
      await tx.run(sql`UPDATE nw_proposals SET cancelled = 1 WHERE book_id = ${groupBookId} AND proposal_id = ${proposalId}`);
    }),
  );
  await quietly(host.syncOnce(groupBookId));
  const state = await groupStateOf(host.database.db, groupBookId);
  if (!state.active && !state.pending) {
    await dissolveGroupLog(host, workspaceBookId);
    await quietly(host.syncOnce(workspaceBookId));
  }
}

/**
 * Stop sharing my net worth (§6 Leaving, unilateral): `left` on the active proposal, then out of the group log with
 * rotation. When fewer than two members would be left, the group dissolves instead: the log is deleted and the link
 * closed.
 */
export async function leaveNetWorth(host: GroupLogHost, workspaceBookId: string): Promise<void> {
  const { groupBookId, me } = await requireGroupLog(host, workspaceBookId);
  await quietly(host.syncOnce(groupBookId));
  const state = await groupStateOf(host.database.db, groupBookId);
  if (state.active?.members.includes(me)) {
    await host.database.transaction((tx) => writeAnswerTx(tx, groupBookId, state.active!.proposalId, me, 'left'));
    await quietly(host.syncOnce(groupBookId));
  }
  if (await groupDissolved(host.database.db, groupBookId)) {
    await dissolveGroupLog(host, workspaceBookId);
    await quietly(host.syncOnce(workspaceBookId));
    return;
  }
  await leaveGroupLog(host, workspaceBookId);
}

export type NetWorthGroupView = GroupState & { groupBookId: string | null; me: string };

/** The workspace's net-worth group as this device derives it (§6), and which group log and member it reads as. */
export async function netWorthGroup(host: GroupLogHost, workspaceBookId: string): Promise<NetWorthGroupView> {
  const [row] = await host.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${workspaceBookId}`);
  const me = row?.[0] ?? '';
  const groupBookId = await groupLogOf(host, workspaceBookId);
  if (!groupBookId) return { active: null, pending: null, waitingFor: [], groupBookId: null, me };
  return { ...(await groupStateOf(host.database.db, groupBookId)), groupBookId, me };
}

/**
 * After a workspace's sync (engine `syncOnce`, after its group log's): a lone group log of this device's that lost the
 * link to another member's is abandoned; a group fallen below two members is dissolved; a group member's device the
 * group log does not have yet is let in; and this member's pending count (D8) follows its items.
 */
export async function afterWorkspaceSync(host: GroupLogHost, bookId: string, result: SyncOnceResult): Promise<void> {
  if (result.ended || result.stopped) return;
  if ((await groupLogWorkspaceOf(host.database.db, bookId)) !== null) return;
  if (await abandonLostGroupLog(host, bookId)) return;
  const groupBookId = await groupLogOf(host, bookId);
  if (!groupBookId) return;
  if (await groupDissolved(host.database.db, groupBookId)) {
    await dissolveGroupLog(host, bookId);
    return;
  }
  const admit = await devicesToAdmit(host, bookId);
  try {
    if (admit.length > 0) await admitToGroupLog(host, bookId, [...new Set(admit.map((d) => d.memberId))]);
  } catch (error) {
    // The group log ended under it (deleted, or this device removed): the next sync forgets it; the workspace's own
    // sync is not failed for it.
    if (!(error instanceof SharingError)) throw error;
  }
  await refreshPendingCount(host.database);
}
