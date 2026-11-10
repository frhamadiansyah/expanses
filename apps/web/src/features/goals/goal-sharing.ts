import type { GoalLinkRow, GoalShareTarget, GoalShareView } from '@expanses/db';

/** "Rina", "Rina and Adi", "Rina, Adi and Sari". */
const listed = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Every string the shared-goal screens add, in one place so a test can hold them to the impersonal voice. */
export const GOAL_SHARING_COPY = {
  /**
   * The switch's consent line (spec §10, final review I6): what the others will see, by name. The names and counted
   * amounts of the accounts funding the goal do travel (D2, D9), so the line never says they stay private.
   */
  switchInfo: (others: readonly string[], bookName: string) =>
    others.length >= 4 || others.length === 0
      ? `Everyone in ${bookName} sees this goal, its payments, and the names and amounts of the accounts funding it; so does anyone who joins later.`
      : `${listed(others)} ${others.length === 1 ? 'sees' : 'see'} this goal, its payments, and the names and amounts of the accounts funding it; so does anyone who joins ${bookName} later.`,
  /** The picker's line before a workspace is picked. */
  pickerInfo: 'The members of the workspace picked see this goal, its payments, and the names and amounts of the accounts funding it; so does anyone who joins it later.',
  /**
   * Turning sharing off (final review M1): a copy is promised only to a member whose money is in the goal (one with
   * nothing of their own gets none, the Task 10 ruling); every other member is told they stop seeing it.
   */
  stopConfirm: (goalName: string, others: readonly string[], withMoney: readonly string[]) => {
    const rest = others.filter((name) => !withMoney.includes(name));
    const parts = [`Stop sharing ${goalName}?`];
    if (rest.length > 0) parts.push(`${listed(rest)} will no longer see it.`);
    if (withMoney.length === 1) parts.push(`${withMoney[0]} keeps a copy with the money set aside from ${withMoney[0]}'s phone.`);
    else if (withMoney.length > 1) parts.push(`${listed(withMoney)} each keep a copy with the money set aside from their phones.`);
    return parts.join(' ');
  },
  leaveConfirm: (goalName: string) => `Leave ${goalName}? A copy with the money set aside from this phone stays here.`,
  leaveRow: 'Leave goal',
  sharedBy: (name: string) => `Shared by ${name}`,
  pickerLabel: 'Share with',
  pickerNone: 'Not shared',
  partnerAccount: (name: string) => `${name}'s account`,
  /** A line of this member's own that another of their devices sent (§11): counted under Me, opened on that device. */
  syncedOwn: 'Set aside on another device',
  noLongerShared: 'No longer shared',
  openCopy: 'Open the copy',
  setAsideRow: '＋ Set aside',
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

/**
 * This member's lines first as Me — this phone's own, and on a second device the member's own synced lines (`owner` is
 * `me`, spec §11, final review I3) — then each other member who has any, in the order given.
 */
export function fundingGroups(links: readonly GoalLinkRow[], members: readonly { memberId: string; name: string }[], me?: string): FundingGroup[] {
  const sum = (rows: GoalLinkRow[]) => rows.reduce((total, link) => total + (link.goalMinor ?? 0), 0);
  const own = links.filter((link) => link.owner === undefined || link.owner === me);
  const groups: FundingGroup[] = own.length > 0 ? [{ memberId: null, label: 'Me', subtotalMinor: sum(own), links: own }] : [];
  for (const member of members) {
    const theirs = links.filter((link) => link.owner === member.memberId);
    if (theirs.length > 0) groups.push({ memberId: member.memberId, label: member.name, subtotalMinor: sum(theirs), links: theirs });
  }
  return groups;
}

/** The caption under a Funded-by row: a partner's account is theirs; this member's from another device says so. */
export function fundingCaption(link: GoalLinkRow, groupLabel: string, me?: string): string | undefined {
  if (link.owner === undefined) return undefined;
  return link.owner === me ? GOAL_SHARING_COPY.syncedOwn : GOAL_SHARING_COPY.partnerAccount(groupLabel);
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
  | { kind: 'switch'; label: string; bookId: string; info: string }
  | { kind: 'picker'; options: { bookId: string; label: string; info: string }[] }
  | { kind: 'locked'; label: string; footer: string };

/**
 * What the Add/Edit goal share row is. The sharer's own goal shared now keeps its switch whatever the targets say —
 * eligibility gates turning sharing on, never off (final review I2); off, it stays with its book; a goal shared by
 * someone else is read-only here; anything else is offered the workspaces it can go to (D1, C26).
 */
export function shareRowState(targets: readonly GoalShareTarget[], share: GoalShareView | null): ShareRowState {
  if (share && !share.isSharer) {
    if (share.state !== 'on') return { kind: 'hidden' };
    const others = share.members.filter((member) => member.memberId !== share.me);
    return { kind: 'locked', label: sharedWithLabel(others, share.bookName), footer: GOAL_SHARING_COPY.sharedBy(share.sharedByName) };
  }
  const infoOf = (others: readonly { name: string }[], bookName: string) => GOAL_SHARING_COPY.switchInfo(others.map((other) => other.name), bookName);
  if (share && share.state === 'on') {
    const others = share.members.filter((member) => member.memberId !== share.me);
    return { kind: 'switch', label: sharedWithLabel(others, share.bookName), bookId: share.bookId, info: infoOf(others, share.bookName) };
  }
  const usable = share ? targets.filter((target) => target.bookId === share.bookId) : targets;
  if (usable.length === 0) return { kind: 'hidden' };
  if (usable.length === 1) return { kind: 'switch', label: sharedWithLabel(usable[0]!.others, usable[0]!.bookName), bookId: usable[0]!.bookId, info: infoOf(usable[0]!.others, usable[0]!.bookName) };
  return {
    kind: 'picker',
    options: usable.map((target) => ({ bookId: target.bookId, label: `${target.bookName} · ${target.others.map((other) => other.name).join(', ')}`, info: infoOf(target.others, target.bookName) })),
  };
}
