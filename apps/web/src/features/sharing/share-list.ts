import { type GoalShareTarget, type GoalShareView, PAYABLE_SUBTYPES, type ShareSetting } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { shareEventFooter } from '../events/share-event';
import { shareRowState } from '../goals/goal-sharing';
import { type FilingMode, JOINT_LINE, jointTaxLine, namesOf } from './net-worth-state';

/*
 * One list to choose what to share with a household (2026-11-12): net worth items (with Joint), goals and events, a
 * tick each. Budgets, bills, categories and the workspace's transactions are the workspace's already, so they are not
 * here. Pure: which items, in which group, ticked as things stand, what a draft changes, and the counts — the page only
 * draws it and runs each change through the share action the item's own page already uses (`applyShareChanges`).
 *
 * Privacy rule (fix round 1): a row is ticked only when it is shared now, and nothing is shared that the person did not
 * tick in this draft. An item waiting for its review is drawn unticked, "Not shared yet", and Save answers a review only
 * when a net worth tick or Joint was changed here.
 */

export type ShareGroupKey = 'accounts' | 'assets' | 'goals' | 'events';

/** Money accounts and credit cards. The rest of net worth is assets & debts. */
export const ACCOUNT_CARD_SUBTYPES: readonly string[] = ['bank', 'cash', 'savings', 'ewallet', 'emoney', 'fund', 'time_deposit', 'other_cash', 'credit_card'];

/**
 * Net worth rows the list leaves out: an event's trip balance is made by the event (shared events §5), never chosen, so
 * it is not offered here. A review keeps whatever it already has (or nothing shared).
 */
export const LEFT_OUT_SUBTYPES: readonly string[] = ['event_balance'];

export const NOT_SHARED_YET = 'Not shared yet';

export interface ShareListItem {
  /** Unique across groups: `group:id`. */
  key: string;
  group: ShareGroupKey;
  id: string;
  name: string;
  /** The quiet word at the row's end: an asset's kind, an event's month and currency. */
  meta: string | null;
  /** A line under the name: "Not shared yet" for an item its review still waits on. */
  caption: string | null;
  /** Shared as things stand: the tick it opens with. */
  shared: boolean;
  /** Why the tick cannot be taken off here; null when it can. */
  locked: string | null;
  /** Something the partner can pay from (Paid with's kinds): Joint can be turned on once it is ticked. */
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
  /** The active proposal the list was read under: a Save answers the review of this one only. */
  proposalId: string;
  /**
   * This person pressed Share on the review of the active group (`reviewedFor`). Until then nothing of this activation
   * is sent, so nothing reads as shared, and only `confirmReview` can share anything.
   */
  reviewed: boolean;
  items: readonly { accountId: string; name: string; subtype: string; setting: ShareSetting | null }[];
  /** The accounts made joint now. */
  joint: ReadonlySet<string>;
  /**
   * This person's items live in the group's log now (`ownSentAccountIds`): what the partner sees. Before the review a
   * Change with the same members keeps refreshing them (`sendAllowance` 'live'), so they read as shared.
   */
  live: ReadonlySet<string>;
}

export interface ShareListInput {
  /** The household workspace book the list is for. */
  bookId: string;
  /** Null when this person is in no active net-worth group of this workspace: no net worth item can be shared yet. */
  netWorth: NetWorthInput | null;
  /** The owner's goals (archived left out by the caller), each with its link as this phone has it. */
  goals: readonly { id: string; name: string; share: GoalShareView | null }[];
  goalTargets: readonly GoalShareTarget[];
  /** The owner's events (archived left out), whether each is shared, and the currency a share would put it in. */
  events: readonly { id: string; name: string; startsOn: string; currency: string; shared: boolean }[];
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

/** The review waits and the household files with one tax ID: one tick for every net worth item, all or none. */
export function allOrNone(list: Pick<ShareList, 'netWorth'>): boolean {
  return list.netWorth !== null && !list.netWorth.reviewed && list.netWorth.mode === 'joint';
}

export function shareListOf(input: ShareListInput): ShareList {
  const groups: ShareListGroup[] = [];
  const nw = input.netWorth;
  if (nw) {
    const accounts: ShareListItem[] = [];
    const assets: ShareListItem[] = [];
    for (const item of nw.items) {
      if (LEFT_OUT_SUBTYPES.includes(item.subtype)) continue;
      // Before the review: what is live in this group's log, which the partner sees now (a Change with the same members
      // keeps it refreshing); stored as shared but not live — a new group — is not. After it: the stored setting.
      const shared = nw.reviewed ? item.setting === 'total' : nw.live.has(item.accountId);
      // Not shared yet: before the review, anything not live; after it, an item never asked about, or (one tax ID)
      // still hidden after the switch (D8). A `Don't share` chosen while filing separately is an answer, not a wait.
      const waiting = !nw.reviewed || item.setting === null || (nw.mode === 'joint' && item.setting === 'hidden');
      const isAccount = ACCOUNT_CARD_SUBTYPES.includes(item.subtype);
      const row: ShareListItem = {
        key: `${isAccount ? 'accounts' : 'assets'}:${item.accountId}`,
        group: isAccount ? 'accounts' : 'assets',
        id: item.accountId,
        name: item.name,
        meta: isAccount ? null : (SUBTYPE_LABELS[item.subtype as keyof typeof SUBTYPE_LABELS] ?? null),
        caption: !shared && waiting ? NOT_SHARED_YET : null,
        shared,
        // One tax ID: an item shared stays shared (D7).
        locked: shared && nw.mode === 'joint' ? JOINT_LINE : null,
        canJoint: PAYABLE_SUBTYPES.includes(item.subtype),
        joint: PAYABLE_SUBTYPES.includes(item.subtype) && shared && nw.joint.has(item.accountId),
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
    goals.push({ key: `goals:${goal.id}`, group: 'goals', id: goal.id, name: goal.name, meta: null, caption: null, shared, locked: null, canJoint: false, joint: false });
  }
  if (goals.length > 0) groups.push({ key: 'goals', label: 'Goals', items: goals });

  const events = input.events.map<ShareListItem>((event) => ({
    key: `events:${event.id}`,
    group: 'events',
    id: event.id,
    name: event.name,
    // The currency a share puts it in, fixed once shared: said before the tick.
    meta: [monthOf(event.startsOn), event.currency].filter((part): part is string => !!part).join(' · ') || null,
    caption: null,
    shared: event.shared,
    // Sharing an event moves its spending into it for good; it is left, never unshared (2026-10-27).
    locked: event.shared ? EVENT_LOCKED : null,
    canJoint: false,
    joint: false,
  }));
  if (events.length > 0) groups.push({ key: 'events', label: 'Events', items: events });

  return { groups, netWorth: nw };
}

/** The one tick every net worth row reads while a one-tax-ID review waits (all or none, `allOrNone`). */
export const ALL_NET_WORTH = 'netWorth:all';

/* ------------------------------------------------------------------------------------------------------------ draft */

/**
 * What the person changed, and only that: a tick or a Joint per item, over the list as it is read now. A row that
 * appears while the list is open opens as it stands (unticked unless shared), so it is never shared unless it was
 * shown and ticked. The net worth edits belong to the group as it stood (`basis`): a change of filing or of the review
 * drops them, since what a tick would do has changed.
 */
export interface ShareDraft {
  ticks: ReadonlyMap<string, boolean>;
  joints: ReadonlyMap<string, boolean>;
  basis: string | null;
}

function basisOf(list: Pick<ShareList, 'netWorth'>): string | null {
  return list.netWorth ? `${list.netWorth.proposalId}|${list.netWorth.mode}|${list.netWorth.reviewed ? 'reviewed' : 'waiting'}` : null;
}

const itemsOf = (list: ShareList) => list.groups.flatMap((group) => group.items);
const isNetWorth = (item: ShareListItem) => item.group === 'accounts' || item.group === 'assets';

export function emptyDraft(list: Pick<ShareList, 'netWorth'>): ShareDraft {
  return { ticks: new Map(), joints: new Map(), basis: basisOf(list) };
}

/** The draft over the list as it is now: edits of rows gone are dropped, and net worth edits too when its basis moved. */
export function reconcile(list: ShareList, draft: ShareDraft): ShareDraft {
  const items = new Map(itemsOf(list).map((item) => [item.key, item]));
  const basisMoved = draft.basis !== basisOf(list);
  const ticks = new Map(
    [...draft.ticks].filter(([key]) => (key === ALL_NET_WORTH ? !basisMoved && allOrNone(list) : items.has(key) && !(basisMoved && isNetWorth(items.get(key)!)))),
  );
  const accountKeys = new Map(itemsOf(list).filter((item) => item.canJoint).map((item) => [item.id, item]));
  const joints = new Map([...draft.joints].filter(([id]) => accountKeys.has(id) && !basisMoved));
  if (ticks.size === draft.ticks.size && joints.size === draft.joints.size && !basisMoved) return draft;
  return { ticks, joints, basis: basisOf(list) };
}

export function isTicked(draft: ShareDraft, item: ShareListItem): boolean {
  // All or none: the one tick holds for every net worth row, one that arrived mid-edit too (fix round 2).
  if (isNetWorth(item) && draft.ticks.get(ALL_NET_WORTH)) return true;
  return draft.ticks.get(item.key) ?? item.shared;
}

/** Whether Joint reads on for this item in the draft: only ever on a ticked account. */
export function jointOn(draft: ShareDraft, item: ShareListItem): boolean {
  return item.canJoint && isTicked(draft, item) && (draft.joints.get(item.id) ?? item.joint);
}

function withTick(ticks: Map<string, boolean>, item: ShareListItem, on: boolean) {
  if (on === item.shared) ticks.delete(item.key);
  else ticks.set(item.key, on);
}

/**
 * Ticks or unticks one item; a locked tick stays. Before a one-tax-ID review every net worth row goes together, held as
 * one tick (`ALL_NET_WORTH`): on, every row reads ticked; off, each is as it stands.
 */
export function toggle(list: ShareList, given: ShareDraft, item: ShareListItem): ShareDraft {
  const draft = reconcile(list, given);
  const on = !isTicked(draft, item);
  if (!on && item.locked) return draft;
  const ticks = new Map(draft.ticks);
  if (isNetWorth(item) && allOrNone(list)) {
    if (on) ticks.set(ALL_NET_WORTH, true);
    else ticks.delete(ALL_NET_WORTH);
  } else withTick(ticks, item, on);
  return { ...draft, ticks };
}

/** Joint on or off for a ticked account; nothing for anything else. */
export function toggleJoint(draft: ShareDraft, item: ShareListItem): ShareDraft {
  if (!item.canJoint || !isTicked(draft, item)) return draft;
  const joints = new Map(draft.joints);
  const on = !jointOn(draft, item);
  if (on === item.joint) joints.delete(item.id);
  else joints.set(item.id, on);
  return { ...draft, joints };
}

/** Tick all: every item of the group ticked. */
export function tickAll(list: ShareList, draft: ShareDraft, group: ShareListGroup): ShareDraft {
  let next = draft;
  for (const item of group.items) if (!isTicked(next, item)) next = toggle(list, next, item);
  return next;
}

/** How many items the draft ticks: the button's "Share N items". */
export function tickedCount(list: ShareList, draft: ShareDraft): number {
  return itemsOf(list).filter((item) => isTicked(draft, item)).length;
}

/** How many are shared as things stand: the Share page's "N items". An item waiting for its review is not. */
export function sharedCount(list: ShareList): number {
  return itemsOf(list).filter((item) => item.shared).length;
}

/** The events ticked now that are not shared yet: each will move its tagged spending when shared. */
export function eventsToShare(list: ShareList, draft: ShareDraft): ShareListItem[] {
  return (list.groups.find((group) => group.key === 'events')?.items ?? []).filter((item) => !item.shared && isTicked(draft, item));
}

/* ---------------------------------------------------------------------------------------------------------- changes */

export type ShareChange =
  /** The review of the active net-worth group, answered for every item (`confirmReview`), asked for by a tick here. */
  | { kind: 'review'; key: string; name: string; settings: Record<string, ShareSetting> }
  | { kind: 'setting'; key: string; name: string; accountId: string; setting: ShareSetting }
  | { kind: 'joint'; key: string; name: string; accountId: string; on: boolean }
  | { kind: 'share-goal'; key: string; name: string; goalId: string }
  | { kind: 'stop-goal'; key: string; name: string; goalId: string }
  | { kind: 'share-event'; key: string; name: string; eventId: string };

export const REVIEW_NAME = 'Accounts, cards, assets and debts';

/**
 * What the draft changes, in the order it is applied: net worth settings (or the review) first, Joint after them — an
 * account is made joint only once it is shared — then goals, then events, whose share is the slowest and ends in an
 * invite. A draft that touched no net worth tick and no Joint never answers a review.
 */
export function changesOf(list: ShareList, given: ShareDraft): ShareChange[] {
  const draft = reconcile(list, given);
  const out: ShareChange[] = [];
  const nwItems = itemsOf(list).filter(isNetWorth);
  const nw = list.netWorth;
  if (nw && nwItems.length > 0) {
    const touched = draft.ticks.get(ALL_NET_WORTH) === true || nwItems.some((item) => isTicked(draft, item) !== item.shared || (item.canJoint && jointOn(draft, item) !== item.joint));
    if (!nw.reviewed) {
      if (touched) {
        const settings: Record<string, ShareSetting> = {};
        for (const item of nwItems) settings[item.id] = nw.mode === 'joint' || isTicked(draft, item) ? 'total' : 'hidden';
        for (const item of nw.items) if (LEFT_OUT_SUBTYPES.includes(item.subtype)) settings[item.accountId] = nw.mode === 'joint' ? 'total' : (item.setting ?? 'hidden');
        out.push({ kind: 'review', key: 'review', name: REVIEW_NAME, settings });
      }
    } else {
      // Reviewed: each item on its own, as its own page does — one ticked shares that one alone, even with one tax ID.
      for (const item of nwItems) {
        const want = isTicked(draft, item);
        if (want !== item.shared) out.push({ kind: 'setting', key: `setting:${item.id}`, name: item.name, accountId: item.id, setting: want ? 'total' : 'hidden' });
      }
    }
    for (const item of nwItems) {
      // Unticked, the account is no longer shared, and not shared is not joint: the setting takes Joint with it.
      if (!item.canJoint || !isTicked(draft, item)) continue;
      const want = jointOn(draft, item);
      if (want !== item.joint) out.push({ kind: 'joint', key: `joint:${item.id}`, name: item.name, accountId: item.id, on: want });
    }
  }
  for (const item of list.groups.find((group) => group.key === 'goals')?.items ?? []) {
    const want = isTicked(draft, item);
    if (want && !item.shared) out.push({ kind: 'share-goal', key: `share-goal:${item.id}`, name: item.name, goalId: item.id });
    if (!want && item.shared) out.push({ kind: 'stop-goal', key: `stop-goal:${item.id}`, name: item.name, goalId: item.id });
  }
  for (const item of eventsToShare(list, draft)) out.push({ kind: 'share-event', key: `share-event:${item.id}`, name: item.name, eventId: item.id });
  return out;
}

/** Net worth as it stands at Save, read again: the proposal, the filing and whether this person reviewed it. */
export interface NetWorthNow {
  proposalId: string | null;
  mode: FilingMode | null;
  reviewed: boolean;
}

export const NET_WORTH_CHANGED = 'Net worth sharing changed. Look again before saving.';

/**
 * Whether the review a Save would answer is still the one on screen (fix round 2): the same proposal, the same filing,
 * still waiting for this person. Null when it is; the words to refuse with otherwise.
 */
export function reviewStillShown(shown: Pick<NetWorthInput, 'proposalId' | 'mode' | 'reviewed'>, now: NetWorthNow): string | null {
  return now.proposalId === shown.proposalId && now.mode === shown.mode && now.reviewed === shown.reviewed ? null : NET_WORTH_CHANGED;
}

/**
 * A review's settings made whole against the items as they are when it is sent (fix round 1, 4): an item that came
 * after the list was read was never shown, so it is sent as `hidden` rather than left to the review's own default.
 */
export function completeReviewSettings(settings: Readonly<Record<string, ShareSetting>>, currentIds: readonly string[]): Record<string, ShareSetting> {
  const out: Record<string, ShareSetting> = { ...settings };
  for (const id of currentIds) if (!(id in out)) out[id] = 'hidden';
  return out;
}

/** Each change through the share action its own page uses. A goal turned off asks first (its page's own question). */
export interface ShareRunners<Shared> {
  review(settings: Record<string, ShareSetting>): Promise<void>;
  setting(accountId: string, setting: ShareSetting): Promise<void>;
  joint(accountId: string, on: boolean): Promise<void>;
  shareGoal(goalId: string): Promise<void>;
  stopGoal(goalId: string): Promise<void>;
  /** Shares the event: its invite, to be sent to the others, and what stayed where it was. */
  shareEvent(eventId: string): Promise<Shared>;
}

export interface ShareOutcome<Shared> {
  /** How many changes went through. */
  done: number;
  /** Each change that did not, by item name, with why in words; `key` tells two of one name apart. */
  failed: { key: string; name: string; reason: string }[];
  /** The events just shared, with what their share brought back (the invite). */
  events: { eventId: string; name: string; shared: Shared }[];
}

/**
 * Runs every change, in order, each on its own: one that fails is reported and the rest still run, so nothing is left
 * half-said — the outcome names every item that did not go through and why.
 */
export async function applyShareChanges<Shared>(changes: readonly ShareChange[], runners: ShareRunners<Shared>, say: (error: unknown) => string): Promise<ShareOutcome<Shared>> {
  const outcome: ShareOutcome<Shared> = { done: 0, failed: [], events: [] };
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
          outcome.events.push({ eventId: change.eventId, name: change.name, shared: await runners.shareEvent(change.eventId) });
          break;
      }
      outcome.done += 1;
    } catch (error) {
      outcome.failed.push({ key: change.key, name: change.name, reason: say(error) });
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
  if (others.length === 0 || others.length > 3) return { who: `Everyone in ${bookName}`, one: true };
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
  /** The review notice while net worth waits for this person's review (§6 Review). */
  reviewTitle: 'Review items',
  reviewBody: (mode: FilingMode, others: readonly string[], bookName: string) => {
    if (mode === 'joint') return `${JOINT_LINE} ${jointTaxLine(others)} One tick shares every item, once saved.`;
    const { who, one } = whoSees(others, bookName);
    return `Net worth was set up again and waits for this review. What is ticked is what ${who} ${one ? 'sees' : 'see'}; unticking an item and saving takes it back.`;
  },
  tickAll: 'Tick all',
  joint: 'Joint',
  shareButton: (count: number) => `Share ${count} ${count === 1 ? 'item' : 'items'}`,
  later: 'Later',
  rowValue: (count: number) => (count === 0 ? 'None' : `${count} ${count === 1 ? 'item' : 'items'}`),
  workspaceFooter: (bookName: string) => `Budgets, bills, categories and ${bookName}’s transactions are shared with ${bookName} as a whole.`,
  netWorthOff: 'Accounts, cards, assets and debts are listed here once net worth is shared.',
  /** Under Events, once, while any event is ticked to be shared: the event Share sheet's own words. */
  eventsFooter: (names: readonly string[]) =>
    names.length === 1
      ? shareEventFooter(names[0]!)
      : `Everyone in each of ${namesOf(names)} sees every expense of it, who paid and how it is split. What is tagged to it moves out of its workspace: in each person's own books only their own share counts.`,
  failedHeader: 'Not shared',
  keptHeader: (eventName: string) => `Stayed where they were · ${eventName}`,
  invitesFooter: (others: readonly string[], bookName: string) => `Send each invite to ${whoSees(others, bookName).who}: an event is joined with its own code.`,
  noName: (eventName: string) => `${eventName} needs a name to share it under: set one on the member page first.`,
} as const;
