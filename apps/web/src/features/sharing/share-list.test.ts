import type { GoalShareTarget, GoalShareView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  allOrNone,
  applyShareChanges,
  changesOf,
  completeReviewSettings,
  emptyDraft,
  EVENT_LOCKED,
  eventsToShare,
  isTicked,
  jointOn,
  keepConfirmed,
  monthOf,
  NOT_SHARED_YET,
  reconcile,
  REVIEW_NAME,
  SHARE_LIST_COPY,
  type ShareChange,
  type ShareList,
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
      reviewed: true,
      items: [
        { accountId: 'a-bca', name: 'BCA Tahapan', subtype: 'savings', setting: 'total' },
        { accountId: 'a-gopay', name: 'GoPay', subtype: 'ewallet', setting: 'hidden' },
        { accountId: 'a-card', name: 'Card ending 4417', subtype: 'credit_card', setting: 'total' },
        { accountId: 'a-rdn', name: 'Broker cash', subtype: 'fund', setting: 'hidden' },
        { accountId: 'a-house', name: 'House', subtype: 'property', setting: 'total' },
        { accountId: 'a-kpr', name: 'Home loan', subtype: 'loan', setting: 'hidden' },
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
      { id: 'e-trip', name: 'Bali trip', startsOn: '2026-10-03', currency: 'IDR', shared: true },
      { id: 'e-dinner', name: 'Office dinner', startsOn: '2026-09-18', currency: 'SGD', shared: false },
    ],
    ...over,
  };
}

const rows = (list: ShareList) => list.groups.flatMap((group) => group.items);
const row = (list: ShareList, name: string) => rows(list).find((item) => item.name === name)!;

/** A list whose net worth is changed by `patch`. */
function listWith(patch: Partial<NonNullable<ShareListInput['netWorth']>>, items?: NonNullable<ShareListInput['netWorth']>['items']) {
  const base = input();
  base.netWorth = { ...base.netWorth!, ...patch, ...(items ? { items } : {}) };
  return shareListOf(base);
}

describe('the list: which items, in which group, ticked as things stand', () => {
  it('groups accounts and cards, assets and debts, goals, events, in that order', () => {
    const list = shareListOf(input());
    expect(list.groups.map((group) => [group.label, group.items.map((item) => item.name)])).toEqual([
      ['Accounts & cards', ['BCA Tahapan', 'GoPay', 'Card ending 4417', 'Broker cash']],
      ['Assets & debts', ['House', 'Home loan']],
      ['Goals', ['Hajj', 'New phone']],
      ['Events', ['Bali trip', 'Office dinner']],
    ]);
  });

  it('ticks what is shared now; Joint only where the partner can pay from it; kind, month and currency as the meta', () => {
    const list = shareListOf(input());
    const draft = emptyDraft(list);
    expect(row(list, 'BCA Tahapan')).toMatchObject({ shared: true, joint: true, canJoint: true, meta: null, caption: null });
    expect(row(list, 'GoPay')).toMatchObject({ shared: false, canJoint: true, caption: null });
    // A broker's cash cannot pay for anything: no Joint (Paid with's kinds).
    expect(row(list, 'Broker cash')).toMatchObject({ canJoint: false });
    expect(row(list, 'House')).toMatchObject({ shared: true, canJoint: false, meta: 'Property' });
    expect(row(list, 'Hajj')).toMatchObject({ shared: true, locked: null });
    expect(row(list, 'Bali trip')).toMatchObject({ shared: true, locked: EVENT_LOCKED, meta: 'Oct · IDR' });
    expect(row(list, 'Office dinner')).toMatchObject({ shared: false, locked: null, meta: 'Sep · SGD' });
    expect(isTicked(draft, row(list, 'BCA Tahapan'))).toBe(true);
    expect(isTicked(draft, row(list, 'GoPay'))).toBe(false);
  });

  it('leaves net worth out while this person is in no active group of the workspace', () => {
    expect(shareListOf(input({ netWorth: null })).groups.map((group) => group.key)).toEqual(['goals', 'events']);
  });

  it('leaves goals out where the workspace cannot take one (a phone on an old version)', () => {
    const list = shareListOf(input({ goalTargets: [] }));
    expect(list.groups.find((group) => group.key === 'goals')!.items.map((item) => item.name)).toEqual(['Hajj']);
  });

  it('leaves an event’s trip balance out: the event made it, nobody chose it', () => {
    const list = listWith({}, [...input().netWorth!.items, { accountId: 'a-trip', name: 'Bali trip', subtype: 'event_balance', setting: null }]);
    expect(rows(list).filter((item) => item.id === 'a-trip')).toEqual([]);
  });

  it('counts what is shared now for the Share page, and what is ticked for the button', () => {
    const list = shareListOf(input());
    // BCA, card, House, Hajj, Bali trip.
    expect(sharedCount(list)).toBe(5);
    expect(tickedCount(list, emptyDraft(list))).toBe(5);
    const draft = tickAll(list, emptyDraft(list), list.groups.find((group) => group.key === 'goals')!);
    expect(tickedCount(list, draft)).toBe(6);
  });
});

describe('a net worth review that waits is never answered behind the person’s back', () => {
  // The reviewer's scenario: one tax ID, Business Mandiri still hidden with the D8 prompt unanswered; a goal is ticked.
  const d8Items = [
    { accountId: 'a-bca', name: 'BCA Tahapan', subtype: 'savings', setting: 'total' as const },
    { accountId: 'a-mandiri', name: 'Business Mandiri', subtype: 'bank', setting: 'hidden' as const },
  ];

  it('one tax ID, a hidden item after the switch: drawn unticked, Not shared yet, counted nowhere', () => {
    const list = listWith({ mode: 'joint', reviewed: true }, d8Items);
    expect(row(list, 'Business Mandiri')).toMatchObject({ shared: false, locked: null, caption: NOT_SHARED_YET });
    expect(isTicked(emptyDraft(list), row(list, 'Business Mandiri'))).toBe(false);
    expect(row(list, 'BCA Tahapan')).toMatchObject({ shared: true, locked: JOINT_LINE });
    expect(sharedCount(list)).toBe(1 + 1 + 1); // BCA, Hajj, Bali trip
    expect(tickedCount(list, emptyDraft(list))).toBe(3);
  });

  it('ticking only a goal changes the goal alone: no review, no setting', () => {
    const list = listWith({ mode: 'joint', reviewed: true }, d8Items);
    const draft = toggle(list, emptyDraft(list), row(list, 'New phone'));
    expect(changesOf(list, draft)).toEqual([{ kind: 'share-goal', key: 'share-goal:g-phone', name: 'New phone', goalId: 'g-phone' }]);
  });

  it('ticked on purpose, the hidden item alone is shared, through its own setting', () => {
    const list = listWith({ mode: 'joint', reviewed: true }, d8Items);
    const draft = toggle(list, emptyDraft(list), row(list, 'Business Mandiri'));
    expect(changesOf(list, draft)).toEqual([{ kind: 'setting', key: 'setting:a-mandiri', name: 'Business Mandiri', accountId: 'a-mandiri', setting: 'total' }]);
  });

  it('before the review, nothing reads as shared — not even what an earlier group left stored as shared', () => {
    const list = listWith({ mode: 'separate', reviewed: false });
    const nw = rows(list).filter((item) => item.group === 'accounts' || item.group === 'assets');
    expect(nw.every((item) => !item.shared && item.caption === NOT_SHARED_YET && !isTicked(emptyDraft(list), item))).toBe(true);
    expect(sharedCount(list)).toBe(2); // Hajj, Bali trip
  });

  it('untouched, Save never calls the review: only the goal goes', async () => {
    for (const mode of ['joint', 'separate'] as const) {
      const list = listWith({ mode, reviewed: false });
      const changes = changesOf(list, toggle(list, emptyDraft(list), row(list, 'New phone')));
      const reviews: unknown[] = [];
      await applyShareChanges(changes, runners(reviews), String);
      expect(reviews).toEqual([]);
      expect(changes.map((change) => change.kind)).toEqual(['share-goal']);
    }
  });

  it('separately, a tick answers the review: what was ticked is shared, the rest stays private', () => {
    const list = listWith({ mode: 'separate', reviewed: false });
    const gopay = row(list, 'GoPay');
    const draft = toggleJoint(toggle(list, emptyDraft(list), gopay), gopay);
    expect(changesOf(list, draft)).toEqual([
      {
        kind: 'review',
        key: 'review',
        name: REVIEW_NAME,
        settings: { 'a-bca': 'hidden', 'a-gopay': 'total', 'a-card': 'hidden', 'a-rdn': 'hidden', 'a-house': 'hidden', 'a-kpr': 'hidden' },
      },
      { kind: 'joint', key: 'joint:a-gopay', name: 'GoPay', accountId: 'a-gopay', on: true },
    ]);
  });

  it('one tax ID before the review: all or none — one tick ticks every item, and the review shares them all', () => {
    const list = listWith({ mode: 'joint', reviewed: false });
    expect(allOrNone(list)).toBe(true);
    const draft = toggle(list, emptyDraft(list), row(list, 'House'));
    expect(rows(list).filter((item) => item.group === 'accounts' || item.group === 'assets').every((item) => isTicked(draft, item))).toBe(true);
    const [review] = changesOf(list, draft);
    expect(review).toMatchObject({ kind: 'review' });
    expect(Object.values((review as Extract<ShareChange, { kind: 'review' }>).settings).every((setting) => setting === 'total')).toBe(true);
    // And untick takes them all back off.
    const back = toggle(list, draft, row(list, 'GoPay'));
    expect(changesOf(list, back)).toEqual([]);
  });

  it('a review sent is made whole: an item that came after the list was read goes as hidden', () => {
    expect(completeReviewSettings({ 'a-bca': 'total' }, ['a-bca', 'a-new-card'])).toEqual({ 'a-bca': 'total', 'a-new-card': 'hidden' });
  });
});

describe('the draft follows the list', () => {
  it('a row that appears mid-edit opens unticked and is never shared unless ticked', () => {
    const before = shareListOf(input());
    const draft = toggle(before, emptyDraft(before), row(before, 'New phone'));
    const base = input();
    base.netWorth = { ...base.netWorth!, items: [...base.netWorth!.items, { accountId: 'a-new', name: 'New card', subtype: 'credit_card', setting: null }] };
    const after = shareListOf(base);
    expect(isTicked(reconcile(after, draft), row(after, 'New card'))).toBe(false);
    expect(changesOf(after, draft).map((change) => change.key)).toEqual(['share-goal:g-phone']);
  });

  it('a change of filing or of the review drops the net worth edits, and keeps the rest', () => {
    const before = shareListOf(input());
    let draft = toggle(before, emptyDraft(before), row(before, 'GoPay'));
    draft = toggle(before, draft, row(before, 'Office dinner'));
    const after = listWith({ reviewed: false });
    const kept = reconcile(after, draft);
    expect(isTicked(kept, row(after, 'GoPay'))).toBe(false);
    expect(isTicked(kept, row(after, 'Office dinner'))).toBe(true);
    expect(changesOf(after, draft).map((change) => change.kind)).toEqual(['share-event']);
  });

  it('a row gone takes its edit with it', () => {
    const before = shareListOf(input());
    const draft = toggle(before, emptyDraft(before), row(before, 'Office dinner'));
    const after = shareListOf(input({ events: [] }));
    expect(reconcile(after, draft).ticks.size).toBe(0);
  });
});

describe('the draft', () => {
  const list = shareListOf(input());

  it('a locked tick stays; anything else toggles', () => {
    let draft = toggle(list, emptyDraft(list), row(list, 'Bali trip'));
    expect(isTicked(draft, row(list, 'Bali trip'))).toBe(true);
    draft = toggle(list, draft, row(list, 'Office dinner'));
    expect(isTicked(draft, row(list, 'Office dinner'))).toBe(true);
    draft = toggle(list, draft, row(list, 'Office dinner'));
    expect(isTicked(draft, row(list, 'Office dinner'))).toBe(false);
    expect(draft.ticks.size).toBe(0);
  });

  it('Joint is offered only on a ticked account, and reads off once it is unticked', () => {
    let draft = emptyDraft(list);
    expect(toggleJoint(draft, row(list, 'GoPay'))).toBe(draft);
    expect(toggleJoint(draft, row(list, 'House'))).toBe(draft);
    draft = toggleJoint(toggle(list, draft, row(list, 'GoPay')), row(list, 'GoPay'));
    expect(jointOn(draft, row(list, 'GoPay'))).toBe(true);
    draft = toggle(list, draft, row(list, 'GoPay'));
    expect(jointOn(draft, row(list, 'GoPay'))).toBe(false);
  });

  it('the events ticked to share are named for the move warning', () => {
    const draft = toggle(list, emptyDraft(list), row(list, 'Office dinner'));
    expect(eventsToShare(list, draft).map((item) => item.name)).toEqual(['Office dinner']);
    expect(SHARE_LIST_COPY.eventsFooter(['Office dinner'])).toContain('What is tagged to it moves out of its workspace');
  });
});

describe('what a reviewed draft changes, in order', () => {
  it('nothing changed is no change', () => {
    const list = shareListOf(input());
    expect(changesOf(list, emptyDraft(list))).toEqual([]);
  });

  it('settings, then Joint, then goals, then events', () => {
    const list = shareListOf(input());
    let draft = emptyDraft(list);
    for (const name of ['Office dinner', 'New phone', 'Hajj', 'GoPay', 'House']) draft = toggle(list, draft, row(list, name));
    draft = toggleJoint(draft, row(list, 'GoPay'));
    draft = toggleJoint(draft, row(list, 'BCA Tahapan'));
    expect(changesOf(list, draft).map((change) => change.key)).toEqual([
      'setting:a-gopay',
      'setting:a-house',
      'joint:a-bca',
      'joint:a-gopay',
      'stop-goal:g-hajj',
      'share-goal:g-phone',
      'share-event:e-dinner',
    ]);
  });

  it('an account unticked takes its Joint with it: no Joint change is sent for it', () => {
    const list = shareListOf(input());
    expect(changesOf(list, toggle(list, emptyDraft(list), row(list, 'BCA Tahapan')))).toEqual([
      { kind: 'setting', key: 'setting:a-bca', name: 'BCA Tahapan', accountId: 'a-bca', setting: 'hidden' },
    ]);
  });

  it('a goal whose stop was declined is left shared', () => {
    const changes: ShareChange[] = [
      { kind: 'stop-goal', key: 'stop-goal:g-hajj', name: 'Hajj', goalId: 'g-hajj' },
      { kind: 'share-goal', key: 'share-goal:g-phone', name: 'New phone', goalId: 'g-phone' },
    ];
    expect(keepConfirmed(changes, () => false)).toEqual([changes[1]]);
    expect(keepConfirmed(changes, () => true)).toEqual(changes);
  });
});

function runners(reviews: unknown[] = [], fail: Partial<Record<string, string>> = {}, calls: string[] = []) {
  const run = async (what: string) => {
    calls.push(what);
    if (fail[what]) throw new Error(fail[what]);
  };
  return {
    review: async (settings: unknown) => {
      reviews.push(settings);
      await run('review');
    },
    setting: (id: string, setting: string) => run(`setting ${id} ${setting}`),
    joint: (id: string, on: boolean) => run(`joint ${id} ${on}`),
    shareGoal: (id: string) => run(`share-goal ${id}`),
    stopGoal: (id: string) => run(`stop-goal ${id}`),
    shareEvent: async (id: string) => {
      await run(`share-event ${id}`);
      return { code: `code-${id}`, kept: [] };
    },
  };
}

describe('applying', () => {
  it('runs each change in order through its own action, and keeps what each event share brought back', async () => {
    const calls: string[] = [];
    const outcome = await applyShareChanges(
      [
        { kind: 'setting', key: 'setting:a-gopay', name: 'GoPay', accountId: 'a-gopay', setting: 'total' },
        { kind: 'joint', key: 'joint:a-gopay', name: 'GoPay', accountId: 'a-gopay', on: true },
        { kind: 'share-goal', key: 'share-goal:g-phone', name: 'New phone', goalId: 'g-phone' },
        { kind: 'share-event', key: 'share-event:e-dinner', name: 'Office dinner', eventId: 'e-dinner' },
      ],
      runners([], {}, calls),
      String,
    );
    expect(calls).toEqual(['setting a-gopay total', 'joint a-gopay true', 'share-goal g-phone', 'share-event e-dinner']);
    expect(outcome).toEqual({ done: 4, failed: [], events: [{ eventId: 'e-dinner', name: 'Office dinner', shared: { code: 'code-e-dinner', kept: [] } }] });
  });

  it('one that fails is named with why and its own key, and the rest still run', async () => {
    const calls: string[] = [];
    const outcome = await applyShareChanges(
      [
        { kind: 'share-goal', key: 'share-goal:g-phone', name: 'New phone', goalId: 'g-phone' },
        { kind: 'share-goal', key: 'share-goal:g-phone-2', name: 'New phone', goalId: 'g-phone-2' },
        { kind: 'share-event', key: 'share-event:e-dinner', name: 'Office dinner', eventId: 'e-dinner' },
      ],
      runners([], { 'share-goal g-phone': 'A goal is shared only into a shared workspace with another member', 'share-goal g-phone-2': 'Not now' }, calls),
      (error) => (error as Error).message,
    );
    expect(calls).toEqual(['share-goal g-phone', 'share-goal g-phone-2', 'share-event e-dinner']);
    expect(outcome.done).toBe(1);
    expect(outcome.failed.map((failed) => failed.key)).toEqual(['share-goal:g-phone', 'share-goal:g-phone-2']);
    expect(outcome.failed[0]!.reason).toBe('A goal is shared only into a shared workspace with another member');
    expect(outcome.events).toHaveLength(1);
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
    expect(SHARE_LIST_COPY.reviewBody('joint', ['Andi'])).toContain('For the joint tax return, each item also goes to Andi');
  });

  it('never says you or your', () => {
    const strings = [
      SHARE_LIST_COPY.lede(['Andi'], 'Family'),
      SHARE_LIST_COPY.accountsFooter(['Andi'], 'Family'),
      SHARE_LIST_COPY.netWorthOff,
      SHARE_LIST_COPY.invitesFooter(['Andi'], 'Family'),
      SHARE_LIST_COPY.workspaceFooter('Family'),
      SHARE_LIST_COPY.reviewBody('joint', ['Andi']),
      SHARE_LIST_COPY.reviewBody('separate', ['Andi']),
      SHARE_LIST_COPY.noName('Bali trip'),
      SHARE_LIST_COPY.keptHeader('Bali trip'),
      EVENT_LOCKED,
      NOT_SHARED_YET,
    ];
    for (const line of strings) expect(line).not.toMatch(/\byou(r)?\b/i);
  });

  it('month of a day', () => {
    expect(monthOf('2026-01-31')).toBe('Jan');
    expect(monthOf('')).toBeNull();
  });
});
