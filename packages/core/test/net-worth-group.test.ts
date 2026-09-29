import { describe, expect, it } from 'vitest';
import { deriveGroup, canPropose, isActivated, type Proposal, type Answer } from '../src/net-worth/group';

const p = (id: string, hlc: string, mode: 'joint' | 'separate', members: string[], by = members[0]!, cancelled = false): Proposal =>
  ({ proposalId: id, mode, members, proposedBy: by, createdHlc: hlc, cancelled });
const a = (proposalId: string, memberId: string, answer: Answer['answer']): Answer => ({ proposalId, memberId, answer });

describe('deriveGroup', () => {
  it('is empty with nothing', () => expect(deriveGroup([], [])).toEqual({ active: null, pending: null, waitingFor: [] }));
  it('waits for the other member', () => {
    const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm')]);
    expect(s.active).toBeNull();
    expect(s.pending?.proposalId).toBe('p1');
    expect(s.waitingFor).toEqual(['andi']);
  });
  it('activates when everyone confirms', () => {
    const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm')]);
    expect(s.active).toEqual({ proposalId: 'p1', mode: 'joint', members: ['rina', 'andi'] });
    expect(s.pending).toBeNull();
  });
  it('a decline stops a pending proposal', () => {
    const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'decline')]);
    expect(s).toEqual({ active: null, pending: null, waitingFor: [] });
  });
  it('a cancelled proposal never activates', () => {
    const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'], 'rina', true)], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm')]);
    expect(s.active).toBeNull();
  });
  it('the old mode holds while a change waits', () => {
    const s = deriveGroup(
      [p('p1', '001', 'separate', ['rina', 'andi']), p('p2', '002', 'joint', ['rina', 'andi'], 'andi')],
      [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p2', 'andi', 'confirm')],
    );
    expect(s.active?.mode).toBe('separate');
    expect(s.pending?.proposalId).toBe('p2');
    expect(s.waitingFor).toEqual(['rina']);
  });
  it('a member who leaves after activation keeps the group for the rest', () => {
    const s = deriveGroup([p('p1', '001', 'separate', ['rina', 'andi', 'sari'])],
      [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p1', 'sari', 'confirm')]);
    expect(s.active?.members).toEqual(['rina', 'andi', 'sari']);
  });
  it('leaving removes the member; fewer than two ends the group', () => {
    const three = deriveGroup([p('p1', '001', 'separate', ['rina', 'andi', 'sari'])],
      [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p1', 'sari', 'left')]);
    expect(three.active?.members).toEqual(['rina', 'andi']);
    const two = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'left')]);
    expect(two.active).toBeNull();
  });
  it('joint with three members never activates', () => {
    const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi', 'sari'])],
      [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p1', 'sari', 'confirm')]);
    expect(s.active).toBeNull();
  });
});

describe('a change needs every current member (task 5 review round 2, D6)', () => {
  const group = p('p1', '001', 'separate', ['rina', 'andi', 'sari']);
  const joined = [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p1', 'sari', 'confirm')];
  const dropAndi = p('p2', '002', 'separate', ['rina', 'sari'], 'rina');

  it('the listed members alone cannot drop a current one: the change waits for Andi', () => {
    const s = deriveGroup([group, dropAndi], [...joined, a('p2', 'rina', 'confirm'), a('p2', 'sari', 'confirm')]);
    expect(s.active?.proposalId).toBe('p1');
    expect(s.pending?.proposalId).toBe('p2');
    expect(s.waitingFor).toEqual(['andi']);
    expect(isActivated(dropAndi, [group, dropAndi], [...joined, a('p2', 'rina', 'confirm'), a('p2', 'sari', 'confirm')])).toBe(false);
  });

  it('Andi confirms: the change is the group, without him', () => {
    const s = deriveGroup([group, dropAndi], [...joined, a('p2', 'rina', 'confirm'), a('p2', 'sari', 'confirm'), a('p2', 'andi', 'confirm')]);
    expect(s.active).toEqual({ proposalId: 'p2', mode: 'separate', members: ['rina', 'sari'] });
  });

  it('Andi declines: never', () => {
    const s = deriveGroup([group, dropAndi], [...joined, a('p2', 'rina', 'confirm'), a('p2', 'sari', 'confirm'), a('p2', 'andi', 'decline')]);
    expect(s.active?.proposalId).toBe('p1');
    expect(s.pending).toBeNull();
  });

  it('a member who left the group is not asked', () => {
    const left = [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'left'), a('p1', 'sari', 'confirm')];
    const s = deriveGroup([group, dropAndi], [...left, a('p2', 'rina', 'confirm'), a('p2', 'sari', 'confirm')]);
    expect(s.active?.proposalId).toBe('p2');
  });

  it('with no group active, only the listed members count', () => {
    expect(isActivated(dropAndi, [dropAndi], [a('p2', 'rina', 'confirm'), a('p2', 'sari', 'confirm')])).toBe(true);
  });
});

describe('canPropose', () => {
  it('joint needs exactly two', () => {
    expect(canPropose('joint', ['a', 'b'])).toBe(true);
    expect(canPropose('joint', ['a', 'b', 'c'])).toBe(false);
    expect(canPropose('separate', ['a', 'b', 'c'])).toBe(true);
    expect(canPropose('separate', ['a'])).toBe(false);
    expect(canPropose('separate', ['a', 'a'])).toBe(false);
  });
});
