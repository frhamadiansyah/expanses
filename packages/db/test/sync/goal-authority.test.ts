import { describe, expect, it } from 'vitest';
import { goalWriteRefusal, type GoalLinkView } from '../../src/sync/goals/authority';

/* Who may write a shared goal's rows (shared goals §8.4): the pure predicate, one case per rule. */

const on: GoalLinkView = { sharedBy: 'member-f', state: 'on', round: 1 };
type Row = Record<string, unknown> | null;
type Case = [string, string, Row, Row, Record<string, string>, string | null, GoalLinkView | null, string | null];

const cases: Case[] = [
  ['a new link by its sharer', 'goal_share', null, { sharedBy: 'member-f', state: 'on', round: 1 }, { goal_id: 'g' }, 'member-f', null, null],
  ['a new link naming someone else', 'goal_share', null, { sharedBy: 'member-r', state: 'on', round: 1 }, { goal_id: 'g' }, 'member-f', null, 'a goal is shared by its sharer'],
  ['a new link already off', 'goal_share', null, { sharedBy: 'member-f', state: 'off', round: 1 }, { goal_id: 'g' }, 'member-f', null, 'a goal is shared by its sharer'],
  ['a new link at round 3', 'goal_share', null, { sharedBy: 'member-f', state: 'on', round: 3 }, { goal_id: 'g' }, 'member-f', null, 'a goal is shared by its sharer'],
  ['off by the sharer', 'goal_share', { sharedBy: 'member-f', state: 'on', round: 1 }, { sharedBy: 'member-f', state: 'off', round: 1 }, { goal_id: 'g' }, 'member-f', on, null],
  ['off by another member', 'goal_share', { sharedBy: 'member-f', state: 'on', round: 1 }, { sharedBy: 'member-f', state: 'off', round: 1 }, { goal_id: 'g' }, 'member-r', on, 'only the sharer changes the share'],
  ['on again with a new round', 'goal_share', { sharedBy: 'member-f', state: 'off', round: 1 }, { sharedBy: 'member-f', state: 'on', round: 2 }, { goal_id: 'g' }, 'member-f', { ...on, state: 'off' }, null],
  ['on again without a new round', 'goal_share', { sharedBy: 'member-f', state: 'off', round: 1 }, { sharedBy: 'member-f', state: 'on', round: 1 }, { goal_id: 'g' }, 'member-f', { ...on, state: 'off' }, 'turning it on again starts a new round'],
  ['a round rising while on', 'goal_share', { sharedBy: 'member-f', state: 'on', round: 1 }, { sharedBy: 'member-f', state: 'on', round: 2 }, { goal_id: 'g' }, 'member-f', on, 'turning it on again starts a new round'],
  ['the sharer changed', 'goal_share', { sharedBy: 'member-f', state: 'on', round: 1 }, { sharedBy: 'member-r', state: 'on', round: 1 }, { goal_id: 'g' }, 'member-f', on, 'the sharer never changes'],
  ['back from deleted', 'goal_share', { sharedBy: 'member-f', state: 'deleted', round: 1 }, { sharedBy: 'member-f', state: 'on', round: 2 }, { goal_id: 'g' }, 'member-f', { ...on, state: 'deleted' }, 'a deleted goal stays deleted'],
  ['a link deleted by op', 'goal_share', { sharedBy: 'member-f', state: 'on', round: 1 }, null, { goal_id: 'g' }, 'member-f', on, 'a share is turned off, never deleted'],
  ['a leave by its member, this round', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-r' }, 'member-r', on, null],
  ['a leave by the sharer', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-f' }, 'member-f', on, 'the sharer turns it off instead'],
  ['a leave for someone else', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-r' }, 'member-a', on, 'each member leaves only for themselves'],
  ['a leave for an old round', 'goal_share_leave', null, { round: 1, leftOn: '2026-11-10' }, { goal_id: 'g', member_id: 'member-r' }, 'member-r', { ...on, round: 2 }, 'a leave names the current round'],
  ['a leave deleted', 'goal_share_leave', { round: 1, leftOn: '2026-11-10' }, null, { goal_id: 'g', member_id: 'member-r' }, 'member-r', on, 'a leave is never deleted'],
  ['archive by another member', 'goal', { status: 'active', name: 'Trip' }, { status: 'archived', name: 'Trip' }, { id: 'g' }, 'member-r', on, 'only the sharer archives'],
  ['archive by the sharer', 'goal', { status: 'active', name: 'Trip' }, { status: 'archived', name: 'Trip' }, { id: 'g' }, 'member-f', on, null],
  ['a rename by another member', 'goal', { status: 'active', name: 'Trip' }, { status: 'active', name: 'Trip 2030' }, { id: 'g' }, 'member-r', on, null],
  ['a goal deleted by op', 'goal', { status: 'active', name: 'Trip' }, null, { id: 'g' }, 'member-f', on, 'a shared goal ends by its link'],
  ['a stage removed by anyone', 'goal_stage', { name: 'Deposit' }, null, { id: 's' }, 'member-r', on, null],
  ['a calculator removed by anyone', 'goal_calculator', { kind: 'x' }, null, { goal_id: 'g' }, 'member-r', on, null],
  ['an entity of no goal', 'purchase', null, { x: 1 }, { id: 'p' }, 'member-r', null, null],
];

describe('goalWriteRefusal', () => {
  it.each(cases)('%s', (_label, entity, before, after, key, member, link, refusal) => {
    expect(goalWriteRefusal(entity, before, after, key, member, link)).toBe(refusal);
  });
});
