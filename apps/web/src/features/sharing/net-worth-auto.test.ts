import type { NetWorthGroupView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { autoConfirmOf, autoReviewSettings, othersStopped } from './net-worth-auto';

/*
 * What the app does by itself for the household's net worth (review round 1): nothing is ever shared without a tap on
 * that person's own phone, and an existing household looks the same after updating. Names and ids invented.
 */

const RINA = 'm-rina';
const ANDI = 'm-andi';
const NONE = { intent: [], optedOut: false, seen: false };

function view(over: Partial<NetWorthGroupView> = {}): NetWorthGroupView {
  return { groupBookId: 'g-1', me: ANDI, active: null, pending: null, waitingFor: [], ...over };
}

const proposal = (over: Partial<NonNullable<NetWorthGroupView['pending']>> = {}) => ({
  proposalId: 'p-1',
  mode: 'separate' as const,
  members: [RINA, ANDI],
  proposedBy: RINA,
  createdHlc: '0001',
  cancelled: false,
  ...over,
});

describe('the partner’s phone confirms only the first group, filed separately', () => {
  it('confirms a first proposal, filed separately, that lists this member and waits for them', () => {
    expect(autoConfirmOf(view({ pending: proposal(), waitingFor: [ANDI] }), null, NONE)).toBe('p-1');
  });

  it('never a change of an active group: a new filing, or leaving one tax ID, waits for a tap', () => {
    const active = { proposalId: 'p-0', mode: 'joint' as const, members: [RINA, ANDI] };
    expect(autoConfirmOf(view({ active, pending: proposal({ proposalId: 'p-2' }), waitingFor: [ANDI] }), null, NONE)).toBeNull();
    const separate = { proposalId: 'p-0', mode: 'separate' as const, members: [RINA, ANDI] };
    expect(autoConfirmOf(view({ active: separate, pending: proposal({ proposalId: 'p-2', mode: 'joint' }), waitingFor: [ANDI] }), null, NONE)).toBeNull();
  });

  it('never one tax ID, never after this person stopped or declined, never another workspace’s', () => {
    expect(autoConfirmOf(view({ pending: proposal({ mode: 'joint' }), waitingFor: [ANDI] }), null, NONE)).toBeNull();
    expect(autoConfirmOf(view({ pending: proposal(), waitingFor: [ANDI] }), null, { ...NONE, optedOut: true })).toBeNull();
    expect(autoConfirmOf(view({ pending: proposal(), waitingFor: [ANDI] }), 'book-office', NONE)).toBeNull();
  });

  it('nothing when not asked, left out, cancelled, or no group at all', () => {
    expect(autoConfirmOf(view({ pending: proposal(), waitingFor: [RINA] }), null, NONE)).toBeNull();
    expect(autoConfirmOf(view({ pending: proposal({ members: [RINA, 'm-sari'] }), waitingFor: [ANDI] }), null, NONE)).toBeNull();
    expect(autoConfirmOf(view({ pending: proposal({ cancelled: true }), waitingFor: [ANDI] }), null, NONE)).toBeNull();
    expect(autoConfirmOf(null, null, NONE)).toBeNull();
  });
});

describe('the review the app answers: exactly what this person switched on, nothing else', () => {
  const items = [
    { accountId: 'a-bca', setting: 'total' as const },
    { accountId: 'a-gopay', setting: 'hidden' as const },
    { accountId: 'a-card', setting: null },
    { accountId: 'a-old', setting: 'total' as const },
  ];

  it('what was switched on is shared; a setting an earlier group left is not', () => {
    expect(autoReviewSettings(items, ['a-bca', 'a-card'])).toEqual({ 'a-bca': 'total', 'a-gopay': 'hidden', 'a-card': 'total', 'a-old': 'hidden' });
  });

  it('nothing switched on here: no answer at all (a legacy review stays for the person)', () => {
    expect(autoReviewSettings(items, [])).toBeNull();
  });
});

describe('the others stopped', () => {
  it('a group seen here, gone or declined, not by this person: the others stopped', () => {
    expect(othersStopped(view(), { ...NONE, seen: true })).toBe(true);
    expect(othersStopped(view(), { ...NONE, seen: true, optedOut: true })).toBe(false);
    expect(othersStopped(view(), NONE)).toBe(false);
    expect(othersStopped(view({ pending: proposal(), waitingFor: [ANDI] }), { ...NONE, seen: true })).toBe(false);
  });
});
