import type { NetWorthGroupView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { autoConfirmOf, autoReviewSettings } from './net-worth-auto';

/*
 * The steps the old Net worth setup asked for by hand (2026-11-13): the partner's Confirm of a group filed separately,
 * and the review on the phone that switched the first account on. Names and ids invented.
 */

const RINA = 'm-rina';
const ANDI = 'm-andi';

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

describe('the partner’s phone confirms a group filed separately by itself', () => {
  it('confirms a separate proposal that lists this member and waits for them', () => {
    expect(autoConfirmOf(view({ pending: proposal(), waitingFor: [ANDI] }), null)).toBe('p-1');
  });

  it('never confirms one tax ID: it shares every item, so it is asked in the tax report', () => {
    expect(autoConfirmOf(view({ pending: proposal({ mode: 'joint' }), waitingFor: [ANDI] }), null)).toBeNull();
  });

  it('nothing when not asked, when left out of it, or already in another workspace’s group', () => {
    expect(autoConfirmOf(view({ pending: proposal(), waitingFor: [RINA] }), null)).toBeNull();
    expect(autoConfirmOf(view({ pending: proposal({ members: [RINA, 'm-sari'] }), waitingFor: [ANDI] }), null)).toBeNull();
    expect(autoConfirmOf(view({ pending: proposal(), waitingFor: [ANDI] }), 'book-office')).toBeNull();
    expect(autoConfirmOf(null, null)).toBeNull();
    expect(autoConfirmOf(view({ pending: proposal({ cancelled: true }), waitingFor: [ANDI] }), null)).toBeNull();
  });
});

describe('the review, answered with exactly what was chosen', () => {
  const items = [
    { accountId: 'a-bca', setting: 'total' as const },
    { accountId: 'a-gopay', setting: 'hidden' as const },
    { accountId: 'a-card', setting: null },
    { accountId: 'a-old', setting: 'total' as const },
  ];

  it('on the phone that started the group: what is stored is what was switched on', () => {
    expect(autoReviewSettings(items, { proposer: true, live: new Set() })).toEqual({ 'a-bca': 'total', 'a-gopay': 'hidden', 'a-card': 'hidden', 'a-old': 'total' });
  });

  it('on the other phone: only what the partner already sees stays shared; nothing new goes out', () => {
    expect(autoReviewSettings(items, { proposer: false, live: new Set(['a-bca']) })).toEqual({ 'a-bca': 'total', 'a-gopay': 'hidden', 'a-card': 'hidden', 'a-old': 'hidden' });
  });

  it('one switched on now is shared, and one switched off is not', () => {
    expect(autoReviewSettings(items, { proposer: false, live: new Set() }, { 'a-card': 'total' })).toMatchObject({ 'a-card': 'total', 'a-bca': 'hidden' });
    expect(autoReviewSettings(items, { proposer: true, live: new Set() }, { 'a-bca': 'hidden' })).toMatchObject({ 'a-bca': 'hidden', 'a-old': 'total' });
  });
});
