import type { GoalShareTarget, GoalShareView, ShareSetting } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { shareRowState } from '../goals/goal-sharing';
import { type FilingMode, JOINT_LINE, namesOf } from './net-worth-state';

/*
 * One list to choose what to share with a household (2026-11-12): net worth items (with Joint), goals and events, a
 * tick each. Budgets, bills, categories and the workspace's transactions are the workspace's already, so they are not
 * here. Pure: which items, in which group, ticked as things stand, what a draft changes, and the counts — the page only
 * draws it and runs each change through the share action the item's own page already uses (`applyShareChanges`).
 */

export type ShareGroupKey = 'accounts' | 'assets' | 'goals' | 'events';

/** Money accounts and credit cards: the items with a Joint switch on their own page. The rest of net worth is assets & debts. */
export const ACCOUNT_CARD_SUBTYPES: readonly string[] = ['bank', 'cash', 'savings', 'ewallet', 'emoney', 'fund', 'time_deposit', 'other_cash', 'credit_card'];

/**
 * Net worth rows the list leaves out: an event's trip balance is made by the event (shared events §5), never chosen, so
 * it is not offered here. A review keeps whatever it already has (or nothing shared).
 */
export const LEFT_OUT_SUBTYPES: readonly string[] = ['event_balance'];

export interface ShareListItem {
  /** Unique across groups: `group:id`. */
  key: string;
  group: ShareGroupKey;
  id: string;
  name: string;
  /** The quiet word at the row's end: an asset's kind, an event's month. */
  meta: string | null;
  /** Shared as things stand (stored). */
  shared: boolean;
  /** Ticked when the list opens: shared, or bound to be (one tax ID shares every item). */
  ticked: boolean;
  /** Why the tick cannot be taken off here; null when it can. */
  locked: string | null;
  /** A money account or a credit card: Joint can be turned on once it is ticked. */
  canJoint: boolean;
  /** Joint as things stand. */
  joint: boolean;
}

export interface ShareListGroup {
  key: ShareGroupKey;
  label: string;
  items: ShareListItem[];
}

export interface NetWorthInput {
  mode: FilingMode;
  /** This person has yet to press Share on the review of the active group: Share here is that review. */
  reviewing: boolean;
  items: readonly { accountId: string; name: string; subtype: string; setting: ShareSetting | null }[];
  /** The accounts made joint now. */
  joint: ReadonlySet<string>;
}

export interface ShareListInput {
  /** The household workspace book the list is for. */
  bookId: string;
  /** Null when this person is in no active net-worth group of this workspace: no net worth item can be shared yet. */
  netWorth: NetWorthInput | null;
  /** The owner's goals (archived left out by the caller), each with its link as this phone has it. */
  goals: readonly { id: string; name: string; share: GoalShareView | null }[];
  goalTargets: readonly GoalShareTarget[];
  /** The owner's events (archived left out), and whether each is shared. */
  events: readonly { id: string; name: string; startsOn: string; shared: boolean }[];
}

export interface ShareList {
  groups: ShareListGroup[];
  netWorth: NetWorthInput | null;
}

export const EVENT_LOCKED = 'A shared event stays shared. Leave is under Events on the Share page.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct" for an ISO day in October; null for anything else. */
export function monthOf(isoDay: string): string | null {
  const month = Number(isoDay.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? MONTHS[month - 1]! : null;
}

export function shareListOf(input: ShareListInput): ShareList {
  const groups: ShareListGroup[] = [];
  const nw = input.netWorth;
  if (nw) {
    const accounts: ShareListItem[] = [];
    const assets: ShareListItem[] = [];
    for (const item of nw.items) {
      if (LEFT_OUT_SUBTYPES.includes(item.subtype)) continue;
      const shared = item.setting === 'total';
      // One tax ID: every item is in the joint report. Shared ones cannot be taken back, and the review shares all.
      const forced = nw.mode === 'joint' && (shared || nw.reviewing);
      const isAccount = ACCOUNT_CARD_SUBTYPES.includes(item.subtype);
      const row: ShareListItem = {
        key: `${isAccount ? 'accounts' : 'assets'}:${item.accountId}`,
        group: isAccount ? 'accounts' : 'assets',
        id: item.accountId,
        name: item.name,
        meta: isAccount ? null : (SUBTYPE_LABELS[item.subtype as keyof typeof SUBTYPE_LABELS] ?? null),
        shared,
        ticked: shared || forced,
        locked: forced ? JOINT_LINE : null,
        canJoint: isAccount,
        joint: isAccount && shared && nw.joint.has(item.accountId),
      };
      (isAccount ? accounts : assets).push(row);
    }
    if (accounts.length > 0) groups.push({ key: 'accounts', label: 'Accounts & cards', items: accounts });
    if (assets.length > 0) groups.push({ key: 'assets', label: 'Assets & debts', items: assets });
  }

  const targets = input.goalTargets.filter((target) => target.bookId === input.bookId);
  const goals: ShareListItem[] = [];
  for (const goal of input.goals) {
    // Goals shared by someone else, shared into another workspace, deleted, or with nowhere to go are left out.
    const row = shareRowState(targets, goal.share);
    if (row.kind !== 'switch' || row.bookId !== input.bookId) continue;
    const shared = goal.share?.state === 'on';
    goals.push({ key: `goals:${goal.id}`, group: 'goals', id: goal.id, name: goal.name, meta: null, shared, ticked: shared, locked: null, canJoint: false, joint: false });
  }
  if (goals.length > 0) groups.push({ key: 'goals', label: 'Goals', items: goals });

  const events = input.events.map<ShareListItem>((event) => ({
    key: `events:${event.id}`,
    group: 'events',
    id: event.id,
    name: event.name,
    meta: monthOf(event.startsOn),
    shared: event.shared,
    ticked: event.shared,
    // Sharing an event moves its spending into it for good; it is left, never unshared (2026-10-27).
    locked: event.shared ? EVENT_LOCKED : null,
    canJoint: false,
    joint: false,
  }));
  if (events.length > 0) groups.push({ key: 'events', label: 'Events', items: events });

  return { groups, netWorth: nw };
}

/** What the list says now: the keys ticked, and the accounts with Joint on. */
export interface ShareDraft {
  ticked: ReadonlySet<string>;
  joint: ReadonlySet<string>;
}

const itemsOf = (list: ShareList) => list.groups.flatMap((group) => group.items);

export function draftOf(list: ShareList): ShareDraft {
  const items = itemsOf(list);
  return { ticked: new Set(items.filter((item) => item.ticked).map((item) => item.key)), joint: new Set(items.filter((item) => item.joint).map((item) => item.id)) };
}

/** Ticks or unticks one item; a locked tick stays. */
export function toggle(draft: ShareDraft, item: ShareListItem): ShareDraft {
  const ticked = new Set(draft.ticked);
  if (ticked.has(item.key)) {
    if (item.locked) return draft;
    ticked.delete(item.key);
  } else ticked.add(item.key);
  return { ...draft, ticked };
}

/** Joint on or off for a ticked account; nothing for anything else. */
export function toggleJoint(draft: ShareDraft, item: ShareListItem): ShareDraft {
  if (!item.canJoint || !draft.ticked.has(item.key)) return draft;
  const joint = new Set(draft.joint);
  if (!joint.delete(item.id)) joint.add(item.id);
  return { ...draft, joint };
}

/** Tick all: every item of the group ticked. */
export function tickAll(draft: ShareDraft, group: ShareListGroup): ShareDraft {
  const ticked = new Set(draft.ticked);
  for (const item of group.items) ticked.add(item.key);
  return { ...draft, ticked };
}

/** Whether Joint reads on for this item in the draft: only ever on a ticked account. */
export function jointOn(draft: ShareDraft, item: ShareListItem): boolean {
  return item.canJoint && draft.ticked.has(item.key) && draft.joint.has(item.id);
}

/** How many items the draft ticks: the button's "Share N items". */
export function tickedCount(list: ShareList, draft: ShareDraft): number {
  return itemsOf(list).filter((item) => draft.ticked.has(item.key)).length;
}

/** How many are shared as things stand: the Share page's "N items". */
export function sharedCount(list: ShareList): number {
  return itemsOf(list).filter((item) => item.shared).length;
}

export type ShareChange =
  /** The review of the active net-worth group, answered for every item at once (`confirmReview`). */
  | { kind: 'review'; name: string; settings: Record<string, ShareSetting> }
  | { kind: 'setting'; name: string; accountId: string; setting: ShareSetting }
  | { kind: 'joint'; name: string; accountId: string; on: boolean }
  | { kind: 'share-goal'; name: string; goalId: string }
  | { kind: 'stop-goal'; name: string; goalId: string }
  | { kind: 'share-event'; name: string; eventId: string };

export const REVIEW_NAME = 'Accounts, cards, assets and debts';

/**
 * What the draft changes, in the order it is applied: net worth settings (or the review) first, Joint after them — an
 * account is made joint only once it is shared — then goals, then events, whose share is the slowest and ends in an
 * invite.
 */
export function changesOf(list: ShareList, draft: ShareDraft): ShareChange[] {
  const out: ShareChange[] = [];
  const nwItems = list.groups.filter((group) => group.key === 'accounts' || group.key === 'assets').flatMap((group) => group.items);
  const nw = list.netWorth;
  if (nw && nwItems.length > 0) {
    if (nw.reviewing) {
      const settings: Record<string, ShareSetting> = {};
      for (const item of nwItems) settings[item.id] = nw.mode === 'joint' || draft.ticked.has(item.key) ? 'total' : 'hidden';
      for (const item of nw.items) if (LEFT_OUT_SUBTYPES.includes(item.subtype)) settings[item.accountId] = nw.mode === 'joint' ? 'total' : (item.setting ?? 'hidden');
      out.push({ kind: 'review', name: REVIEW_NAME, settings });
    } else {
      for (const item of nwItems) {
        const want = draft.ticked.has(item.key);
        if (want !== item.shared) out.push({ kind: 'setting', name: item.name, accountId: item.id, setting: want ? 'total' : 'hidden' });
      }
    }
    for (const item of nwItems) {
      // Unticked, the account is no longer shared, and not shared is not joint: the setting takes Joint with it.
      if (!item.canJoint || !draft.ticked.has(item.key)) continue;
      const want = draft.joint.has(item.id);
      if (want !== item.joint) out.push({ kind: 'joint', name: item.name, accountId: item.id, on: want });
    }
  }
  for (const item of list.groups.find((group) => group.key === 'goals')?.items ?? []) {
    const want = draft.ticked.has(item.key);
    if (want && !item.shared) out.push({ kind: 'share-goal', name: item.name, goalId: item.id });
    if (!want && item.shared) out.push({ kind: 'stop-goal', name: item.name, goalId: item.id });
  }
  for (const item of list.groups.find((group) => group.key === 'events')?.items ?? []) {
    if (draft.ticked.has(item.key) && !item.shared) out.push({ kind: 'share-event', name: item.name, eventId: item.id });
  }
  return out;
}

/** Each change through the share action its own page uses. A goal turned off asks first (its page's own question). */
export interface ShareRunners<Invite> {
  review(settings: Record<string, ShareSetting>): Promise<void>;
  setting(accountId: string, setting: ShareSetting): Promise<void>;
  joint(accountId: string, on: boolean): Promise<void>;
  shareGoal(goalId: string): Promise<void>;
  stopGoal(goalId: string): Promise<void>;
  /** Shares the event and makes its invite, to be sent to the others. */
  shareEvent(eventId: string): Promise<Invite>;
}

export interface ShareOutcome<Invite> {
  /** How many changes went through. */
  done: number;
  /** Each change that did not, by item name, with why in words. */
  failed: { name: string; reason: string }[];
  /** The invites of the events just shared. */
  invites: { eventId: string; name: string; invite: Invite }[];
}

/**
 * Runs every change, in order, each on its own: one that fails is reported and the rest still run, so nothing is left
 * half-said — the outcome names every item that did not go through and why.
 */
export async function applyShareChanges<Invite>(changes: readonly ShareChange[], runners: ShareRunners<Invite>, say: (error: unknown) => string): Promise<ShareOutcome<Invite>> {
  const outcome: ShareOutcome<Invite> = { done: 0, failed: [], invites: [] };
  for (const change of changes) {
    try {
      switch (change.kind) {
        case 'review':
          await runners.review(change.settings);
          break;
        case 'setting':
          await runners.setting(change.accountId, change.setting);
          break;
        case 'joint':
          await runners.joint(change.accountId, change.on);
          break;
        case 'share-goal':
          await runners.shareGoal(change.goalId);
          break;
        case 'stop-goal':
          await runners.stopGoal(change.goalId);
          break;
        case 'share-event':
          outcome.invites.push({ eventId: change.eventId, name: change.name, invite: await runners.shareEvent(change.eventId) });
          break;
      }
      outcome.done += 1;
    } catch (error) {
      outcome.failed.push({ name: change.name, reason: say(error) });
    }
  }
  return outcome;
}

/** The changes left once each goal turned off was asked about: a goal whose question was declined stays shared. */
export function keepConfirmed(changes: readonly ShareChange[], confirmStop: (goalId: string) => boolean): ShareChange[] {
  return changes.filter((change) => change.kind !== 'stop-goal' || confirmStop(change.goalId));
}

/* ------------------------------------------------------------------------------------------------------------- copy */

/** Who the list is about: the one other member by name, or the workspace when there are more. */
export function audienceOf(others: readonly string[], bookName: string): string {
  return others.length === 1 ? others[0]! : bookName;
}

function whoSees(others: readonly string[], bookName: string): { who: string; one: boolean } {
  if (others.length === 0) return { who: `Everyone in ${bookName}`, one: true };
  if (others.length > 3) return { who: `Everyone in ${bookName}`, one: true };
  return { who: namesOf(others), one: others.length === 1 };
}

export const SHARE_LIST_COPY = {
  setupTitle: (others: readonly string[], bookName: string) => `Share with ${audienceOf(others, bookName)}`,
  title: (others: readonly string[], bookName: string) => `What’s shared with ${audienceOf(others, bookName)}`,
  step: 'Step 2 of 2',
  lede: (others: readonly string[], bookName: string) => {
    const { who, one } = whoSees(others, bookName);
    return `${bookName}’s budgets, bills and transactions are already shared. Pick what else ${who} ${one ? 'sees' : 'see'}. Nothing here is shared until ticked.`;
  },
  accountsFooter: (others: readonly string[], bookName: string) => {
    const { who, one } = whoSees(others, bookName);
    return `Ticked: ${who} ${one ? 'sees' : 'see'} its balance on Net worth. Joint: ${who} can also pay from it in ${bookName} and ${one ? 'sees' : 'see'} its rows.`;
  },
  tickAll: 'Tick all',
  joint: 'Joint',
  shareButton: (count: number) => `Share ${count} ${count === 1 ? 'item' : 'items'}`,
  later: 'Later',
  rowValue: (count: number) => (count === 0 ? 'None' : `${count} ${count === 1 ? 'item' : 'items'}`),
  workspaceFooter: (bookName: string) => `Budgets, bills, categories and ${bookName}’s transactions are shared with ${bookName} as a whole.`,
  netWorthOff: 'Accounts, cards, assets and debts are listed here once net worth is shared.',
  failedHeader: 'Not shared',
  invitesFooter: (others: readonly string[], bookName: string) => `Send each invite to ${whoSees(others, bookName).who}: an event is joined with its own code.`,
} as const;
