import {
  activeNetWorthGroup,
  clearJointAccounts,
  confirmReview,
  type Database,
  listSharedBooks,
  netWorthMarks,
  ownSentAccountIds,
  reviewedFor,
  reviewItems,
  setNetWorthMarks,
  setShareSetting,
  type ShareSetting,
  sharingDetail,
  storedJointAccount,
  type WorkspaceContext,
} from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';
import type { SyncService } from '../../sync/sync-service';
import { autoConfirmOf, autoReviewSettings, othersStopped } from './net-worth-auto';
import { namesOf, type FilingMode } from './net-worth-state';
import { workspaceBooks } from './workspace-books';

/*
 * The household this person shares net worth with (2026-11-13), as the item pages need it for their "Shared with Andi"
 * switch: the workspace, where its net-worth group stands, and who the others are. Plus the one way an item is switched
 * — the first one switched on starts the group, filed separately — and the steps the app takes by itself (review round
 * 1: nothing is ever shared without a tap on that person's own phone; an existing household looks the same).
 */

export interface Household {
  bookId: string;
  /**
   * `none`: no group yet (the first switch starts it); `waiting`: started, the other phone has yet to confirm; `asked`:
   * a group was asked of this phone and waits for its Confirm in the Tax report; `stopped`: the others stopped sharing
   * net worth (a switch here starts nothing until they start again); `active`.
   */
  stage: 'none' | 'waiting' | 'asked' | 'stopped' | 'active';
  /** The active group's filing; null before one is active. */
  mode: FilingMode | null;
  /** The active group's review is still to be answered by this person (a group from before this update, or a change). */
  reviewDue: boolean;
  /** The other members, by name: who "Shared with …" names. */
  others: { memberId: string; name: string }[];
}

type Deps = { database: Database; ws: WorkspaceContext; sync: SyncService };

/** The line a Shared switch shows while the others have stopped. */
export const stoppedLine = (others: readonly string[]) => `${namesOf(others) || 'The others'} stopped sharing net worth. It starts again from their phone.`;

/** The household as it stands: an active group first, then one waiting or asked, then a shared workspace someone joined. */
export async function householdOf({ database, sync }: Pick<Deps, 'database' | 'sync'>): Promise<Household | null> {
  const books = workspaceBooks(await listSharedBooks(database)).filter((book) => book.state === 'active');
  const othersOf = (bookId: string, members?: readonly string[]) => {
    const book = books.find((b) => b.bookId === bookId);
    return (book?.members ?? []).filter((member) => member.memberId !== book?.memberId && (!members || members.includes(member.memberId))).map(({ memberId, name }) => ({ memberId, name }));
  };
  const active = await activeNetWorthGroup(database);
  if (active) {
    const reviewDue = !(await reviewedFor(database, active.groupBookId, active.proposalId));
    return { bookId: active.workspaceBookId, stage: 'active', mode: active.mode, reviewDue, others: othersOf(active.workspaceBookId, active.members) };
  }
  const deviceId = await sync.deviceId();
  let first: Household | null = null;
  for (const book of books) {
    if (book.members.length < 2) continue;
    const view = await sync.netWorthGroup(book.bookId).catch(() => null);
    const pending = view?.pending;
    if (view && pending && !pending.cancelled && pending.members.includes(view.me)) {
      const stage = view.waitingFor.includes(view.me) ? 'asked' : 'waiting';
      return { bookId: book.bookId, stage, mode: null, reviewDue: false, others: othersOf(book.bookId, pending.members) };
    }
    if (!first) {
      const detail = await sharingDetail(database, book.bookId, deviceId);
      const joined = (detail?.members ?? []).filter((member) => !member.me && member.devices.length > 0);
      if (joined.length > 0) {
        const stopped = othersStopped(view, await netWorthMarks(database, book.bookId));
        first = { bookId: book.bookId, stage: stopped ? 'stopped' : 'none', mode: null, reviewDue: false, others: joined.map(({ memberId, name }) => ({ memberId, name })) };
      }
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
 * An item switched while no group is active yet (none, or waiting for the other phone): remembered on this phone as
 * switched on here, so the review the app answers once the group is active shares exactly these and nothing else.
 */
export async function rememberSwitch(database: Database, bookId: string, accountId: string, on: boolean): Promise<void> {
  if (await activeNetWorthGroup(database)) return;
  const marks = await netWorthMarks(database, bookId);
  const intent = new Set(marks.intent);
  if (on) intent.add(accountId);
  else intent.delete(accountId);
  await setNetWorthMarks(database, bookId, { intent: [...intent] });
}

/**
 * Starts the household's net worth, filed separately (the default for a new group, 2026-11-13), with these settings:
 * written first, and the ones switched on remembered as this person's own choice; then the proposal, through the action
 * the old setup's Invite ran. Starting is this person's tap, so an earlier stop of theirs is over.
 */
export async function startNetWorth({ database, sync }: Pick<Deps, 'database' | 'sync'>, bookId: string, members: readonly string[], settings: Readonly<Record<string, ShareSetting>>): Promise<void> {
  // A fresh start owns nothing together until a tap says so: a mark left from an earlier group never comes back.
  await clearJointAccounts(database);
  for (const [accountId, setting] of Object.entries(settings)) await setShareSetting(database, accountId, setting);
  const intent = Object.entries(settings)
    .filter(([, setting]) => setting === 'total')
    .map(([accountId]) => accountId);
  await setNetWorthMarks(database, bookId, { intent, optedOut: false, seen: true });
  await sync.proposeNetWorth(bookId, { mode: 'separate', members: [...members] });
}

/** Refused while the others have stopped: the app never starts net worth again for them. */
export class OthersStoppedError extends Error {}

/**
 * One item's Shared switch, from its own page. Before any group the first one on starts it (everything else private);
 * waiting for the other phone, the setting, remembered as switched here; in an active group whose review this person has
 * not answered, the tap answers it as the list does — what the others already see stays, this item as switched, nothing
 * else (one tax ID: the setting only, until the review); otherwise the setting, as the page always wrote it.
 */
export async function switchItemShared(deps: Deps, household: Household, accountId: string, on: boolean): Promise<void> {
  const { database, ws } = deps;
  const setting: ShareSetting = on ? 'total' : 'hidden';
  if (household.stage === 'asked') throw new Error('Answer what was asked in the Tax report first.');
  if (household.stage === 'stopped') throw new OthersStoppedError(stoppedLine(household.others.map((other) => other.name)));
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
    const live = new Set(await ownSentAccountIds(database, group.groupBookId));
    const settings: Record<string, ShareSetting> = {};
    for (const item of await reviewItems(database, ws)) settings[item.accountId] = live.has(item.accountId) && item.setting === 'total' ? 'total' : 'hidden';
    settings[accountId] = setting;
    await confirmReview(database, ws, settings, { missing: 'hidden' });
    return;
  }
  await setShareSetting(database, accountId, setting);
  if (!group) await rememberSwitch(database, household.bookId, accountId, on);
}

/** Whether the list shows an account's Owned together while a group waits: the stored choice, never one from before. */
export async function chosenJoint(database: Database, accountId: string): Promise<boolean> {
  return storedJointAccount(database, accountId);
}

/**
 * One pass of what the app does by itself (review round 1): confirms the very first group filed separately; answers the
 * review of a group filed separately with exactly what this person switched on here; notes on this phone that a group
 * was seen; and, with no group here any more, forgets Owned together so a later group never brings it back. Returns
 * whether it changed anything.
 */
export async function netWorthAutoStepsOnce(deps: Deps, step: (key: string, work: () => Promise<void>) => Promise<boolean> = runStep): Promise<boolean> {
  const { database, ws, sync } = deps;
  let changed = false;
  const active = await activeNetWorthGroup(database);
  for (const book of workspaceBooks(await listSharedBooks(database))) {
    if (book.state !== 'active' || book.members.length < 2) continue;
    const view = await sync.netWorthGroup(book.bookId).catch(() => null);
    const marks = await netWorthMarks(database, book.bookId);
    const mine = view && ((view.active?.members.includes(view.me) ?? false) || (view.pending && !view.pending.cancelled && view.pending.members.includes(view.me)));
    if (mine && !marks.seen) await setNetWorthMarks(database, book.bookId, { seen: true });
    // A group this phone was in, known to be gone (the engine read the groups, and none is active or waiting): Owned
    // together is forgotten, so a group made later never brings it back. Never while the state is unknown (the engine not
    // started: `view` null) or a group waits (re-review round 2).
    if (view && marks.seen && !view.active && !(view.pending && !view.pending.cancelled)) await clearJointAccounts(database);
    const proposalId = autoConfirmOf(view, active && active.workspaceBookId !== book.bookId ? active.workspaceBookId : null, marks);
    if (proposalId) changed = (await step(`confirm:${proposalId}`, () => sync.answerNetWorth(book.bookId, proposalId, 'confirm'))) || changed;
  }
  const group = await activeNetWorthGroup(database);
  if (group && group.mode === 'separate' && !(await reviewedFor(database, group.groupBookId, group.proposalId))) {
    const marks = await netWorthMarks(database, group.workspaceBookId);
    const settings = autoReviewSettings(await reviewItems(database, ws), marks.intent);
    if (settings) {
      changed =
        (await step(`review:${group.groupBookId}:${group.proposalId}`, async () => {
          await confirmReview(database, ws, settings, { missing: 'hidden' });
          await setNetWorthMarks(database, group.workspaceBookId, { intent: [] });
          // What the review sends goes now, not at the next scheduled run: the partner is likely looking.
          await sync.syncNow(group.workspaceBookId);
        })) || changed;
    }
  }
  return changed;
}

async function runStep(_key: string, work: () => Promise<void>): Promise<boolean> {
  await work();
  return true;
}

/**
 * Runs `netWorthAutoStepsOnce` after every sync run and once at the start. One run at a time; a step that failed is tried
 * again a minute later at the soonest. Returns the stop.
 */
export function watchNetWorthAutoSteps(deps: Deps, onChanged: () => void): () => void {
  let running = false;
  let again = false;
  let stopped = false;
  const failedAt = new Map<string, number>();

  async function step(key: string, work: () => Promise<void>): Promise<boolean> {
    if ((failedAt.get(key) ?? 0) + 60_000 > Date.now()) return false;
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
        if (await netWorthAutoStepsOnce(deps, step).catch((error: unknown) => (console.warn('Net worth steps did not run', error), false))) onChanged();
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
