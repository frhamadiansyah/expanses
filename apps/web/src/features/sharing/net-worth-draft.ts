import { useSyncExternalStore } from 'react';
import type { FilingMode } from './net-worth-state';

/*
 * What the Net worth page and its Shared list agree on before anything is sent: the filing answer, who joins, and which
 * items stay private. A pushed page unmounts the one under it, so this lives outside both. In memory only; it goes when
 * Invite or Share is sent.
 */

export interface NetWorthDraft {
  mode: FilingMode | null;
  chosen: string[];
  /** Ids of the items kept private; null until the list is first opened (then the stored settings stand). */
  hidden: string[] | null;
}

const EMPTY: NetWorthDraft = { mode: null, chosen: [], hidden: null };
const drafts = new Map<string, NetWorthDraft>();
const listeners = new Set<() => void>();

function read(key: string): NetWorthDraft {
  return drafts.get(key) ?? EMPTY;
}

function notify() {
  for (const listener of listeners) listener();
}

export function setDraft(key: string, patch: Partial<NetWorthDraft>): void {
  drafts.set(key, { ...read(key), ...patch });
  notify();
}

export function clearDraft(key: string): void {
  drafts.delete(key);
  notify();
}

export function useDraft(key: string): NetWorthDraft {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read(key),
  );
}

/** The first-time setup's draft, a Change's, and the review after an activation: separate per workspace. */
export const draftKey = (bookId: string, part: 'new' | 'change' | 'review') => `${bookId}:${part}`;
