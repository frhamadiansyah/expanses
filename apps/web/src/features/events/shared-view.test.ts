import { formatMinor } from '@expanses/core';
import type { AccountRow, SharedEventTransferView, SharedEventView, SharedExpenseView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  balanceLine,
  expenseRow,
  balanceBars,
  dayGroups,
  heroCards,
  listedRecords,
  pickedDays,
  signedBalance,
  spendingSlices,
  mineToSettle,
  moneyAccounts,
  pageLocks,
  paymentLine,
  possessive,
  readOnlyLine,
  settlementDeletable,
  settlementRow,
  sharedWithText,
  takeOverBatches,
  takeOverRows,
  transferRow,
  waitingLine,
} from './shared-view';

/*
 * The words of a shared event's page (shared events §6, §7). Every line names a person; none says "you". Figures are
 * written by `formatMinor`, as every screen writes them.
 */

const view = (over: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: 'ev', bookId: 'book', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, splitCosts: true, planOff: false, state: 'active',
  me: 'p-rina', myName: 'Rina', people: [], categories: [], expenses: [], settlements: [], spentMinor: 1_260_000, myShareMinor: 420_000,
  payments: [
    { fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 290_000 },
    { fromPersonId: 'p-budi', fromName: 'Budi', toPersonId: 'p-dewi', toName: 'Dewi', amountMinor: 190_000 },
  ],
  waiting: [], currencyLocked: true, transfers: [], ...over,
});

const expense = {
  expenseId: 'e1', occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', eventAmountMinor: 283_500, payerPersonId: 'p-andi', payerName: 'Andi',
  payerHasAccount: true, categoryId: 'c', categoryName: 'Dinners', note: 'Fish dinner', split: { mode: 'equal' as const, people: ['p-rina', 'p-andi', 'p-budi'] },
  splitText: 'Equal · 3 people', myShareMinor: 3_000, myShareEventMinor: 94_500, voided: false, unsent: true, payerOnly: true,
  posting: { transactionId: 't', unposted: null, changedByName: 'Andi', accountCurrency: null },
};

describe('shared event words', () => {
  it('puts an apostrophe after a name ending in s', () => {
    expect(possessive('Andis')).toBe("Andis'");
  });

  it('says who it is shared with, by count', () => {
    expect(sharedWithText(2)).toBe('Shared with 2 people');
    expect(sharedWithText(1)).toBe('Shared with 1 person');
    expect(sharedWithText(0)).toBe('Shared, nobody else in it yet');
  });

  it('writes a spending row in its own currency, with who paid, the split, the share and its flags', () => {
    expect(expenseRow(expense, view())).toEqual({
      title: 'Dinners',
      detail: 'Fish dinner · Andi paid · Equal · 3 people',
      amount: formatMinor(9_000, 'EUR'),
      share: `share ${formatMinor(3_000, 'EUR')}`,
      flags: ['Not sent yet', 'Changed by Andi'],
    });
    expect(expenseRow({ ...expense, myShareMinor: 0, unsent: false, voided: true, posting: { transactionId: null, unposted: 'choose-account', changedByName: null, accountCurrency: null } }, view()).flags).toEqual([
      'Deleted',
      "Not in Rina's books yet",
    ]);
  });

  it('flags an unreadable expense "Needs fixing" with its reason, and shows no figure', () => {
    const row = expenseRow({ ...expense, myShareMinor: 0, unreadable: 'The split does not add up to the amount' }, view());
    expect(row.amount).toBe('');
    expect(row.share).toBeNull();
    expect(row.flags[0]).toBe('Needs fixing: The split does not add up to the amount');
  });

  it('writes a settle-up, a balance and a suggested payment by name', () => {
    const s = { settlementId: 's', occurredOn: '2026-10-12', fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 290_000, voided: false, unsent: false, mine: true, posting: null };
    expect(settlementRow(s, view())).toEqual({ title: 'Andi paid Rina', amount: formatMinor(290_000, 'TRY'), flags: [] });
    const person = { personId: 'p-andi', name: 'Andi', initials: 'A', hasApp: true, isMe: false, removed: false, balanceMinor: -290_000 };
    expect(balanceLine(person, 'TRY')).toBe(`Andi owes ${formatMinor(290_000, 'TRY')}`);
    expect(balanceLine({ ...person, balanceMinor: 480_000 }, 'TRY')).toBe(`Andi is owed ${formatMinor(480_000, 'TRY')}`);
    expect(balanceLine({ ...person, balanceMinor: 0 }, 'TRY')).toBe('Andi is settled');
    expect(paymentLine(view().payments[0]!, 'TRY')).toBe(`Andi pays Rina ${formatMinor(290_000, 'TRY')}`);
  });

  it('offers Settle up only on the payments this person is in, and counts what waits for an account', () => {
    expect(mineToSettle(view()).map((p) => p.fromName)).toEqual(['Andi']);
    expect(waitingLine(view())).toBeNull();
    expect(waitingLine(view({ waiting: [{ recordId: 'a', kind: 'expense', reason: 'choose-account' }, { recordId: 'b', kind: 'settlement', reason: 'choose-account' }, { recordId: 'c', kind: 'expense', reason: 'no-rate' }] }))).toBe(
      "2 records are not in Rina's books yet",
    );
  });

  it('offers money accounts and cards that are open', () => {
    const account = (id: string, kind: string, subtype: string, archivedAt: string | null = null) => ({ id, kind, subtype, archivedAt, name: id, currency: 'IDR' }) as unknown as AccountRow;
    expect(moneyAccounts([account('bank', 'asset', 'bank'), account('card', 'liability', 'credit_card'), account('trip', 'asset', 'event_balance'), account('old', 'asset', 'cash', '2026-01-01'), account('food', 'expense', 'category')]).map((a) => a.id)).toEqual(['bank', 'card']);
  });

  it('locks a Done event’s writes, and every write of an event this person is no longer in (I5)', () => {
    expect(pageLocks(view())).toEqual({ readOnly: false, locked: false });
    expect(pageLocks(view({ finishedAt: '2026-10-13T00:00:00Z' }))).toEqual({ readOnly: false, locked: true });
    expect(pageLocks(view({ state: 'unshared' }))).toEqual({ readOnly: true, locked: true });
    expect(readOnlyLine(view())).toBe('Rina is no longer in Coast week. What was recorded is kept here, read-only.');
  });

  it('lets the payer or the receiver delete a settle-up, or anyone when neither has the app (R11)', () => {
    const s = { settlementId: 's', occurredOn: '2026-10-12', fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-budi', toName: 'Budi', amountMinor: 1_900, voided: false, unsent: false, mine: false, posting: null };
    const person = (personId: string, hasApp: boolean) => ({ personId, name: personId, initials: 'X', hasApp, isMe: false, removed: false, balanceMinor: 0 });
    expect(settlementDeletable(s, view({ people: [person('p-andi', false), person('p-budi', false)] }))).toBe(true);
    expect(settlementDeletable(s, view({ people: [person('p-andi', true), person('p-budi', false)] }))).toBe(false);
    expect(settlementDeletable({ ...s, mine: true }, view({ people: [person('p-andi', true)] }))).toBe(true);
    expect(settlementDeletable({ ...s, mine: true, voided: true }, view())).toBe(false);
  });

  it('lists each waiting record with its own way: From for what was paid, Into for a settle-up received (I4)', () => {
    const settlement = { settlementId: 's1', occurredOn: '2026-10-12', fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 290_000, voided: false, unsent: false, mine: true, posting: null };
    const paid = { ...settlement, settlementId: 's2', fromPersonId: 'p-rina', fromName: 'Rina', toPersonId: 'p-budi', toName: 'Budi' };
    const v = view({
      expenses: [{ ...expense, expenseId: 'e1' }],
      settlements: [settlement, paid],
      waiting: [
        { recordId: 'e1', kind: 'expense', reason: 'choose-account' },
        { recordId: 's1', kind: 'settlement', reason: 'choose-account' },
        { recordId: 's2', kind: 'settlement', reason: 'choose-account' },
        { recordId: 'e9', kind: 'expense', reason: 'no-rate' },
      ],
    });
    const rows = takeOverRows(v);
    expect(rows).toEqual([
      { recordId: 'e1', title: 'Fish dinner', amount: formatMinor(9_000, 'EUR'), direction: 'From' },
      { recordId: 's1', title: 'Andi paid Rina', amount: formatMinor(290_000, 'TRY'), direction: 'Into' },
      { recordId: 's2', title: 'Rina paid Budi', amount: formatMinor(290_000, 'TRY'), direction: 'From' },
    ]);
    // Each its own account; a record not picked takes the last one picked.
    expect(takeOverBatches(rows, { e1: 'cash', s1: 'bank' }, 'bank')).toEqual([
      { accountId: 'cash', recordIds: ['e1'] },
      { accountId: 'bank', recordIds: ['s1', 's2'] },
    ]);
    expect(() => takeOverBatches(rows, {}, '')).toThrow('Choose an account for Fish dinner');
  });
});

describe('the ring, the days and the bars of a shared event', () => {
  const e = (over: Record<string, unknown>) => ({ ...expense, unsent: false, posting: null, ...over }) as unknown as SharedExpenseView;
  const categories = [
    { categoryId: 'c-stay', name: 'Stay', icon: null, archived: false },
    { categoryId: 'c-food', name: 'Food', icon: null, archived: false },
  ];

  it('slices spending by event category, largest first, with no category as Other and deleted or unreadable left out', () => {
    const slices = spendingSlices({
      categories,
      expenses: [
        e({ expenseId: '1', categoryId: 'c-food', eventAmountMinor: 100 }),
        e({ expenseId: '2', categoryId: 'c-stay', eventAmountMinor: 500 }),
        e({ expenseId: '3', categoryId: 'c-food', eventAmountMinor: 250 }),
        e({ expenseId: '4', categoryId: null, categoryName: null, eventAmountMinor: 40 }),
        e({ expenseId: '5', categoryId: 'c-stay', eventAmountMinor: 900, voided: true }),
        e({ expenseId: '6', categoryId: 'c-stay', eventAmountMinor: 900, unreadable: 'bad split' }),
      ],
    });
    expect(slices).toEqual([
      { key: 'c-stay', label: 'Stay', totalMinor: 500 },
      { key: 'c-food', label: 'Food', totalMinor: 350 },
      { key: 'none', label: 'Other', totalMinor: 40 },
    ]);
    expect(spendingSlices({ categories, expenses: [] })).toEqual([]);
  });

  it('takes a refund from its category’s slice and drops a category refunded to nothing', () => {
    const slices = spendingSlices({
      categories,
      expenses: [
        e({ expenseId: '1', categoryId: 'c-food', eventAmountMinor: 600 }),
        e({ expenseId: '2', categoryId: 'c-food', eventAmountMinor: -200, amountMinor: -200 }),
        e({ expenseId: '3', categoryId: 'c-stay', eventAmountMinor: 500 }),
        e({ expenseId: '4', categoryId: 'c-stay', eventAmountMinor: -500, amountMinor: -500 }),
      ],
    });
    expect(slices).toEqual([{ key: 'c-food', label: 'Food', totalMinor: 400 }]);
  });

  it('writes a refund row as "Refund · item", below zero, with a negative share', () => {
    const row = expenseRow({ ...expense, amountMinor: -3_000, eventAmountMinor: -94_500, myShareMinor: -1_000, note: 'Fish dinner', unsent: false, payerOnly: false }, view());
    expect(row.title).toBe('Dinners');
    expect(row.detail).toBe('Refund · Fish dinner · Andi paid · Equal · 3 people');
    expect(row.amount).toBe(formatMinor(-3_000, 'EUR'));
    expect(row.share).toBe(`share ${formatMinor(-1_000, 'EUR')}`);
    expect(expenseRow({ ...expense, amountMinor: -3_000, note: 'Refund · Fish dinner' }, view()).detail).toMatch(/^Refund · Fish dinner · /);
    expect(expenseRow({ ...expense, amountMinor: -3_000, note: null }, view()).detail).toMatch(/^Refund · Andi paid/);
  });

  it('titles a spending row by its category as the ring names it, Other when it has none', () => {
    const named = view({ categories: [{ categoryId: 'c', name: 'Meals', icon: 'utensils', archived: false }] });
    expect(expenseRow(expense, named).title).toBe('Meals');
    expect(expenseRow({ ...expense, categoryId: null, categoryName: null }, view()).title).toBe('Other');
    expect(expenseRow({ ...expense, note: null }, view()).detail).toBe('Andi paid · Equal · 3 people');
  });

  it('groups records by day, newest first, with the day spending and settle-ups after the spending', () => {
    const s = { settlementId: 's', occurredOn: '2026-10-07', fromPersonId: 'a', fromName: 'Lestari', toPersonId: 'b', toName: 'Maya', amountMinor: 10, voided: false, unsent: false, mine: true, posting: null };
    const days = dayGroups({
      expenses: [e({ expenseId: '1', occurredOn: '2026-10-06', eventAmountMinor: 100 }), e({ expenseId: '2', occurredOn: '2026-10-07', eventAmountMinor: 30 }), e({ expenseId: '3', occurredOn: '2026-10-07', eventAmountMinor: 70, voided: true })],
      settlements: [s],
    });
    expect(days.map((d) => d.date)).toEqual(['2026-10-07', '2026-10-06']);
    expect(days[0]!.spentMinor).toBe(30);
    expect(days[0]!.items.map((i) => i.kind)).toEqual(['expense', 'expense', 'settlement']);
    expect(days[1]!.spentMinor).toBe(100);
  });

  it('narrows the days to a picked category, none included, dropping settle-ups and empty days and recounting the totals', () => {
    const s = { settlementId: 's', occurredOn: '2026-10-07', fromPersonId: 'a', fromName: 'Lestari', toPersonId: 'b', toName: 'Maya', amountMinor: 10, voided: false, unsent: false, mine: true, posting: null };
    const days = dayGroups({
      expenses: [
        e({ expenseId: '1', occurredOn: '2026-10-06', categoryId: 'c-food', eventAmountMinor: 100 }),
        e({ expenseId: '2', occurredOn: '2026-10-07', categoryId: 'c-food', eventAmountMinor: 30 }),
        e({ expenseId: '3', occurredOn: '2026-10-07', categoryId: 'c-stay', eventAmountMinor: 70 }),
        e({ expenseId: '4', occurredOn: '2026-10-07', categoryId: null, categoryName: null, eventAmountMinor: 5 }),
      ],
      settlements: [s],
    });
    expect(pickedDays(days, null)).toEqual(days);
    const food = pickedDays(days, 'c-food');
    expect(food.map((d) => [d.date, d.spentMinor, d.items.length])).toEqual([['2026-10-07', 30, 1], ['2026-10-06', 100, 1]]);
    const stay = pickedDays(days, 'c-stay');
    expect(stay.map((d) => [d.date, d.spentMinor])).toEqual([['2026-10-07', 70]]);
    const none = pickedDays(days, 'none');
    expect(none.map((d) => [d.date, d.spentMinor])).toEqual([['2026-10-07', 5]]);
    expect(none[0]!.items.every((i) => i.kind === 'expense')).toBe(true);
  });

  it('lists a household transfer on its day after the spending, counted in no day total and in no picked category', () => {
    const t: SharedEventTransferView = { transferId: 't1', occurredOn: '2026-10-07', amountMinor: 1_850_000, currency: 'IDR', description: 'ATM withdrawal', recordedByName: 'Lestari', fromName: 'Joint bank', toName: 'Wallet', transactionId: 'tx1' };
    const days = dayGroups({ expenses: [e({ expenseId: '2', occurredOn: '2026-10-07', categoryId: 'c-food', eventAmountMinor: 30 })], settlements: [], transfers: [t, { ...t, transferId: 't2', occurredOn: '2026-10-05' }] });
    expect(days.map((d) => [d.date, d.spentMinor, d.items.map((i) => i.kind)])).toEqual([
      ['2026-10-07', 30, ['expense', 'transfer']],
      ['2026-10-05', 0, ['transfer']],
    ]);
    expect(pickedDays(days, 'c-food').map((d) => d.items.map((i) => i.kind))).toEqual([['expense']]);
  });

  it('writes a listed transfer grey: its description, the two accounts, not counted, no share', () => {
    const t: SharedEventTransferView = { transferId: 't1', occurredOn: '2026-10-07', amountMinor: 1_850_000, currency: 'IDR', description: 'ATM withdrawal', recordedByName: 'Lestari', fromName: 'Joint bank', toName: 'Wallet', transactionId: 'tx1' };
    expect(transferRow(t)).toEqual({ title: 'ATM withdrawal', subtitle: 'Joint bank → Wallet · not counted', amount: formatMinor(1_850_000, 'IDR') });
    expect(transferRow({ ...t, description: ' ', toName: null }).title).toBe('Transfer');
    expect(transferRow({ ...t, toName: null }).subtitle).toBe('From Joint bank · not counted');
    expect(transferRow({ ...t, fromName: null }).subtitle).toBe('To Wallet · not counted');
    // The partner's phone names no private account: who recorded it instead.
    expect(transferRow({ ...t, fromName: null, toName: null, transactionId: null }).subtitle).toBe('Recorded by Lestari · not counted');
    for (const line of Object.values(transferRow(t))) expect(line).not.toMatch(/\byou(r)?\b/i);
  });

  it('titles a transfer by what its accounts make it, the note moving to the grey line', () => {
    const t: SharedEventTransferView = { transferId: 't1', occurredOn: '2026-10-04', amountMinor: 250_000, currency: 'TRY', description: 'Bank Contoh ATM', recordedByName: 'Lestari', fromName: 'Joint bank', toName: 'Cash TRY', transactionId: 'tx1', name: 'Cash withdrawal' };
    expect(transferRow(t)).toEqual({ title: 'Cash withdrawal', subtitle: 'Bank Contoh ATM · Joint bank → Cash TRY · not counted', amount: formatMinor(250_000, 'TRY') });
    expect(transferRow({ ...t, description: 'Transfer' }).subtitle).toBe('Joint bank → Cash TRY · not counted');
    expect(transferRow({ ...t, name: null }).title).toBe('Bank Contoh ATM');
  });

  it('scales the balance bars to the largest, tones them, and leaves out people who left', () => {
    const p = (personId: string, balanceMinor: number, removed = false) => ({ personId, name: personId, initials: 'x', hasApp: true, isMe: false, removed, balanceMinor });
    const bars = balanceBars({ people: [p('maya', 2_100), p('yoga', 2_650), p('dimas', -900), p('lestari', -1_950), p('gone', 99_999, true), p('even', 0)] });
    expect(bars.map((b) => [b.personId, b.percent, b.tone])).toEqual([
      ['maya', 79, 'ahead'],
      ['yoga', 100, 'ahead'],
      ['dimas', 34, 'owing'],
      ['lestari', 74, 'owing'],
      ['even', 0, 'settled'],
    ]);
    expect(balanceBars({ people: [p('a', 0)] })[0]!.percent).toBe(0);
  });

  it('signs a balance', () => {
    expect(signedBalance(900, 'THB')).toBe(`+${formatMinor(900, 'THB')}`);
    expect(signedBalance(-900, 'THB')).toBe(`−${formatMinor(900, 'THB')}`);
    expect(signedBalance(0, 'THB')).toBe('Settled');
  });
});

describe('Split costs and Plan (owner, 14 Nov 2026)', () => {
  it('swipes through Spending always, Balances while it splits costs, Plan while the plan is on', () => {
    expect(heroCards({ splitCosts: true, planOff: false })).toEqual(['spending', 'balances', 'plan']);
    expect(heroCards({ splitCosts: false, planOff: false })).toEqual(['spending', 'plan']);
    expect(heroCards({ splitCosts: true, planOff: true })).toEqual(['spending', 'balances']);
    expect(heroCards({ splitCosts: false, planOff: true })).toEqual(['spending']);
  });

  it('in one pot a row says the place, who paid and with what, and has no share', () => {
    const own = { ...expense, payerPersonId: 'p-rina', payerName: 'Rina', posting: { ...expense.posting, accountName: 'Rina Bank' } };
    expect(expenseRow(own, view({ splitCosts: false }))).toMatchObject({ detail: 'Fish dinner · Rina · Rina Bank', share: null });
    // The partner's card is not known on this phone: who paid, alone.
    expect(expenseRow(expense, view({ splitCosts: false }))).toMatchObject({ detail: 'Fish dinner · Andi', share: null });
    expect(expenseRow(expense, view()).share).not.toBeNull();
  });

  it('in one pot the settle-ups leave the day cards; switched on, they are back', () => {
    const settlement = { settlementId: 's1', occurredOn: '2026-10-06', fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 100, voided: false, unsent: false, mine: true, posting: null };
    expect(dayGroups(listedRecords(view({ splitCosts: false, settlements: [settlement] })))).toEqual([]);
    expect(dayGroups(listedRecords(view({ settlements: [settlement] })))[0]!.items).toHaveLength(1);
  });
});
