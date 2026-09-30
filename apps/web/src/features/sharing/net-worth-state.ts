import { NetWorthError, type NetWorthGroupView, type SharedBookMember } from '@expanses/db';

/*
 * The "Share net worth" row of a shared workspace (joint-net-worth spec §6, §8.1), as a state the screen draws: no group
 * yet, waiting for others, asked to confirm, or active — and a change of mode may be waiting while a group is active.
 * Pure, so the whole state machine is tested without a screen.
 */

export type FilingMode = 'joint' | 'separate';

export const MODE_LABEL: Record<FilingMode, string> = { joint: 'One tax ID', separate: 'Separate' };

/** What the setup asks, and each answer's words. */
export const FILING_QUESTION = 'How does your household file tax?';
export const FILING_CHOICES: Record<FilingMode, string> = {
  joint: 'One tax ID for both of us',
  separate: 'Each of us has our own tax ID',
};

/** The line under a joint review and a joint item's setting (§8.1). */
export const JOINT_LINE = 'Your household files with one tax ID, so every item is in the joint report.';

export type PendingRow =
  /** This member proposed (or already confirmed) and waits for the others; the proposer may cancel. */
  | { kind: 'waiting'; proposalId: string; line: string; cancellable: boolean }
  /** This member is asked: "Rina set up household net worth: one tax ID." */
  | { kind: 'asked'; proposalId: string; line: string; mode: FilingMode };

export interface NetWorthRow {
  /** The row is drawn at all: the workspace is shared with at least one other member. */
  show: boolean;
  /** The group now: "Net worth shared · One tax ID". */
  active: { mode: FilingMode; line: string; members: string[] } | null;
  pending: PendingRow | null;
}

/** "Andi", "Andi and Sari", "Andi, Sari and Budi". */
export function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function modeWords(mode: FilingMode): string {
  return mode === 'joint' ? 'one tax ID' : 'separate tax IDs';
}

export function netWorthRowOf(group: NetWorthGroupView | null | undefined, members: readonly SharedBookMember[]): NetWorthRow {
  const show = members.length >= 2;
  const nameOf = (id: string) => members.find((m) => m.memberId === id)?.name ?? 'Someone';
  if (!group) return { show, active: null, pending: null };
  const active = group.active ? { mode: group.active.mode, line: `Net worth shared · ${MODE_LABEL[group.active.mode]}`, members: group.active.members.map(nameOf) } : null;
  const p = group.pending;
  let pending: PendingRow | null = null;
  if (p) {
    const listed = p.members.includes(group.me);
    if (group.waitingFor.includes(group.me)) {
      // A change that leaves a current member out asks them too (D6, task 5 review round 2).
      const line = listed
        ? `${nameOf(p.proposedBy)} set up household net worth: ${modeWords(p.mode)}.`
        : `${nameOf(p.proposedBy)} proposes a group without you: ${modeWords(p.mode)}.`;
      pending = { kind: 'asked', proposalId: p.proposalId, mode: p.mode, line };
    } else if (listed || group.active?.members.includes(group.me)) {
      pending = { kind: 'waiting', proposalId: p.proposalId, line: `Waiting for ${namesOf(group.waitingFor.map(nameOf))}`, cancellable: p.proposedBy === group.me };
    }
  }
  return { show, active, pending };
}

/** "Update the app on Andi's iPad": each device too old to take part (§9). */
export function notReadyLine(outdated: readonly { deviceName: string }[]): string {
  return `Update the app on ${namesOf(outdated.map((d) => d.deviceName || 'their device'))}`;
}

/** The screen's words for what setup, confirm, cancel or leave refused. */
export function sayNetWorthError(error: unknown): unknown {
  if (error instanceof NetWorthError) {
    if (error.code === 'not-ready') return new Error(notReadyLine(error.outdated));
    if (error.code === 'adds-members') return new Error(ADD_SOMEONE_LINE);
    return new Error(error.message);
  }
  return error;
}

/** Who the setup may invite, and who it has chosen: `joint` is exactly one other, `separate` one or more. */
export function toggleInvitee(chosen: readonly string[], memberId: string, mode: FilingMode): string[] {
  if (chosen.includes(memberId)) return chosen.filter((id) => id !== memberId);
  return mode === 'joint' ? [memberId] : [...chosen, memberId];
}

export function canInvite(chosen: readonly string[], mode: FilingMode | null): boolean {
  if (!mode) return false;
  return mode === 'joint' ? chosen.length === 1 : chosen.length >= 1;
}

/**
 * The joint review's line on what the tax report takes along (task 10 review round 1): with one tax ID each shared item
 * carries its row of the owner's tax report to the partner, details and all, because the joint return needs them.
 */
export function jointTaxLine(others: readonly string[]): string {
  return `For the joint tax return, each item also goes to ${namesOf(others) || 'the others'} with its row of your tax report: its code, its figures and the details its table asks for, such as an account number.`;
}

/** The D8 prompt after a switch to one tax ID: "Household now files with one tax ID. Share Business Mandiri with Andi?" */
export function pendingPrompt(itemNames: readonly string[], others: readonly string[]): string {
  return `Household now files with one tax ID. Share ${namesOf(itemNames)} with ${namesOf(others)}?`;
}

/**
 * An item page's Share with Household row (§8.1, review round 1 finding 3): the stored setting as it is, never a
 * default in its place. One tax ID with the item still hidden (D8) is "Not yet shared", with Share; an item never
 * reviewed is "Not reviewed", with the settings to choose from.
 */
export type ShareRowState =
  | { kind: 'choose'; value: 'total' | 'hidden' | null; label: string; hiddenAllowed: boolean }
  | { kind: 'not-yet-shared'; label: string };

export function shareRowOf(mode: FilingMode, setting: 'total' | 'hidden' | null): ShareRowState {
  if (mode === 'joint' && setting === 'hidden') return { kind: 'not-yet-shared', label: 'Not yet shared' };
  const label = setting === null ? 'Not reviewed' : setting === 'total' ? 'Balance and one total' : "Don't share";
  return { kind: 'choose', value: setting, label, hiddenAllowed: mode === 'separate' };
}

/**
 * What an add form writes for the item it just opened (D9): with one tax ID every item is shared (`total`), whatever the
 * switch; separately the switch decides; in no active group nothing is written.
 */
export function settingOnAdd(mode: FilingMode | null, share: boolean): 'total' | 'hidden' | null {
  if (mode === null) return null;
  return mode === 'joint' || share ? 'total' : 'hidden';
}

/**
 * Whether the review is shown under an active group this person is in (§6 Review, §8.1, D8): until Share was pressed for
 * this group (settings left from an earlier group are not a review of this one), while any item has no setting, or
 * while the household files jointly and an item is still hidden.
 */
export function needsReview(input: { mode: FilingMode; reviewed: boolean; unreviewedItems: number; pendingHidden: number }): boolean {
  return !input.reviewed || input.unreviewedItems > 0 || (input.mode === 'joint' && input.pendingHidden > 0);
}

/** A Change never adds anyone (wave 3 round 2): the group log's history would reach them. */
export const ADD_SOMEONE_LINE = 'To add someone, stop sharing net worth and set it up again.';

/**
 * Who the setup may pick: everyone else in the workspace for a first setup; only the active group's other members for a
 * Change (`activeMembers` given), since a Change can never add anyone.
 */
export function inviteesFor<T extends { memberId: string }>(others: readonly T[], activeMembers: readonly string[] | null): T[] {
  return activeMembers === null ? [...others] : others.filter((member) => activeMembers.includes(member.memberId));
}
