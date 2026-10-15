import { formatMinor } from '@expanses/core';
import type { AccountRow, SharedEventView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  balanceLine,
  expenseRow,
  headerLine,
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
  waitingLine,
} from './shared-view';

/*
 * The words of a shared event's page (shared events §6, §7). Every line names a person; none says "you". Figures are
 * written by `formatMinor`, as every screen writes them.
 */

const view = (over: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: 'ev', bookId: 'book', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, state: 'active',
  me: 'p-rina', myName: 'Rina', people: [], categories: [], expenses: [], settlements: [], spentMinor: 1_260_000, myShareMinor: 420_000,
  payments: [
    { fromPersonId: 'p-andi', fromName: 'Andi', toPersonId: 'p-rina', toName: 'Rina', amountMinor: 290_000 },
    { fromPersonId: 'p-budi', fromName: 'Budi', toPersonId: 'p-dewi', toName: 'Dewi', amountMinor: 190_000 },
  ],
  waiting: [], currencyLocked: true, ...over,
});

const expense = {
  expenseId: 'e1', occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', eventAmountMinor: 283_500, payerPersonId: 'p-andi', payerName: 'Andi',
  payerHasAccount: true, categoryId: 'c', categoryName: 'Dinners', note: 'Fish dinner', split: { mode: 'equal' as const, people: ['p-rina', 'p-andi', 'p-budi'] },
  splitText: 'Equal · 3 people', myShareMinor: 3_000, myShareEventMinor: 94_500, voided: false, unsent: true, payerOnly: true,
  posting: { transactionId: 't', unposted: null, changedByName: 'Andi', accountCurrency: null },
};

describe('shared event words', () => {
  it('reads the header as what was spent and this person’s share', () => {
    expect(headerLine(view())).toBe(`Spent ${formatMinor(1_260_000, 'TRY')} · Rina's share ${formatMinor(420_000, 'TRY')}`);
    expect(possessive('Andis')).toBe("Andis'");
  });

  it('says who it is shared with, by count', () => {
    expect(sharedWithText(2)).toBe('Shared with 2 people');
    expect(sharedWithText(1)).toBe('Shared with 1 person');
    expect(sharedWithText(0)).toBe('Shared, nobody else in it yet');
  });

  it('writes a spending row in its own currency, with who paid, the category, the split, the share and its flags', () => {
    expect(expenseRow(expense, view())).toEqual({
      title: 'Fish dinner',
      detail: 'Andi paid · Dinners · Equal · 3 people',
      amount: formatMinor(9_000, 'EUR'),
      share: `Rina's share ${formatMinor(3_000, 'EUR')}`,
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
