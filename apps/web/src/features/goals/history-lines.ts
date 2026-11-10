import type { GoalHistoryEntry } from '@expanses/db';
import { historyDay } from './goal-cards';

const TITLES: Record<GoalHistoryEntry['kind'], string> = {
  'set-aside': 'Set aside',
  'taken-back': 'Taken back',
  borrowed: 'Borrowed',
  spent: 'Spent',
  moved: 'Moved',
  reached: 'Reached the target',
  shared: 'Shared',
  stopped: 'Stopped sharing',
  left: 'Left',
  unshared: 'No longer shared',
  ended: 'Sharing ended',
};

/** The share's own lines name the person (Rina left); a record line is titled by what happened to the money. */
export function historyTitle(entry: GoalHistoryEntry): string {
  const name = entry.memberName;
  if (!name) return TITLES[entry.kind];
  switch (entry.kind) {
    case 'shared':
      return `Shared with ${name}`;
    case 'stopped':
      return `Stopped sharing with ${name}`;
    case 'left':
      return `${name} left`;
    case 'unshared':
      return `No longer shared by ${name}`;
    case 'ended':
      return `Sharing with ${name} ended`;
    default:
      return TITLES[entry.kind];
  }
}

const SHARE_KINDS: ReadonlySet<GoalHistoryEntry['kind']> = new Set(['shared', 'stopped', 'left', 'unshared', 'ended']);

/**
 * Day, the account text, and on a shared goal the person who moved the money: "Me" for this phone's own and for this
 * member's own from another of their devices (`me`, final review M13), the member's name for anyone else's.
 */
export function historySubtitle(entry: GoalHistoryEntry, today: string, nameOf: (memberId: string) => string, shared: boolean, me?: string): string {
  const parts = [historyDay(entry.occurredOn, today)];
  if (entry.text) parts.push(entry.text);
  if (shared && !SHARE_KINDS.has(entry.kind)) parts.push(entry.by === null || entry.by === me ? 'Me' : nameOf(entry.by));
  return parts.join(' · ');
}

/** Whether a goal's History names who moved the money: only while it is shared (M5); off, it is a private goal again. */
export function historyNamesPeople(share: { state: string } | null): boolean {
  return share?.state === 'on';
}
