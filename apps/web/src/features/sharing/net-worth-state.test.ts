import { NetWorthError, type NetWorthGroupView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { canInvite, netWorthRowOf, notReadyLine, pendingPrompt, ADD_SOMEONE_LINE, inviteesFor, needsReview, sayNetWorthError, settingOnAdd, shareRowOf, toggleInvitee } from './net-worth-state';

const rina = { memberId: 'r', name: 'Rina', role: 'owner' as const };
const andi = { memberId: 'a', name: 'Andi', role: 'member' as const };
const sari = { memberId: 's', name: 'Sari', role: 'member' as const };
const members = [rina, andi, sari];

const proposal = (over: Partial<NonNullable<NetWorthGroupView['pending']>> = {}) => ({
  proposalId: 'p1',
  mode: 'joint' as const,
  members: ['r', 'a'],
  proposedBy: 'r',
  createdHlc: '0001',
  cancelled: false,
  ...over,
});

const view = (me: string, over: Partial<NetWorthGroupView> = {}): NetWorthGroupView => ({ active: null, pending: null, waitingFor: [], groupBookId: 'g', me, ...over });

describe('the Share net worth row (§6, §8.1)', () => {
  it('is not drawn in a workspace nobody else is in', () => {
    expect(netWorthRowOf(null, [rina]).show).toBe(false);
    expect(netWorthRowOf(null, members).show).toBe(true);
  });

  it('none: no group log here, or one with nothing in it', () => {
    expect(netWorthRowOf(null, members)).toEqual({ show: true, active: null, pending: null });
    expect(netWorthRowOf(view('r', { groupBookId: null }), members)).toEqual({ show: true, active: null, pending: null });
  });

  it('waiting: the proposer sees who has yet to confirm, and may cancel', () => {
    const row = netWorthRowOf(view('r', { pending: proposal(), waitingFor: ['a'] }), members);
    expect(row.pending).toEqual({ kind: 'waiting', proposalId: 'p1', line: 'Waiting for Andi', cancellable: true });
  });

  it('waiting, having confirmed another’s proposal: no cancel', () => {
    const row = netWorthRowOf(view('a', { pending: proposal({ mode: 'separate', members: ['r', 'a', 's'] }), waitingFor: ['s'] }), members);
    expect(row.pending).toEqual({ kind: 'waiting', proposalId: 'p1', line: 'Waiting for Sari', cancellable: false });
  });

  it('asked: the card names who set it up and how', () => {
    expect(netWorthRowOf(view('a', { pending: proposal(), waitingFor: ['a'] }), members).pending).toEqual({
      kind: 'asked',
      proposalId: 'p1',
      mode: 'joint',
      line: 'Rina set up household net worth: one tax ID.',
    });
    expect(netWorthRowOf(view('a', { pending: proposal({ mode: 'separate' }), waitingFor: ['a'] }), members).pending?.line).toBe(
      'Rina set up household net worth: separate tax IDs.',
    );
  });

  it('a change that leaves a current member out asks them too (review round 2, D6)', () => {
    const active = { proposalId: 'p0', mode: 'separate' as const, members: ['r', 'a', 's'] };
    const row = netWorthRowOf(view('a', { active, pending: proposal({ proposalId: 'p2', mode: 'separate', members: ['r', 's'] }), waitingFor: ['a'] }), members);
    expect(row.pending).toEqual({ kind: 'asked', proposalId: 'p2', mode: 'separate', line: 'Rina proposes a group without you: separate tax IDs.' });
    const answered = netWorthRowOf(view('a', { active, pending: proposal({ proposalId: 'p2', mode: 'separate', members: ['r', 's'] }), waitingFor: ['s'] }), members);
    expect(answered.pending).toEqual({ kind: 'waiting', proposalId: 'p2', line: 'Waiting for Sari', cancellable: false });
  });

  it('not listed on a pending proposal: nothing to say about it', () => {
    expect(netWorthRowOf(view('s', { pending: proposal(), waitingFor: ['a'] }), members).pending).toBeNull();
  });

  it('active: the mode, and a change waiting beside it', () => {
    const active = { proposalId: 'p0', mode: 'joint' as const, members: ['r', 'a'] };
    expect(netWorthRowOf(view('r', { active }), members).active).toEqual({ mode: 'joint', line: 'Net worth shared · One tax ID', members: ['Rina', 'Andi'] });
    const changing = netWorthRowOf(view('a', { active, pending: proposal({ proposalId: 'p2', mode: 'separate' }), waitingFor: ['a'] }), members);
    expect(changing.active?.line).toBe('Net worth shared · One tax ID');
    expect(changing.pending?.kind).toBe('asked');
    expect(netWorthRowOf(view('r', { active: { ...active, mode: 'separate' } }), members).active?.line).toBe('Net worth shared · Separate');
  });
});

describe('setup', () => {
  it('one tax ID picks exactly one other; separate picks one or more', () => {
    expect(toggleInvitee([], 'a', 'joint')).toEqual(['a']);
    expect(toggleInvitee(['a'], 's', 'joint')).toEqual(['s']);
    expect(toggleInvitee(['a'], 's', 'separate')).toEqual(['a', 's']);
    expect(toggleInvitee(['a', 's'], 'a', 'separate')).toEqual(['s']);
    expect(canInvite(['a'], 'joint')).toBe(true);
    expect(canInvite(['a', 's'], 'joint')).toBe(false);
    expect(canInvite([], 'separate')).toBe(false);
    expect(canInvite(['a'], null)).toBe(false);
  });

  it("names every device too old: \"Update the app on Andi's iPad\"", () => {
    expect(notReadyLine([{ deviceName: "Andi's iPad" }])).toBe("Update the app on Andi's iPad");
    const said = sayNetWorthError(new NetWorthError('not-ready', 'x', [{ memberId: 'a', deviceName: "Andi's iPad" }, { memberId: 's', deviceName: "Sari's phone" }]));
    expect((said as Error).message).toBe("Update the app on Andi's iPad and Sari's phone");
  });

  it('the D8 prompt names the items and who they are shared with', () => {
    expect(pendingPrompt(['Business Mandiri'], ['Andi'])).toBe('Household now files with one tax ID. Share Business Mandiri with Andi?');
  });
});

describe("an item's Share with Household row (review round 1, finding 3)", () => {
  it('shows what is stored, never a default in its place', () => {
    expect(shareRowOf('separate', 'hidden')).toEqual({ kind: 'choose', value: 'hidden', label: "Don't share", hiddenAllowed: true });
    expect(shareRowOf('separate', 'total')).toEqual({ kind: 'choose', value: 'total', label: 'Balance and one total', hiddenAllowed: true });
    expect(shareRowOf('separate', null)).toEqual({ kind: 'choose', value: null, label: 'Not reviewed', hiddenAllowed: true });
  });

  it("one tax ID: a hidden item is not yet shared (D8), an unreviewed one is not reviewed, and Don't share is off", () => {
    expect(shareRowOf('joint', 'hidden')).toEqual({ kind: 'not-yet-shared', label: 'Not yet shared' });
    expect(shareRowOf('joint', null)).toEqual({ kind: 'choose', value: null, label: 'Not reviewed', hiddenAllowed: false });
    expect(shareRowOf('joint', 'total')).toEqual({ kind: 'choose', value: 'total', label: 'Balance and one total', hiddenAllowed: false });
  });
});

describe('the add forms (D9)', () => {
  it('with one tax ID a new item is shared whatever the switch says; separately it follows the switch; with no group nothing is written', () => {
    expect(settingOnAdd('joint', true)).toBe('total');
    expect(settingOnAdd('joint', false)).toBe('total');
    expect(settingOnAdd('separate', true)).toBe('total');
    expect(settingOnAdd('separate', false)).toBe('hidden');
    expect(settingOnAdd(null, true)).toBeNull();
  });
});

describe('the review (§6 Review, wave 3 merge)', () => {
  it('shows until Share was pressed for this group, even when every item already has a setting from an earlier group', () => {
    expect(needsReview({ mode: 'separate', reviewed: false, unreviewedItems: 0, pendingHidden: 0 })).toBe(true);
    expect(needsReview({ mode: 'separate', reviewed: true, unreviewedItems: 0, pendingHidden: 0 })).toBe(false);
    expect(needsReview({ mode: 'separate', reviewed: true, unreviewedItems: 1, pendingHidden: 0 })).toBe(true);
    expect(needsReview({ mode: 'joint', reviewed: true, unreviewedItems: 0, pendingHidden: 2 })).toBe(true);
    expect(needsReview({ mode: 'separate', reviewed: true, unreviewedItems: 0, pendingHidden: 2 })).toBe(false);
  });
});

describe('a Change (wave 3 round 2: never adds anyone)', () => {
  it('offers only the active group’s members, and says how to add someone; a first setup offers everyone', () => {
    const others = [andi, sari];
    expect(inviteesFor(others, ['r', 'a']).map((m) => m.memberId)).toEqual(['a']);
    expect(inviteesFor(others, null).map((m) => m.memberId)).toEqual(['a', 's']);
    expect(ADD_SOMEONE_LINE).toBe('To add someone, stop sharing net worth and set it up again.');
  });

  it('says the refusal in plain words', () => {
    const said = sayNetWorthError(new NetWorthError('adds-members', 'x')) as Error;
    expect(said.message).toBe(ADD_SOMEONE_LINE);
  });
});
