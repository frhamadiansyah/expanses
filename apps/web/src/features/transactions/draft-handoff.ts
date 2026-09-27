import type { FormDraft } from './tx-form';

/**
 * A new transaction set aside while an account is added for it.
 *
 * Paid with's Add account opens the full New account screen, which is a page of its own: the form under it unmounts,
 * and what was typed would be gone. So the draft is written here on the way out, and read back — once — when New
 * transaction opens again, with the account just made if there is one. Session storage, never local: it is a
 * detour of a minute, not something to find again tomorrow, and a draft older than a few minutes is not offered.
 */
const KEY = 'expanses:new-transaction-handoff';
const FRESH_MS = 10 * 60 * 1000;

export interface Handoff {
  draft: FormDraft;
  /** The account New account made, to be picked in Paid with; absent when the reader came back without one. */
  addedAccountId?: string;
  at: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const store = (): Store | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function stashDraft(draft: FormDraft, now = Date.now(), storage: Store | null = store()): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ draft, at: now } satisfies Handoff));
  } catch {
    // Storage refused (private mode, full): the detour still works, the draft is simply not kept.
  }
}

/** Marks the stashed draft with the account just made, when there is a draft waiting for one. */
export function noteAddedAccount(accountId: string, storage: Store | null = store()): void {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return;
    storage?.setItem(KEY, JSON.stringify({ ...(JSON.parse(raw) as Handoff), addedAccountId: accountId }));
  } catch {
    // As above: nothing to mark.
  }
}

/** Whether a draft is waiting, without taking it: New account asks this to know where to go back to. */
export function hasStashedDraft(now = Date.now(), storage: Store | null = store()): boolean {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? now - (JSON.parse(raw) as Handoff).at < FRESH_MS : false;
  } catch {
    return false;
  }
}

/**
 * The draft set aside, read without taking it — New transaction reads it as it opens, and clears it once it has
 * opened, so a render run twice cannot lose it. A stale one reads as nothing.
 */
export function readStashedDraft(now = Date.now(), storage: Store | null = store()): Handoff | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const handoff = JSON.parse(raw) as Handoff;
    return now - handoff.at < FRESH_MS ? handoff : null;
  } catch {
    return null;
  }
}

/** Forgets the draft set aside: it has been opened, and a second New transaction starts empty. */
export function clearStashedDraft(storage: Store | null = store()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
