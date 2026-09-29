import { NetWorthError, type NetWorthGroupView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { canInvite, netWorthRowOf, notReadyLine, pendingPrompt, sayNetWorthError, toggleInvitee } from './net-worth-state';

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
