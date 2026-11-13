import {
  activeNetWorthGroup,
  confirmReview,
  type Database,
  listSharedBooks,
  ownSentAccountIds,
  proposalOf,
  reviewedFor,
  reviewItems,
  setShareSetting,
  type ShareSetting,
  sharingDetail,
  type WorkspaceContext,
} from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';
import type { SyncService } from '../../sync/sync-service';
import { autoConfirmOf, autoReviewSettings } from './net-worth-auto';
import type { FilingMode } from './net-worth-state';
import { workspaceBooks } from './workspace-books';

/*
 * The household this person shares net worth with (2026-11-13), as the item pages need it for their "Shared with Andi"
 * switch: the workspace, whether its net-worth group is active, waiting for the other phone, or not started, and who
 * the others are. Plus the one way an item is switched — the first one switched on starts the group, filed separately.
 */

export interface Household {
  bookId: string;
  /** `none`: no group yet (the first switch starts it); `waiting`: started here, the other phone has yet to confirm. */
  stage: 'none' | 'waiting' | 'active';
  /** The active group's filing; null before one is active. */
  mode: FilingMode | null;
  /** The other members, by name: who "Shared with …" names. */
  others: { memberId: string; name: string }[];
}

type Deps = { database: Database; ws: WorkspaceContext; sync: SyncService };

/** The household as it stands: an active group first, then a group waiting on this phone's start, then a shared workspace someone joined. */
export async function householdOf({ database, sync }: Pick<Deps, 'database' | 'sync'>): Promise<Household | null> {
  const books = workspaceBooks(await listSharedBooks(database)).filter((book) => book.state === 'active');
  const othersOf = (bookId: string, members?: readonly string[]) => {
    const book = books.find((b) => b.bookId === bookId);
    return (book?.members ?? []).filter((member) => member.memberId !== book?.memberId && (!members || members.includes(member.memberId))).map(({ memberId, name }) => ({ memberId, name }));
  };
  const active = await activeNetWorthGroup(database);
  if (active) return { bookId: active.workspaceBookId, stage: 'active', mode: active.mode, others: othersOf(active.workspaceBookId, active.members) };
  const deviceId = await sync.deviceId();
  let first: Household | null = null;
  for (const book of books) {
    if (book.members.length < 2) continue;
    const view = await sync.netWorthGroup(book.bookId).catch(() => null);
    const pending = view?.pending;
    if (view && pending && !pending.cancelled && pending.members.includes(view.me)) {
      // A one-tax-ID setup asked of this phone is answered in the tax report; until then nothing here is switched.
      if (pending.mode === 'joint' && view.waitingFor.includes(view.me)) return null;
      return { bookId: book.bookId, stage: 'waiting', mode: null, others: othersOf(book.bookId, pending.members) };
    }
    if (!first) {
      const detail = await sharingDetail(database, book.bookId, deviceId);
      const joined = (detail?.members ?? []).filter((member) => !member.me && member.devices.length > 0);
      if (joined.length > 0) first = { bookId: book.bookId, stage: 'none', mode: null, others: joined.map(({ memberId, name }) => ({ memberId, name })) };
    }
  }
  return first;
}

/** `householdOf` for a screen, re-read after every sync run (the `net-worth` key). */
export function useHousehold() {
  const { database, sync, ws } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => sync.subscribe(() => void queryClient.invalidateQueries({ queryKey: ['net-worth'] })), [sync, queryClient]);
  return useQuery({ queryKey: ['net-worth', 'household', ws.workspaceId], queryFn: () => householdOf({ database, sync }) });
}

/**
 * Starts the household's net worth, filed separately (the default for a new group, 2026-11-13), with these settings:
 * written first, so whatever the other phone confirms meets them; then the proposal, through the action the old
 * setup's Invite ran. The other phone confirms it by itself (`watchNetWorthAutoSteps`).
 */
export async function startNetWorth({ database, sync }: Pick<Deps, 'database' | 'sync'>, bookId: string, members: readonly string[], settings: Readonly<Record<string, ShareSetting>>): Promise<void> {
  for (const [accountId, setting] of Object.entries(settings)) await setShareSetting(database, accountId, setting);
  await sync.proposeNetWorth(bookId, { mode: 'separate', members: [...members] });
}

/**
 * One item's Shared switch, from its own page: before any group the first one on starts it (everything else private);
 * waiting for the other phone, the setting alone; in an active group not yet reviewed here (filed separately), the
 * review is answered with what was chosen and this item; otherwise the setting, as the page always wrote it.
 */
export async function switchItemShared(deps: Deps, household: Household, accountId: string, on: boolean): Promise<void> {
  const { database, ws } = deps;
  const setting: ShareSetting = on ? 'total' : 'hidden';
  if (household.stage === 'none') {
    if (!on) return;
    const settings: Record<string, ShareSetting> = {};
    for (const item of await reviewItems(database, ws)) settings[item.accountId] = item.accountId === accountId ? 'total' : 'hidden';
    settings[accountId] = 'total';
    await startNetWorth(deps, household.bookId, household.others.map((other) => other.memberId), settings);
    return;
  }
  const group = await activeNetWorthGroup(database);
  if (group && group.mode === 'separate' && !(await reviewedFor(database, group.groupBookId, group.proposalId))) {
    await confirmReview(database, ws, await reviewSettingsNow(database, ws, group, { [accountId]: setting }), { missing: 'hidden' });
    return;
  }
  await setShareSetting(database, accountId, setting);
}

async function reviewSettingsNow(
  database: Database,
  ws: WorkspaceContext,
  group: { groupBookId: string; proposalId: string; me: string },
  now: Record<string, ShareSetting> = {},
): Promise<Record<string, ShareSetting>> {
  const proposal = await proposalOf(database.db, group.groupBookId, group.proposalId);
  const live = new Set(await ownSentAccountIds(database, group.groupBookId));
  return autoReviewSettings(await reviewItems(database, ws), { proposer: proposal?.proposal.proposedBy === group.me, live }, now);
}

/**
 * Runs the steps the old setup asked for by hand, after every sync run and once at the start: the partner's Confirm of
 * a group filed separately, and this person's review of an active group filed separately. Each through the action its
 * button ran. One run at a time; a step that failed is tried again a minute later at the soonest. Returns the stop.
 */
export function watchNetWorthAutoSteps(deps: Deps, onChanged: () => void): () => void {
  let running = false;
  let again = false;
  let stopped = false;
  const failedAt = new Map<string, number>();
  const due = (key: string) => (failedAt.get(key) ?? 0) + 60_000 <= Date.now();

  async function step(key: string, work: () => Promise<void>): Promise<boolean> {
    if (!due(key)) return false;
    try {
      await work();
      failedAt.delete(key);
      return true;
    } catch (error) {
      failedAt.set(key, Date.now());
      console.warn('Net worth step did not run', key, error);
      return false;
    }
  }

  async function once(): Promise<boolean> {
    const { database, ws, sync } = deps;
    let changed = false;
    const active = await activeNetWorthGroup(database);
    for (const book of workspaceBooks(await listSharedBooks(database))) {
      if (book.state !== 'active' || book.members.length < 2) continue;
      const view = await sync.netWorthGroup(book.bookId).catch(() => null);
      const proposalId = autoConfirmOf(view, active && active.workspaceBookId !== book.bookId ? active.workspaceBookId : null);
      if (proposalId) changed = (await step(`confirm:${proposalId}`, () => sync.answerNetWorth(book.bookId, proposalId, 'confirm'))) || changed;
    }
    const group = await activeNetWorthGroup(database);
    if (group && group.mode === 'separate' && !(await reviewedFor(database, group.groupBookId, group.proposalId))) {
      changed = (await step(`review:${group.groupBookId}:${group.proposalId}`, async () => confirmReview(database, ws, await reviewSettingsNow(database, ws, group), { missing: 'hidden' }))) || changed;
    }
    return changed;
  }

  async function run() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        if (await once().catch((error: unknown) => (console.warn('Net worth steps did not run', error), false))) onChanged();
      } while (again && !stopped);
    } finally {
      running = false;
    }
  }

  const off = deps.sync.subscribe(() => void run());
  void run();
  return () => {
    stopped = true;
    off();
  };
}
