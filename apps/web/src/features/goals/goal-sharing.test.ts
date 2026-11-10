import type { GoalLinkRow, GoalShareTarget, GoalShareView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { fundingGroups, GOAL_SHARING_COPY, heroSegments, initialsLine, initialsOf, shareRowState, sharedWithLabel } from './goal-sharing';

const link = (goalMinor: number | null, owner?: string) => ({ goalId: 'g1', goalMinor, ...(owner ? { owner } : {}) }) as unknown as GoalLinkRow;
const target = (bookId: string, bookName: string, others: string[]): GoalShareTarget => ({
  bookId,
  bookName,
  me: 'member-b',
  others: others.map((name) => ({ memberId: `member-${name}`, name })),
});
const viewSharedBy = (name: string, over: Partial<GoalShareView>): GoalShareView => ({
  goalId: 'g1',
  bookId: 'b1',
  bookName: 'Family',
  sharedBy: 'member-s',
  sharedByName: name,
  state: 'on',
  round: 1,
  me: 'member-b',
  isSharer: true,
  members: [
    { memberId: 'member-s', name },
    { memberId: 'member-b', name: 'Rina' },
  ],
  left: [],
  ...over,
});

describe('shared goals model', () => {
  it('names who sees it', () => {
    expect(sharedWithLabel([{ name: 'Rina' }], 'Family')).toBe('Shared with Rina');
    expect(sharedWithLabel([{ name: 'Rina' }, { name: 'Adi' }], 'Family')).toBe('Shared with Rina and Adi');
    expect(sharedWithLabel([{ name: 'Rina' }, { name: 'Adi' }, { name: 'Sari' }], 'Family')).toBe('Shared with Rina, Adi and Sari');
    expect(sharedWithLabel([{ name: 'Rina' }, { name: 'Adi' }, { name: 'Sari' }, { name: 'Tono' }], 'Family')).toBe('Shared with Family · 5 people');
  });
  it('initials', () => {
    expect(initialsOf('Rina')).toBe('R');
    expect(initialsOf('Adi Putra')).toBe('AP');
    expect(initialsLine(['Fajar', 'Rina', 'Adi', 'Sari', 'Tono'])).toEqual(['F', 'R', 'A', '+2']);
    expect(initialsLine(['Rina', 'Adi'])).toEqual(['R', 'A']);
  });
  it("the mock-up's groups and bar", () => {
    const mockLinks = [link(20_000_000), link(8_000_000), link(10_000_000, 'member-r'), link(4_000_000, 'member-r')];
    const groups = fundingGroups(mockLinks, [
      { memberId: 'member-r', name: 'Rina' },
      { memberId: 'member-a', name: 'Adi' },
    ]);
    expect(groups.map((g) => [g.memberId, g.label, g.subtotalMinor, g.links.length])).toEqual([
      [null, 'Me', 28_000_000, 2],
      ['member-r', 'Rina', 14_000_000, 2],
    ]);
    expect(heroSegments(0, groups, 180_000_000)).toEqual([
      { key: 'me', label: 'Me', minor: 28_000_000 },
      { key: 'member-r', label: 'Rina', minor: 14_000_000 },
      { key: 'to-go', label: 'To go', minor: 138_000_000 },
    ]);
    expect(heroSegments(30_000_000, groups, 60_000_000).map((s) => s.key)).toEqual(['paid', 'me', 'member-r']);
  });
  it('an unconverted line counts nothing', () => {
    expect(fundingGroups([link(null), link(5)], [])[0]!.subtotalMinor).toBe(5);
  });
  it('the row', () => {
    expect(shareRowState([], null)).toEqual({ kind: 'hidden' });
    expect(shareRowState([target('b1', 'Family', ['Rina'])], null)).toEqual({ kind: 'switch', label: 'Shared with Rina', bookId: 'b1' });
    expect(shareRowState([target('b1', 'Family', ['Rina']), target('b2', 'Business', ['Adi'])], null)).toMatchObject({
      kind: 'picker',
      options: [
        { bookId: 'b1', label: 'Family · Rina' },
        { bookId: 'b2', label: 'Business · Adi' },
      ],
    });
    expect(shareRowState([], viewSharedBy('Bima', { isSharer: false }))).toEqual({ kind: 'locked', label: 'Shared with Bima', footer: 'Shared by Bima' });
  });
  it('the sharer stays with the book it shared in', () => {
    const both = [target('b1', 'Family', ['Rina']), target('b2', 'Business', ['Adi'])];
    expect(shareRowState(both, viewSharedBy('Bima', { state: 'off' }))).toMatchObject({ kind: 'switch', bookId: 'b1' });
  });
  it('no new string speaks to the reader', () => {
    const texts = Object.values(GOAL_SHARING_COPY).map((v) => (typeof v === 'function' ? (v as (...a: unknown[]) => string)('Trip Fund', ['Rina', 'Adi']) : v));
    for (const text of texts) expect(text).not.toMatch(/\byou(r)?\b/i);
  });
  it('the confirms', () => {
    expect(GOAL_SHARING_COPY.stopConfirm('Trip Fund', ['Rina', 'Adi'])).toBe('Stop sharing Trip Fund? Rina and Adi each keep a copy with their own money in it.');
    expect(GOAL_SHARING_COPY.stopConfirm('Trip Fund', ['Rina'])).toBe("Stop sharing Trip Fund? Rina keeps a copy with Rina's own money in it.");
    expect(GOAL_SHARING_COPY.leaveConfirm('Trip Fund')).toBe('Leave Trip Fund? A copy with the money set aside from this phone stays here.');
  });
});
