import { deriveGroup, isActivated, type Answer, type FilingMode, type GroupState, type Proposal } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { captureConfigOf, markAccountDirtyTx, withCapture } from '../sync/capture';
import { localDate, sendSummariesTx } from '../sync/net-worth/summaries';
import { listAccounts } from './accounts';

/*
 * Joint net worth (spec §5.4, §6, §8.1): what each person chooses to share of their own items, and the group state as
 * this device derives it from the group log. Owner scope: `nw_share_settings` is local and never synced, like the
 * accounts it describes. One group per person (§4): the active group is the one of the one workspace this person is in
 * a group with.
 */

export type ShareSetting = 'total' | 'hidden';

export type NetWorthErrorCode =
  /** A device of a listed member runs an app too old for joint net worth (§9): `outdated` names each. */
  | 'not-ready'
  /** The proposal cannot be made: `joint` with other than two members, fewer than two, or someone not in the workspace. */
  | 'invalid'
  /** A proposal once active can only be left, never declined or cancelled (task 2 review). */
  | 'activated'
  /** Only the proposer may cancel a proposal. */
  | 'not-proposer'
  /** This person is not listed on that proposal, or it is not in the group log. */
  | 'not-listed'
  /** Someone proposed was in this group log and left it: they can never confirm (review round 1, finding 1). */
  | 'left-group'
  /** This person is already in the net-worth group of another workspace (§4: one group per person). */
  | 'other-group'
  /** `Don't share` is refused while the household files with one tax ID (D7). */
  | 'joint-forbids-hidden';

export class NetWorthError extends Error {
  constructor(
    readonly code: NetWorthErrorCode,
    message: string,
    readonly outdated: { memberId: string; deviceName: string }[] = [],
  ) {
    super(message);
    this.name = 'NetWorthError';
  }
}

async function tableExists(db: Db, name: string): Promise<boolean> {
  return (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`)).length > 0;
}

/**
 * The proposals and answers of a group log as `deriveGroup` takes them. A member whose every device is out of the
 * group log (per its view: they left the workspace, or were removed from it) counts as having answered `left` (§6, last
 * bullet: out of the workspace is out of the group).
 */
async function groupInputsOf(db: Db, groupBookId: string): Promise<{ proposals: Proposal[]; answers: Answer[] }> {
  const proposals = (
    await db.values<[string, string, string, string, string, number]>(
      sql`SELECT proposal_id, mode, members_json, proposed_by, created_hlc, cancelled FROM nw_proposals WHERE book_id = ${groupBookId}`,
    )
  ).map(([proposalId, mode, members, proposedBy, createdHlc, cancelled]) => ({
    proposalId,
    mode: mode as FilingMode,
    members: parseMembers(members),
    proposedBy,
    createdHlc,
    cancelled: Number(cancelled) === 1,
  }));
  const answers: Answer[] = (
    await db.values<[string, string, string]>(sql`SELECT proposal_id, member_id, answer FROM nw_answers WHERE book_id = ${groupBookId} ORDER BY proposal_id, member_id`)
  ).map(([proposalId, memberId, answer]) => ({ proposalId, memberId, answer: answer as Answer['answer'] }));
  // Review round 2, A: a member who went counts as having left only where they said yes — their `confirm` reads as
  // `left`. Where they gave no answer, none is made up: a proposal waiting for them waits for ever, never activates,
  // and never dissolves the group. Nothing here reads a proposer's own `createdHlc`.
  const departed = await departedMembers(db, groupBookId);
  return {
    proposals,
    answers: answers.map((ans) => (departed.has(ans.memberId) && ans.answer === 'confirm' ? { ...ans, answer: 'left' as const } : ans)),
  };
}

/**
 * The members this group log once held and holds no device of now (they left the group, the workspace, or were
 * removed).
 */
export async function departedMembers(db: Db, groupBookId: string): Promise<Set<string>> {
  const rows = await db.values<[string]>(sql`
    SELECT m.member_id FROM sync_authority m WHERE m.book_id = ${groupBookId} AND NOT EXISTS (
      SELECT 1 FROM sync_authority_devices d WHERE d.book_id = ${groupBookId} AND d.member_id = m.member_id AND d.removed_seq IS NULL)
    AND EXISTS (SELECT 1 FROM sync_authority_devices d WHERE d.book_id = ${groupBookId} AND d.member_id = m.member_id)`);
  return new Set(rows.map(([member]) => member));
}

function parseMembers(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return []; // malformed peer data is a proposal nobody can confirm
  }
}

/** The group state of a group log, derived here as on every device (§6). */
export async function groupStateOf(db: Db, groupBookId: string): Promise<GroupState> {
  const { proposals, answers } = await groupInputsOf(db, groupBookId);
  return deriveGroup(proposals, answers);
}

/**
 * Whether the group log once had an active group and now has none: its members fell below two (§6: fewer than two
 * members left = no group; the log is deleted).
 */
export async function groupDissolved(db: Db, groupBookId: string): Promise<boolean> {
  const { proposals, answers } = await groupInputsOf(db, groupBookId);
  if (deriveGroup(proposals, answers).active) return false;
  return proposals.some((p) => isActivated(p, proposals, answers));
}

/** One proposal of a group log, and whether it was ever activated (task 2 review: then it may only be left). */
export async function proposalOf(db: Db, groupBookId: string, proposalId: string): Promise<{ proposal: Proposal; activated: boolean } | null> {
  const { proposals, answers } = await groupInputsOf(db, groupBookId);
  const proposal = proposals.find((p) => p.proposalId === proposalId);
  return proposal ? { proposal, activated: isActivated(proposal, proposals, answers) } : null;
}

export interface ActiveNetWorthGroup {
  workspaceBookId: string;
  groupBookId: string;
  mode: FilingMode;
  members: string[];
  /** This device's member. */
  me: string;
}

/**
 * The one active net-worth group this person is in (§4: one group per person), or null: from every group log this
 * device holds and is active in, the first whose derived group lists this device's member. The one reader of the group
 * state for owner-scope code — share settings, the review, the pending count, and the summaries — whether it runs on
 * the database or inside a transaction already open (`tx`).
 */
export async function activeNetWorthGroup(source: Database | Db): Promise<ActiveNetWorthGroup | null> {
  const db = 'exportBytes' in source ? source.db : source;
  if (!(await tableExists(db, 'nw_group_books'))) return null;
  const logs = await db.values<[string, string, string]>(sql`
    SELECT g.group_book_id, g.book_id, s.member_id FROM nw_group_books g JOIN shared_books s ON s.book_id = g.group_book_id
    WHERE s.state = 'active' ORDER BY s.shared_at DESC, g.group_book_id`);
  for (const [groupBookId, workspaceBookId, me] of logs) {
    const state = await groupStateOf(db, groupBookId);
    if (state.active && state.active.members.includes(me)) {
      return { workspaceBookId, groupBookId, mode: state.active.mode, members: state.active.members, me };
    }
  }
  return null;
}

/* ------------------------------------------------------------ share settings */

/** One item's setting: `total` (balance and one total), `hidden` (don't share), or null (not reviewed yet). */
export async function getShareSetting(database: Database, accountId: string): Promise<ShareSetting | null> {
  if (!(await tableExists(database.db, 'nw_share_settings'))) return null;
  const [row] = await database.db.values<[string]>(sql`SELECT setting FROM nw_share_settings WHERE account_id = ${accountId}`);
  return (row?.[0] as ShareSetting | undefined) ?? null;
}

async function writeSetting(db: Db, accountId: string, setting: ShareSetting): Promise<void> {
  await db.run(sql`
    INSERT INTO nw_share_settings (account_id, setting) VALUES (${accountId}, ${setting})
    ON CONFLICT (account_id) DO UPDATE SET setting = excluded.setting`);
}

const JOINT_FORBIDS_HIDDEN = 'Your household files with one tax ID, so every item is in the joint report.';

/** Sets one item's setting. `hidden` is refused while the active group files jointly (D7). */
export async function setShareSetting(database: Database, accountId: string, setting: ShareSetting): Promise<void> {
  const group = await activeNetWorthGroup(database);
  if (setting === 'hidden' && group?.mode === 'joint') throw new NetWorthError('joint-forbids-hidden', JOINT_FORBIDS_HIDDEN);
  await database.transaction(async (tx) => {
    await writeSetting(tx, accountId, setting);
    await afterShareSettingChanged(tx, accountId);
  });
  await refreshPendingCount(database);
}

/**
 * Where a changed setting reaches the item's summary (spec §9: a setting change re-sends it, `Don't share` sends
 * `removed`), in the transaction that wrote it: the account is marked dirty, and the capture flush before COMMIT sends
 * or removes its summary (task 6). This function and `afterReviewConfirmed` are the only two places a setting is written.
 */
async function afterShareSettingChanged(tx: Tx, accountId: string): Promise<void> {
  markAccountDirtyTx(tx, accountId);
}

/**
 * Where the review's Share sends every shared item's summary (§8.1: Share sends the summaries), in the transaction that
 * wrote the settings, as of this device's day.
 */
async function afterReviewConfirmed(tx: Tx, today: string): Promise<void> {
  const group = await activeNetWorthGroup(tx);
  if (group) await markReviewedTx(tx, group.groupBookId);
  await sendSummariesTx(tx, 'all', today);
}

/*
 * Review before anything is sent (§6 Review; wave 3 merge ruling, the stricter of the two sides): a member's phone sends
 * no summary into a group log until this person has pressed Share on the review for that group. A share setting alone is
 * not enough — one left from an earlier group (dissolved, or set up again with someone else) would otherwise go to the
 * new group's members on the first write, before its review. Local, per device, like the settings it covers.
 */
const REVIEWED_KEY = (groupBookId: string) => `nw.reviewed.${groupBookId}`;

/** Records that this person pressed Share on the review of this group log (what `confirmReview` does). */
export async function markReviewedTx(tx: Db, groupBookId: string): Promise<void> {
  await tx.run(sql`INSERT INTO settings (key, value) VALUES (${REVIEWED_KEY(groupBookId)}, '1') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}

/** Whether this person has reviewed their items (pressed Share) for this group log (§6 Review). */
export async function reviewedFor(source: Database | Db, groupBookId: string): Promise<boolean> {
  const db = 'exportBytes' in source ? source.db : source;
  return (await db.values(sql`SELECT 1 FROM settings WHERE key = ${REVIEWED_KEY(groupBookId)}`)).length > 0;
}

/** This device's day, by the capture clock the engine and tests set (the same day capture's flush sends with). */
function todayOf(database: Database): string {
  return localDate(captureConfigOf(database).now?.() ?? Date.now());
}

export interface ReviewItem {
  accountId: string;
  name: string;
  kind: 'asset' | 'liability';
  subtype: string;
  setting: ShareSetting | null;
}

/** Every account, card and asset of this person (§8.1), with its setting: no categories, system or placeholder accounts. */
export async function reviewItems(database: Database, ws: WorkspaceContext): Promise<ReviewItem[]> {
  const accounts = (await listAccounts(database, ws)).filter((a) => (a.kind === 'asset' || a.kind === 'liability') && a.systemKey === null);
  const settings = new Map<string, ShareSetting>();
  if (await tableExists(database.db, 'nw_share_settings')) {
    for (const [id, setting] of await database.db.values<[string, string]>(sql`SELECT account_id, setting FROM nw_share_settings`)) {
      settings.set(id, setting as ShareSetting);
    }
  }
  return accounts.map((a) => ({
    accountId: a.id,
    name: a.name,
    kind: a.kind as 'asset' | 'liability',
    subtype: a.subtype,
    setting: settings.get(a.id) ?? null,
  }));
}

/**
 * The review's Share (§8.1): a row for every item, from `settings` or `total` when the review did not say. In `joint`
 * every item is `total`, whatever was asked (D7).
 */
export async function confirmReview(database: Database, ws: WorkspaceContext, settings: Record<string, ShareSetting>): Promise<void> {
  const joint = (await activeNetWorthGroup(database))?.mode === 'joint';
  const items = await reviewItems(database, ws);
  const today = todayOf(database);
  await database.transaction(async (tx) => {
    for (const item of items) await writeSetting(tx, item.accountId, joint ? 'total' : (settings[item.accountId] ?? 'total'));
    await afterReviewConfirmed(tx, today);
  });
  await refreshPendingCount(database);
}

/** The items still `hidden` while the household files jointly (D8): what this person has yet to share. */
export async function pendingHidden(database: Database, ws: WorkspaceContext): Promise<string[]> {
  if ((await activeNetWorthGroup(database))?.mode !== 'joint') return [];
  return (await reviewItems(database, ws)).filter((item) => item.setting === 'hidden').map((item) => item.accountId);
}

/** The owner-scope workspace a shared book belongs to on this device. */
async function workspaceOfBook(db: Db, bookId: string): Promise<WorkspaceContext | null> {
  const [row] = await db.values<[string, string]>(sql`
    SELECT w.id, w.base_currency FROM books b JOIN workspaces w ON w.id = b.workspace_id WHERE b.id = ${bookId}`);
  return row ? { workspaceId: row[0], baseCurrency: row[1] } : null;
}

/**
 * This member's `nw_pending.count` in the active group log (D8): the number of items still hidden while the mode is
 * `joint`, 0 otherwise. Written only when it changes, and a zero only over a row that says otherwise.
 */
export async function refreshPendingCount(database: Database): Promise<void> {
  const group = await activeNetWorthGroup(database);
  if (!group) return;
  const ws = await workspaceOfBook(database.db, group.workspaceBookId);
  if (!ws) return;
  const count = group.mode === 'joint' ? (await pendingHidden(database, ws)).length : 0;
  await database.transaction(async (tx) => {
    const [stored] = await tx.values<[number]>(sql`SELECT count FROM nw_pending WHERE book_id = ${group.groupBookId} AND member_id = ${group.me}`);
    if (stored ? Number(stored[0]) === count : count === 0) return;
    await withCapture(tx, { entity: 'nw_pending', id: group.me, bookId: group.groupBookId }, async () => {
      await tx.run(sql`
        INSERT INTO nw_pending (book_id, member_id, count) VALUES (${group.groupBookId}, ${group.me}, ${count})
        ON CONFLICT (book_id, member_id) DO UPDATE SET count = excluded.count`);
    });
  });
}

/** Each member's pending count in a group log (D8), for the joint report's "Rina hasn't added N items yet". */
export async function pendingCounts(database: Database, groupBookId: string): Promise<Record<string, number>> {
  const rows = await database.db.values<[string, number]>(sql`SELECT member_id, count FROM nw_pending WHERE book_id = ${groupBookId}`);
  return Object.fromEntries(rows.map(([member, count]) => [member, Number(count)]));
}
