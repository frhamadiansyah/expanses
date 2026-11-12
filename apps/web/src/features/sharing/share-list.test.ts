import type { GoalShareTarget, GoalShareView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  applyShareChanges,
  changesOf,
  draftOf,
  EVENT_LOCKED,
  jointOn,
  keepConfirmed,
  monthOf,
  REVIEW_NAME,
  SHARE_LIST_COPY,
  type ShareListInput,
  shareListOf,
  sharedCount,
  tickAll,
  tickedCount,
  toggle,
  toggleJoint,
} from './share-list';
import { JOINT_LINE } from './net-worth-state';

const BOOK = 'book-family';
const target: GoalShareTarget = { bookId: BOOK, bookName: 'Family', me: 'm-rina', others: [{ memberId: 'm-andi', name: 'Andi' }] };

function goalShare(goalId: string, over: Partial<GoalShareView> = {}): GoalShareView {
  return {
    goalId,
    bookId: BOOK,
    bookName: 'Family',
    sharedBy: 'm-rina',
    sharedByName: 'Rina',
    state: 'on',
    round: 1,
    me: 'm-rina',
    isSharer: true,
    members: [
      { memberId: 'm-rina', name: 'Rina' },
      { memberId: 'm-andi', name: 'Andi' },
    ],
    left: [],
    ...over,
  };
}

function input(over: Partial<ShareListInput> = {}): ShareListInput {
  return {
    bookId: BOOK,
    netWorth: {
      mode: 'separate',
      reviewing: false,
      items: [
        { accountId: 'a-bca', name: 'BCA Tahapan', subtype: 'bank', setting: 'total' },
        { accountId: 'a-gopay', name: 'GoPay', subtype: 'ewallet', setting: 'hidden' },
        { accountId: 'a-card', name: 'Card ending 4417', subtype: 'credit_card', setting: 'total' },
        { accountId: 'a-house', name: 'House', subtype: 'property', setting: 'total' },
        { accountId: 'a-kpr', name: 'Home loan', subtype: 'loan', setting: null },
      ],
      joint: new Set(['a-bca']),
    },
    goals: [
      { id: 'g-hajj', name: 'Hajj', share: goalShare('g-hajj') },
      { id: 'g-phone', name: 'New phone', share: null },
      // Shared by Andi: his to change, so not listed.
      { id: 'g-andi', name: 'Andi’s bike', share: goalShare('g-andi', { sharedBy: 'm-andi', sharedByName: 'Andi', isSharer: false }) },
      // Shared into another workspace: listed there, not here.
      { id: 'g-other', name: 'Office fund', share: goalShare('g-other', { bookId: 'book-office', bookName: 'Office' }) },
    ],
    goalTargets: [target],
    events: [
      { id: 'e-trip', name: 'Bali trip', startsOn: '2026-10-03', shared: true },
      { id: 'e-dinner', name: 'Office dinner', startsOn: '2026-09-18', shared: false },
    ],
    ...over,
  };
}

describe('the list: which items, in which group, ticked as things stand', () => {
  it('groups accounts and cards, assets and debts, goals, events, in that order', () => {
    const list = shareListOf(input());
    expect(list.groups.map((group) => [group.label, group.items.map((item) => item.name)])).toEqual([
      ['Accounts & cards', ['BCA Tahapan', 'GoPay', 'Card ending 4417']],
      ['Assets & debts', ['House', 'Home loan']],
      ['Goals', ['Hajj', 'New phone']],
      ['Events', ['Bali trip', 'Office dinner']],
    ]);
  });

  it('ticks what is shared now, Joint only on accounts, kind and month as the meta', () => {
    const items = shareListOf(input()).groups.flatMap((group) => group.items);
    const by = (name: string) => items.find((item) => item.name === name)!;
    expect(by('BCA Tahapan')).toMatchObject({ ticked: true, joint: true, canJoint: true, meta: null });
    expect(by('GoPay')).toMatchObject({ ticked: false, joint: false, canJoint: true });
    expect(by('House')).toMatchObject({ ticked: true, canJoint: false, meta: 'Property' });
    // Never reviewed reads not shared: nothing is shared until ticked.
    expect(by('Home loan')).toMatchObject({ ticked: false, meta: 'Loan' });
    expect(by('Hajj')).toMatchObject({ ticked: true, locked: null });
    expect(by('New phone')).toMatchObject({ ticked: false });
    expect(by('Bali trip')).toMatchObject({ ticked: true, locked: EVENT_LOCKED, meta: 'Oct' });
    expect(by('Office dinner')).toMatchObject({ ticked: false, locked: null, meta: 'Sep' });
  });

  it('leaves an event’s trip balance out: the event made it, nobody chose it', () => {
    const withTrip = input();
    withTrip.netWorth = { ...withTrip.netWorth!, items: [...withTrip.netWorth!.items, { accountId: 'a-trip', name: 'Bali trip', subtype: 'event_balance', setting: null }] };
    const list = shareListOf(withTrip);
    expect(list.groups.flatMap((group) => group.items).filter((item) => item.id === 'a-trip')).toEqual([]);
    // A review answers for it all the same, keeping it unshared.
    withTrip.netWorth = { ...withTrip.netWorth, reviewing: true };
    const reviewing = shareListOf(withTrip);
    expect(changesOf(reviewing, draftOf(reviewing))[0]).toMatchObject({ kind: 'review', settings: { 'a-trip': 'hidden' } });
  });

  it('leaves net worth out while this person is in no active group of the workspace', () => {
    const list = shareListOf(input({ netWorth: null }));
    expect(list.groups.map((group) => group.key)).toEqual(['goals', 'events']);
  });

  it('leaves goals out where the workspace cannot take one (a phone on an old version)', () => {
    const list = shareListOf(input({ goalTargets: [] }));
    // The goal shared now keeps its tick (eligibility gates turning on, never off); the unshared one is left out.
    expect(list.groups.find((group) => group.key === 'goals')!.items.map((item) => item.name)).toEqual(['Hajj']);
  });

  it('with one tax ID a shared item cannot be unticked, and a review shares every item', () => {
    const joint = input();
    joint.netWorth = { ...joint.netWorth!, mode: 'joint' };
    const items = shareListOf(joint).groups.flatMap((group) => group.items);
    expect(items.find((item) => item.name === 'BCA Tahapan')!.locked).toBe(JOINT_LINE);
    expect(items.find((item) => item.name === 'GoPay')!.locked).toBeNull();

    joint.netWorth = { ...joint.netWorth, reviewing: true };
    const reviewing = shareListOf(joint).groups.filter((group) => group.key === 'accounts' || group.key === 'assets').flatMap((group) => group.items);
    expect(reviewing.every((item) => item.ticked && item.locked === JOINT_LINE)).toBe(true);
  });

  it('counts what is shared now for the Share page, and what is ticked for the button', () => {
    const list = shareListOf(input());
    // BCA, card, House, Hajj, Bali trip.
    expect(sharedCount(list)).toBe(5);
    let draft = draftOf(list);
    expect(tickedCount(list, draft)).toBe(5);
    draft = tickAll(draft, list.groups.find((group) => group.key === 'goals')!);
    expect(tickedCount(list, draft)).toBe(6);
  });
});

describe('the draft', () => {
  const list = shareListOf(input());
  const item = (name: string) => list.groups.flatMap((group) => group.items).find((row) => row.name === name)!;

  it('a locked tick stays; anything else toggles', () => {
    let draft = draftOf(list);
    draft = toggle(draft, item('Bali trip'));
    expect(draft.ticked.has('events:e-trip')).toBe(true);
    draft = toggle(draft, item('Office dinner'));
    expect(draft.ticked.has('events:e-dinner')).toBe(true);
    draft = toggle(draft, item('Office dinner'));
    expect(draft.ticked.has('events:e-dinner')).toBe(false);
  });

  it('Joint is offered only on a ticked account, and reads off once it is unticked', () => {
    let draft = draftOf(list);
    expect(toggleJoint(draft, item('GoPay'))).toBe(draft);
    expect(toggleJoint(draft, item('House'))).toBe(draft);
    draft = toggle(draft, item('GoPay'));
    draft = toggleJoint(draft, item('GoPay'));
    expect(jointOn(draft, item('GoPay'))).toBe(true);
    draft = toggle(draft, item('GoPay'));
    expect(jointOn(draft, item('GoPay'))).toBe(false);
  });

  it('Tick all ticks every item of the group', () => {
    const accounts = list.groups.find((group) => group.key === 'accounts')!;
    const draft = tickAll(draftOf(list), accounts);
    expect(accounts.items.every((row) => draft.ticked.has(row.key))).toBe(true);
  });
});

describe('what a draft changes, in order', () => {
  it('nothing changed is no change', () => {
    const list = shareListOf(input());
    expect(changesOf(list, draftOf(list))).toEqual([]);
  });

  it('settings, then Joint, then goals, then events', () => {
    const list = shareListOf(input());
    const item = (name: string) => list.groups.flatMap((group) => group.items).find((row) => row.name === name)!;
    let draft = draftOf(list);
    draft = toggle(draft, item('Office dinner'));
    draft = toggle(draft, item('New phone'));
    draft = toggle(draft, item('Hajj'));
    draft = toggleJoint(toggle(draft, item('GoPay')), item('GoPay'));
    draft = toggle(draft, item('House'));
    draft = toggleJoint(draft, item('BCA Tahapan'));
    expect(changesOf(list, draft)).toEqual([
      { kind: 'setting', name: 'GoPay', accountId: 'a-gopay', setting: 'total' },
      { kind: 'setting', name: 'House', accountId: 'a-house', setting: 'hidden' },
      { kind: 'joint', name: 'BCA Tahapan', accountId: 'a-bca', on: false },
      { kind: 'joint', name: 'GoPay', accountId: 'a-gopay', on: true },
      { kind: 'stop-goal', name: 'Hajj', goalId: 'g-hajj' },
      { kind: 'share-goal', name: 'New phone', goalId: 'g-phone' },
      { kind: 'share-event', name: 'Office dinner', eventId: 'e-dinner' },
    ]);
  });

  it('an account unticked takes its Joint with it: no Joint change is sent for it', () => {
    const list = shareListOf(input());
    const bca = list.groups[0]!.items[0]!;
    expect(changesOf(list, toggle(draftOf(list), bca))).toEqual([{ kind: 'setting', name: 'BCA Tahapan', accountId: 'a-bca', setting: 'hidden' }]);
  });

  it('while the review waits, Share answers it for every item at once, Joint after it', () => {
    const reviewing = input();
    reviewing.netWorth = { ...reviewing.netWorth!, reviewing: true };
    const list = shareListOf(reviewing);
    const gopay = list.groups[0]!.items[1]!;
    const draft = toggleJoint(toggle(draftOf(list), gopay), gopay);
    expect(changesOf(list, draft)).toEqual([
      { kind: 'review', name: REVIEW_NAME, settings: { 'a-bca': 'total', 'a-gopay': 'total', 'a-card': 'total', 'a-house': 'total', 'a-kpr': 'hidden' } },
      { kind: 'joint', name: 'GoPay', accountId: 'a-gopay', on: true },
    ]);
  });

  it('a goal whose stop was declined is left shared', () => {
    const changes = [
      { kind: 'stop-goal', name: 'Hajj', goalId: 'g-hajj' },
      { kind: 'share-goal', name: 'New phone', goalId: 'g-phone' },
    ] as const;
    expect(keepConfirmed(changes, () => false)).toEqual([changes[1]]);
    expect(keepConfirmed(changes, () => true)).toEqual(changes);
  });
});

describe('applying', () => {
  function runners(fail: Partial<Record<string, string>> = {}) {
    const calls: string[] = [];
    const run = (what: string) => async () => {
      calls.push(what);
      if (fail[what]) throw new Error(fail[what]);
    };
    return {
      calls,
      runners: {
        review: async () => run('review')(),
        setting: async (id: string, setting: string) => run(`setting ${id} ${setting}`)(),
        joint: async (id: string, on: boolean) => run(`joint ${id} ${on}`)(),
        shareGoal: async (id: string) => run(`share-goal ${id}`)(),
        stopGoal: async (id: string) => run(`stop-goal ${id}`)(),
        shareEvent: async (id: string) => {
          await run(`share-event ${id}`)();
          return `code-${id}`;
        },
      },
    };
  }

  it('runs each change in order through its own action, and keeps the invites', async () => {
    const { calls, runners: r } = runners();
    const outcome = await applyShareChanges(
      [
        { kind: 'setting', name: 'GoPay', accountId: 'a-gopay', setting: 'total' },
        { kind: 'joint', name: 'GoPay', accountId: 'a-gopay', on: true },
        { kind: 'share-goal', name: 'New phone', goalId: 'g-phone' },
        { kind: 'share-event', name: 'Office dinner', eventId: 'e-dinner' },
      ],
      r,
      String,
    );
    expect(calls).toEqual(['setting a-gopay total', 'joint a-gopay true', 'share-goal g-phone', 'share-event e-dinner']);
    expect(outcome).toEqual({ done: 4, failed: [], invites: [{ eventId: 'e-dinner', name: 'Office dinner', invite: 'code-e-dinner' }] });
  });

  it('one that fails is named with why, and the rest still run', async () => {
    const { calls, runners: r } = runners({ 'share-goal g-phone': 'A goal is shared only into a shared workspace with another member' });
    const outcome = await applyShareChanges(
      [
        { kind: 'share-goal', name: 'New phone', goalId: 'g-phone' },
        { kind: 'stop-goal', name: 'Hajj', goalId: 'g-hajj' },
        { kind: 'share-event', name: 'Office dinner', eventId: 'e-dinner' },
      ],
      r,
      (error) => (error as Error).message,
    );
    expect(calls).toEqual(['share-goal g-phone', 'stop-goal g-hajj', 'share-event e-dinner']);
    expect(outcome.done).toBe(2);
    expect(outcome.failed).toEqual([{ name: 'New phone', reason: 'A goal is shared only into a shared workspace with another member' }]);
    expect(outcome.invites).toHaveLength(1);
  });

  it('a failed event share brings no invite, and is named', async () => {
    const { runners: r } = runners({ 'share-event e-dinner': 'The relay could not be reached' });
    const outcome = await applyShareChanges([{ kind: 'share-event', name: 'Office dinner', eventId: 'e-dinner' }], r, (error) => (error as Error).message);
    expect(outcome).toEqual({ done: 0, failed: [{ name: 'Office dinner', reason: 'The relay could not be reached' }], invites: [] });
  });
});

describe('copy', () => {
  it('names the one other member, or the workspace when there are more', () => {
    expect(SHARE_LIST_COPY.setupTitle(['Andi'], 'Family')).toBe('Share with Andi');
    expect(SHARE_LIST_COPY.title(['Andi'], 'Family')).toBe('What’s shared with Andi');
    expect(SHARE_LIST_COPY.title(['Andi', 'Sari'], 'Family')).toBe('What’s shared with Family');
  });

  it('reads as the mockup, with real names', () => {
    expect(SHARE_LIST_COPY.lede(['Andi'], 'Family')).toBe('Family’s budgets, bills and transactions are already shared. Pick what else Andi sees. Nothing here is shared until ticked.');
    expect(SHARE_LIST_COPY.accountsFooter(['Andi'], 'Family')).toBe('Ticked: Andi sees its balance on Net worth. Joint: Andi can also pay from it in Family and sees its rows.');
    expect(SHARE_LIST_COPY.accountsFooter(['Andi', 'Sari'], 'Family')).toBe('Ticked: Andi and Sari see its balance on Net worth. Joint: Andi and Sari can also pay from it in Family and see its rows.');
    expect(SHARE_LIST_COPY.shareButton(7)).toBe('Share 7 items');
    expect(SHARE_LIST_COPY.shareButton(1)).toBe('Share 1 item');
    expect(SHARE_LIST_COPY.rowValue(7)).toBe('7 items');
    expect(SHARE_LIST_COPY.workspaceFooter('Family')).toBe('Budgets, bills, categories and Family’s transactions are shared with Family as a whole.');
  });

  it('never says you or your', () => {
    const strings = [
      SHARE_LIST_COPY.lede(['Andi'], 'Family'),
      SHARE_LIST_COPY.accountsFooter(['Andi'], 'Family'),
      SHARE_LIST_COPY.netWorthOff,
      SHARE_LIST_COPY.invitesFooter(['Andi'], 'Family'),
      SHARE_LIST_COPY.workspaceFooter('Family'),
      EVENT_LOCKED,
    ];
    for (const line of strings) expect(line).not.toMatch(/\byou(r)?\b/i);
  });

  it('month of a day', () => {
    expect(monthOf('2026-01-31')).toBe('Jan');
    expect(monthOf('')).toBeNull();
  });
});
