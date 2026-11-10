import type { GoalHistoryEntry } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { historyNamesPeople, historySubtitle, historyTitle } from './history-lines';

const entry = (over: Partial<GoalHistoryEntry>): GoalHistoryEntry => ({
  key: 'k', kind: 'set-aside', by: null, occurredOn: '2026-11-02', amountMinor: 100, currency: 'IDR', text: '', ...over,
});

describe('history lines', () => {
  it("titles the share's own lines", () => {
    expect(historyTitle(entry({ kind: 'left', memberName: 'Rina' }))).toBe('Rina left');
    expect(historyTitle(entry({ kind: 'stopped', memberName: 'Rina' }))).toBe('Stopped sharing with Rina');
    expect(historyTitle(entry({ kind: 'unshared', memberName: 'Bima' }))).toBe('No longer shared by Bima');
    expect(historyTitle(entry({ kind: 'shared', memberName: 'Rina' }))).toBe('Shared with Rina');
    expect(historyTitle(entry({ kind: 'ended', memberName: 'Rina' }))).toBe('Sharing with Rina ended');
    expect(historyTitle(entry({ kind: 'ended' }))).toBe('Sharing ended');
    expect(historyTitle(entry({ kind: 'set-aside' }))).toBe('Set aside');
  });
  it('keeps every title impersonal', () => {
    const kinds: GoalHistoryEntry['kind'][] = ['set-aside', 'taken-back', 'borrowed', 'spent', 'moved', 'reached', 'shared', 'stopped', 'left', 'unshared', 'ended'];
    for (const kind of kinds) expect(historyTitle(entry({ kind }))).not.toMatch(/\byou(r)?\b/i);
  });
  it('ends each line of a shared goal with its person', () => {
    expect(historySubtitle(entry({ by: 'member-r', occurredOn: '2026-11-03', text: 'Partner Savings' }), '2026-11-10', () => 'Rina', true)).toBe('3 Nov · Partner Savings · Rina');
    expect(historySubtitle(entry({ text: 'Main Savings' }), '2026-11-10', () => 'Rina', true)).toBe('2 Nov · Main Savings · Me');
    expect(historySubtitle(entry({ text: 'Main Savings' }), '2026-11-10', () => 'Rina', false)).toBe('2 Nov · Main Savings');
    expect(historySubtitle(entry({ kind: 'left', memberName: 'Rina', text: '' }), '2026-11-10', () => 'Rina', true)).toBe('2 Nov');
  });
  // Final review M13: a member's own move from another of their devices is theirs: "Me", as on that device.
  it("names this member's own synced move Me", () => {
    expect(historySubtitle(entry({ by: 'member-b', text: 'Main Savings' }), '2026-11-10', () => 'Bima', true, 'member-b')).toBe('2 Nov · Main Savings · Me');
  });
  // Final review M5: a goal whose sharing is off is a private goal again: no person on its lines.
  it('names people only while the goal is shared', () => {
    expect(historyNamesPeople(null)).toBe(false);
    expect(historyNamesPeople({ state: 'off' })).toBe(false);
    expect(historyNamesPeople({ state: 'deleted' })).toBe(false);
    expect(historyNamesPeople({ state: 'on' })).toBe(true);
  });
});
