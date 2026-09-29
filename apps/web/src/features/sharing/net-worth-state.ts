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
    if (group.waitingFor.includes(group.me)) {
      pending = { kind: 'asked', proposalId: p.proposalId, mode: p.mode, line: `${nameOf(p.proposedBy)} set up household net worth: ${modeWords(p.mode)}.` };
    } else if (p.members.includes(group.me)) {
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
