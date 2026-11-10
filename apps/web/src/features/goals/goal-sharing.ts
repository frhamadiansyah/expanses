import type { GoalLinkRow, GoalShareTarget, GoalShareView } from '@expanses/db';

/** Every string the shared-goal screens add, in one place so a test can hold them to the impersonal voice. */
export const GOAL_SHARING_COPY = {
  switchInfo: 'Everyone in the workspace sees this goal, its payments and the progress each has made. Accounts and balances stay private.',
  stopConfirm: (goalName: string, others: readonly string[]) =>
    others.length === 1
      ? `Stop sharing ${goalName}? ${others[0]} keeps a copy with ${others[0]}'s own money in it.`
      : `Stop sharing ${goalName}? ${others.slice(0, -1).join(', ')} and ${others[others.length - 1]} each keep a copy with their own money in it.`,
  leaveConfirm: (goalName: string) => `Leave ${goalName}? A copy with the money set aside from this phone stays here.`,
  leaveRow: 'Leave goal',
  sharedBy: (name: string) => `Shared by ${name}`,
  pickerLabel: 'Share with',
  pickerNone: 'Not shared',
} as const;

/** Spec C31: who sees the goal, by name up to three, then the workspace and a head count. */
export function sharedWithLabel(others: readonly { name: string }[], bookName: string): string {
  const names = others.map((other) => other.name);
  if (names.length >= 4) return `Shared with ${bookName} · ${names.length + 1} people`;
  if (names.length <= 1) return `Shared with ${names[0] ?? bookName}`;
  return `Shared with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join('');
}

/** At most three initials, then how many more. */
export function initialsLine(names: readonly string[]): string[] {
  const shown = names.slice(0, 3).map(initialsOf);
  return names.length > 3 ? [...shown, `+${names.length - 3}`] : shown;
}

export interface FundingGroup {
  memberId: string | null;
  label: string;
  subtotalMinor: number;
  links: GoalLinkRow[];
}

/** This phone's lines first as Me, then each member who has any, in the order given. */
export function fundingGroups(links: readonly GoalLinkRow[], members: readonly { memberId: string; name: string }[]): FundingGroup[] {
  const sum = (rows: GoalLinkRow[]) => rows.reduce((total, link) => total + (link.goalMinor ?? 0), 0);
  const own = links.filter((link) => link.owner === undefined);
  const groups: FundingGroup[] = own.length > 0 ? [{ memberId: null, label: 'Me', subtotalMinor: sum(own), links: own }] : [];
  for (const member of members) {
    const theirs = links.filter((link) => link.owner === member.memberId);
    if (theirs.length > 0) groups.push({ memberId: member.memberId, label: member.name, subtotalMinor: sum(theirs), links: theirs });
  }
  return groups;
}

export interface HeroSegment {
  key: string;
  label: string;
  minor: number;
}

/** The hero bar: Paid, each person's share, then what is left. */
export function heroSegments(paidMinor: number, groups: readonly FundingGroup[], targetMinor: number): HeroSegment[] {
  const out: HeroSegment[] = [];
  if (paidMinor > 0) out.push({ key: 'paid', label: 'Paid', minor: paidMinor });
  for (const group of groups) out.push({ key: group.memberId ?? 'me', label: group.label, minor: group.subtotalMinor });
  const toGo = targetMinor - out.reduce((total, segment) => total + segment.minor, 0);
  if (toGo > 0) out.push({ key: 'to-go', label: 'To go', minor: toGo });
  return out;
}

export type ShareRowState =
  | { kind: 'hidden' }
  | { kind: 'switch'; label: string; bookId: string }
  | { kind: 'picker'; options: { bookId: string; label: string }[] }
  | { kind: 'locked'; label: string; footer: string };

/**
 * What the Add/Edit goal share row is. The sharer's own goal, on or off, stays with its book; a goal shared by
 * someone else is read-only here; anything else is offered the workspaces it can go to (D1, C26).
 */
export function shareRowState(targets: readonly GoalShareTarget[], share: GoalShareView | null): ShareRowState {
  if (share && !share.isSharer) {
    if (share.state !== 'on') return { kind: 'hidden' };
    const others = share.members.filter((member) => member.memberId !== share.me);
    return { kind: 'locked', label: sharedWithLabel(others, share.bookName), footer: GOAL_SHARING_COPY.sharedBy(share.sharedByName) };
  }
  const usable = share ? targets.filter((target) => target.bookId === share.bookId) : targets;
  if (usable.length === 0) return { kind: 'hidden' };
  if (usable.length === 1) return { kind: 'switch', label: sharedWithLabel(usable[0]!.others, usable[0]!.bookName), bookId: usable[0]!.bookId };
  return { kind: 'picker', options: usable.map((target) => ({ bookId: target.bookId, label: `${target.bookName} · ${target.others.map((other) => other.name).join(', ')}` })) };
}
