import { activeNetWorthGroup, getJointAccount, getShareSetting, jointAccountIds, jointAccountRows, paidWithItems, pendingHidden, reviewedFor, reviewItems, sharingDetail } from '@expanses/db';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { jointWithPockets } from './joint-pockets';

/*
 * What the net-worth screens read (joint-net-worth §6, §8.1). Everything is keyed under `net-worth`, and re-read after
 * every sync run: a partner's confirm, a new proposal or a dissolved group arrives with a run, not with a local write.
 */

/** The clients with a re-read already asked for in this turn of the event loop. */
const rereading = new WeakSet<QueryClient>();

/**
 * Every hook below listens, so one screen has half a dozen listeners, and each of them dropping `net-worth` on its own
 * started every read under it again and again within the same moment — each new start cancelling the one before it,
 * which the database still worked through to the end (Net worth's group was read seven times on one open). They are
 * one re-read now: the first listener asks, the rest of that turn join it.
 */
export function rereadNetWorth(queryClient: QueryClient): void {
  if (rereading.has(queryClient)) return;
  rereading.add(queryClient);
  queueMicrotask(() => {
    rereading.delete(queryClient);
    void queryClient.invalidateQueries({ queryKey: ['net-worth'] });
  });
}

function useRereadOnSync() {
  const { sync } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => sync.subscribe(() => rereadNetWorth(queryClient)), [sync, queryClient]);
}

/** The workspace's net-worth group as this device derives it; null before this device has an engine. */
export function useNetWorthGroup(bookId: string) {
  const { sync } = useApp();
  useRereadOnSync();
  return useQuery({ queryKey: ['net-worth', 'group', bookId], queryFn: async () => sync.netWorthGroup(bookId) });
}

/** The one active group this person is in, in any workspace (owner scope), or null: what the item pages and add forms ask. */
export function useActiveNetWorthGroup() {
  const { database } = useApp();
  useRereadOnSync();
  return useQuery({ queryKey: ['net-worth', 'active'], queryFn: () => activeNetWorthGroup(database) });
}

/** One item's share setting: `total`, `hidden`, or null (not reviewed). */
export function useShareSetting(accountId: string) {
  const { database } = useApp();
  return useQuery({ queryKey: ['net-worth', 'setting', accountId], queryFn: () => getShareSetting(database, accountId) });
}

/** Every item with its setting, for the review, and the ones still hidden while the household files jointly (D8). */
export function useReview() {
  const { database, ws } = useApp();
  useRereadOnSync();
  return useQuery({
    queryKey: ['net-worth', 'review', ws.workspaceId],
    queryFn: async () => {
      const group = await activeNetWorthGroup(database);
      return {
        items: await reviewItems(database, ws),
        pending: await pendingHidden(database, ws),
        // Whether Share was pressed on the review of the active proposal: every activation (a Change too) asks again.
        reviewed: group ? await reviewedFor(database, group.groupBookId, group.proposalId) : false,
      };
    },
  });
}

/** The partner's shared items this workspace's Paid with can offer (§7.1): none outside the group's workspace. */
export function usePaidWithItems(bookId: string) {
  const { database } = useApp();
  useRereadOnSync();
  return useQuery({ queryKey: ['net-worth', 'paid-with', bookId], queryFn: () => paidWithItems(database, bookId), enabled: bookId !== '' });
}

/** Whether the holder has made this shared account joint (the "Joint account" switch). */
export function useJointAccount(accountId: string) {
  const { database } = useApp();
  return useQuery({ queryKey: ['net-worth', 'joint', accountId], queryFn: () => getJointAccount(database, accountId) });
}

const NO_JOINT: ReadonlySet<string> = new Set();

/**
 * This phone's own accounts made joint: Cashflow lists a transfer touching one in the shared workspace alone, as the
 * household's (owner 2026-11-13). Empty until read, which lists such a transfer nowhere for that moment, never everywhere.
 */
export function useJointAccountIds(): ReadonlySet<string> {
  const { database } = useApp();
  useRereadOnSync();
  const ids = useQuery({ queryKey: ['net-worth', 'joint-ids'], queryFn: async () => new Set(await jointAccountIds(database)) });
  // A joint account's pockets are joint too, and a joint pocket's account (`jointWithPockets`).
  const accounts = useAccounts().data;
  return useMemo(() => (ids.data ? jointWithPockets(ids.data, accounts ?? []) : NO_JOINT), [ids.data, accounts]);
}

/**
 * The rows of a joint account recorded in the shared workspace, with the names of the workspace's members: the same
 * read on the holder's phone and the partner's. `of` is the item, or null for nothing to read.
 */
export function useJointRows(of: { workspaceBookId: string; itemId: string; owner: string } | null) {
  const { database } = useApp();
  useRereadOnSync();
  return useQuery({
    queryKey: ['net-worth', 'joint-rows', of?.workspaceBookId ?? null, of?.itemId ?? null, of?.owner ?? null],
    enabled: of !== null,
    queryFn: async () => {
      const rows = await jointAccountRows(database, of!.workspaceBookId, of!.itemId, of!.owner);
      const names: Record<string, string> = {};
      for (const member of (await sharingDetail(database, of!.workspaceBookId, null))?.members ?? []) names[member.memberId] = member.name;
      return { rows, names };
    },
  });
}

