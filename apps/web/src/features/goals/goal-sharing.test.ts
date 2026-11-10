import type { GoalLinkRow, GoalShareTarget, GoalShareView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { fundingCaption, fundingGroups, GOAL_SHARING_COPY, heroSegments, initialsLine, initialsOf, shareRowState, sharedWithLabel } from './goal-sharing';

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
    expect(shareRowState([target('b1', 'Family', ['Rina'])], null)).toMatchObject({ kind: 'switch', label: 'Shared with Rina', bookId: 'b1' });
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
    const texts = [
      ...Object.values(GOAL_SHARING_COPY).map((v) => (typeof v === 'function' ? (v as (...a: unknown[]) => string)('Trip Fund', ['Rina', 'Adi'], ['Rina']) : v)),
      GOAL_SHARING_COPY.switchInfo(['Rina'], 'Family'),
      GOAL_SHARING_COPY.switchInfo(['Rina', 'Adi', 'Sari', 'Tono'], 'Family'),
      GOAL_SHARING_COPY.stopConfirm('Trip Fund', ['Rina'], []),
    ];
    for (const text of texts) expect(text).not.toMatch(/\byou(r)?\b/i);
  });
  it('the confirms', () => {
    expect(GOAL_SHARING_COPY.leaveConfirm('Trip Fund')).toBe('Leave Trip Fund? A copy with the money set aside from this phone stays here.');
  });
  // Final review M1: a copy is promised only to a member with money in the goal; the others are told they stop seeing it.
  it('the stop confirm promises a copy only where there is money', () => {
    expect(GOAL_SHARING_COPY.stopConfirm('Trip Fund', ['Rina'], ['Rina'])).toBe("Stop sharing Trip Fund? Rina keeps a copy with the money set aside from Rina's phone.");
    expect(GOAL_SHARING_COPY.stopConfirm('Trip Fund', ['Rina', 'Adi'], ['Rina', 'Adi'])).toBe('Stop sharing Trip Fund? Rina and Adi each keep a copy with the money set aside from their phones.');
    expect(GOAL_SHARING_COPY.stopConfirm('Trip Fund', ['Rina'], [])).toBe('Stop sharing Trip Fund? Rina will no longer see it.');
    expect(GOAL_SHARING_COPY.stopConfirm('Trip Fund', ['Rina', 'Adi', 'Sari'], ['Adi'])).toBe(
      "Stop sharing Trip Fund? Rina and Sari will no longer see it. Adi keeps a copy with the money set aside from Adi's phone.",
    );
  });
  // Final review I6: the consent line says what the others see, with names: never that balances or accounts stay private.
  it('the switch says what the others will see', () => {
    expect(GOAL_SHARING_COPY.switchInfo(['Rina'], 'Family')).toBe(
      'Rina sees this goal, its payments, and the names and amounts of the accounts funding it; so does anyone who joins Family later.',
    );
    expect(GOAL_SHARING_COPY.switchInfo(['Rina', 'Adi'], 'Family')).toBe(
      'Rina and Adi see this goal, its payments, and the names and amounts of the accounts funding it; so does anyone who joins Family later.',
    );
    expect(GOAL_SHARING_COPY.switchInfo(['Rina', 'Adi', 'Sari', 'Tono'], 'Family')).toBe(
      'Everyone in Family sees this goal, its payments, and the names and amounts of the accounts funding it; so does anyone who joins later.',
    );
    expect(GOAL_SHARING_COPY.switchInfo(['Rina'], 'Family')).not.toMatch(/private/i);
    expect(shareRowState([target('b1', 'Family', ['Rina'])], null)).toMatchObject({ kind: 'switch', info: GOAL_SHARING_COPY.switchInfo(['Rina'], 'Family') });
  });
  // Final review I2: eligibility gates turning sharing on, never the sharer's way to turn it off.
  it('the sharer keeps the switch of a goal shared now, whatever the targets say', () => {
    const on = viewSharedBy('Bima', { sharedBy: 'member-b', me: 'member-b', members: [{ memberId: 'member-b', name: 'Bima' }, { memberId: 'member-r', name: 'Rina' }] });
    expect(shareRowState([], on)).toEqual({ kind: 'switch', label: 'Shared with Rina', bookId: 'b1', info: GOAL_SHARING_COPY.switchInfo(['Rina'], 'Family') });
    // Off, it is offered again only where it can go.
    expect(shareRowState([], { ...on, state: 'off' })).toEqual({ kind: 'hidden' });
  });
  // Final review I3: on a member's second device, their own synced lines (owner = this member) are Me.
  it("a member's own synced lines are in Me, and To go matches the other phones", () => {
    const links = [link(20_000_000, 'member-b'), link(8_000_000, 'member-b'), link(10_000_000, 'member-r'), link(4_000_000, 'member-r')];
    const groups = fundingGroups(links, [{ memberId: 'member-r', name: 'Rina' }], 'member-b');
    expect(groups.map((g) => [g.memberId, g.label, g.subtotalMinor, g.links.length])).toEqual([
      [null, 'Me', 28_000_000, 2],
      ['member-r', 'Rina', 14_000_000, 2],
    ]);
    expect(heroSegments(0, groups, 180_000_000).find((s) => s.key === 'to-go')!.minor).toBe(138_000_000);
    expect(fundingCaption(links[0]!, 'Me', 'member-b')).toBe(GOAL_SHARING_COPY.syncedOwn);
    expect(fundingCaption(links[2]!, 'Rina', 'member-b')).toBe("Rina's account");
    expect(fundingCaption(link(1), 'Me', 'member-b')).toBeUndefined();
  });
});
