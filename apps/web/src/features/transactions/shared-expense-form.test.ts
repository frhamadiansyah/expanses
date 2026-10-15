import { formatMinor } from '@expanses/core';
import type { AccountRow, SharedEventView, SharedExpenseView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { draftFromExpense, emptySharedDraft, moneyLocked, payerChoices, sharedDraftToInput, sharedDraftToPatch, splitPreview, splitSummary, suggestedRate } from './shared-expense-form';

/*
 * The Add screen in a shared event (shared events §6): Paid by this person (with an account) or a person without the
 * app (R13); Split equal over the ticked people or by amount; the event's categories; any currency with its rate to the
 * event's. Coast week is in lira; Rina's phone.
 */

const view: SharedEventView = {
  eventId: 'ev', bookId: 'b', name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null, state: 'active', me: 'p-rina', myName: 'Rina',
  people: [
    { personId: 'p-rina', name: 'Rina', initials: 'R', hasApp: true, isMe: true, removed: false, balanceMinor: 0 },
    { personId: 'p-andi', name: 'Andi', initials: 'A', hasApp: true, isMe: false, removed: false, balanceMinor: 0 },
    { personId: 'p-budi', name: 'Budi', initials: 'B', hasApp: false, isMe: false, removed: false, balanceMinor: 0 },
    { personId: 'p-eko', name: 'Eko', initials: 'E', hasApp: false, isMe: false, removed: true, balanceMinor: 0 },
  ],
  categories: [{ categoryId: 'cat-dinners', name: 'Dinners', icon: null, archived: false }],
  expenses: [], settlements: [], spentMinor: 0, myShareMinor: 0, payments: [], waiting: [], currencyLocked: false,
};
const accounts = [
  { id: 'wallet', name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR', archivedAt: null },
  { id: 'card', name: 'Travel card', kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null },
] as unknown as AccountRow[];

describe('the shared Add screen', () => {
  it('opens on this person paying, everyone still in the event ticked, in the event currency at rate 1', () => {
    const draft = emptySharedDraft(view, '2026-10-06');
    expect(draft).toMatchObject({ occurredOn: '2026-10-06', currency: 'TRY', rate: '1', payer: 'p-rina', splitMode: 'equal', ticked: ['p-rina', 'p-andi', 'p-budi'] });
    expect(splitSummary(draft)).toBe('Equal · 3 people');
  });

  it('offers this person and the people without the app as the payer (R13)', () => {
    expect(payerChoices(view)).toEqual([
      { personId: 'p-rina', label: 'Rina (this phone)' },
      { personId: 'p-budi', label: 'Budi' },
    ]);
  });

  it('suggests the rate to the event currency through the base currency', () => {
    expect(suggestedRate('EUR', 'TRY', 'IDR', { EUR: 17_640, TRY: 560 })).toBe('31.5');
    expect(suggestedRate('TRY', 'TRY', 'IDR', {})).toBe('1');
    expect(suggestedRate('EUR', 'TRY', 'IDR', { EUR: 17_640 })).toBeNull();
  });

  it('builds a euro dinner paid from the euro wallet, split three ways', () => {
    const draft = { ...emptySharedDraft(view, '2026-10-06'), note: 'Fish dinner', amount: '90', currency: 'EUR', rate: '31,5', accountId: 'wallet', categoryId: 'cat-dinners' };
    expect(sharedDraftToInput(draft, view, accounts)).toEqual({
      occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', payerPersonId: 'p-rina',
      paidFrom: { accountId: 'wallet', chargedMinor: null }, split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] }, categoryId: 'cat-dinners', note: 'Fish dinner',
    });
  });

  it('asks what a card in another currency was charged, and takes amounts that add up', () => {
    const base = { ...emptySharedDraft(view, '2026-10-06'), amount: '300', accountId: 'card' };
    expect(() => sharedDraftToInput(base, view, accounts)).toThrow('Enter what Travel card was charged in IDR');
    expect(sharedDraftToInput({ ...base, charged: '168000' }, view, accounts).paidFrom).toEqual({ accountId: 'card', chargedMinor: 168_000 });
    const byAmount = { ...base, charged: '168000', splitMode: 'amounts' as const, amounts: { 'p-rina': '100', 'p-andi': '150' } };
    expect(() => sharedDraftToInput(byAmount, view, accounts)).toThrow(`The amounts add up to ${formatMinor(25_000, 'TRY')}, not ${formatMinor(30_000, 'TRY')}`);
    expect(sharedDraftToInput({ ...byAmount, amounts: { 'p-rina': '100', 'p-andi': '200' } }, view, accounts).split).toEqual({ mode: 'amounts', shares: [{ personId: 'p-rina', minor: 10_000 }, { personId: 'p-andi', minor: 20_000 }] });
  });

  it('records Budi’s payment with no account', () => {
    const draft = { ...emptySharedDraft(view, '2026-10-07'), amount: '1800', payer: 'p-budi', ticked: ['p-rina', 'p-budi'] };
    expect(sharedDraftToInput(draft, view, accounts)).toMatchObject({ payerPersonId: 'p-budi', paidFrom: null, split: { mode: 'equal', people: ['p-rina', 'p-budi'] } });
  });

  it('opens an expense another member paid with its money locked, and edits only what changed', () => {
    const andis: SharedExpenseView = {
      expenseId: 'e1', occurredOn: '2026-10-08', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', eventAmountMinor: 60_000, payerPersonId: 'p-andi', payerName: 'Andi', payerHasAccount: true,
      categoryId: null, categoryName: null, note: 'Boat', split: { mode: 'equal', people: ['p-rina', 'p-andi'] }, splitText: 'Equal · 2 people', myShareMinor: 30_000, myShareEventMinor: 30_000,
      voided: false, unsent: false, payerOnly: true, posting: null,
    };
    expect(moneyLocked(andis)).toBe('Only Andi changes the amount, currency, rate or date of what Andi paid');
    const draft = draftFromExpense(view, andis);
    expect(draft).toMatchObject({ amount: '600.00', currency: 'TRY', payer: 'p-andi', ticked: ['p-rina', 'p-andi'], note: 'Boat' });
    expect(sharedDraftToPatch({ ...draft, ticked: ['p-andi'] }, { ...view, expenses: [andis] }, 'e1')).toEqual({ split: { mode: 'equal', people: ['p-andi'] } });
  });

  it('rounds cents on a whole-unit currency up, as the Add screen does (B2), and carries a card', () => {
    const rupiah: SharedEventView = { ...view, currency: 'IDR' };
    const draft = { ...emptySharedDraft(rupiah, '2026-10-06'), amount: '12500.30', accountId: 'card', cardId: 'travel-card' };
    expect(sharedDraftToInput(draft, rupiah, accounts)).toMatchObject({ amountMinor: 12_501, currency: 'IDR', paidFrom: { accountId: 'card', chargedMinor: null, cardId: 'travel-card' } });
  });

  it('opens this person’s own payment on what the account was charged, and sends a new charge only when it changed', () => {
    const mine: SharedExpenseView = {
      expenseId: 'e2', occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', eventAmountMinor: 283_500, payerPersonId: 'p-rina', payerName: 'Rina', payerHasAccount: true,
      categoryId: 'cat-dinners', categoryName: 'Dinners', note: 'Fish dinner', split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] }, splitText: 'Equal · 3 people', myShareMinor: 3_000, myShareEventMinor: 94_500,
      voided: false, unsent: false, payerOnly: false, posting: { transactionId: 't2', unposted: null, changedByName: null, accountCurrency: 'IDR', accountId: 'card', accountAmountMinor: 1_587_600 },
    };
    expect(moneyLocked(mine)).toBeNull();
    const draft = draftFromExpense(view, mine);
    expect(draft).toMatchObject({ amount: '90.00', currency: 'EUR', rate: '31.5', accountId: 'card', charged: '1587600' });
    const changedView = { ...view, expenses: [mine] };
    expect(sharedDraftToPatch({ ...draft, note: 'Fish dinner by the sea' }, changedView, 'e2')).toEqual({ note: 'Fish dinner by the sea' });
    expect(sharedDraftToPatch({ ...draft, amount: '100', charged: '1764000' }, changedView, 'e2')).toEqual({ amountMinor: 10_000, chargedMinor: 1_764_000 });
  });

  it('asks for the rate of another currency, and reads a typed comma', () => {
    const draft = { ...emptySharedDraft(view, '2026-10-06'), amount: '90', currency: 'EUR', rate: '', accountId: 'wallet' };
    expect(() => sharedDraftToInput(draft, view, accounts)).toThrow('Enter the rate: TRY per 1 EUR');
    expect(sharedDraftToInput({ ...draft, rate: '31,25' }, view, accounts).rateToEvent).toBe('31.25');
  });

  it('refuses a split with nobody ticked', () => {
    const draft = { ...emptySharedDraft(view, '2026-10-06'), amount: '90', accountId: 'wallet', currency: 'EUR', rate: '31.5', ticked: [] };
    expect(() => sharedDraftToInput(draft, view, accounts)).toThrow('Tick at least one person to share it');
  });

  it('previews each share as it will be recorded, and what is left to type by amount', () => {
    const draft = { ...emptySharedDraft(view, '2026-10-06'), amount: '100' };
    // 10,000 kuruş over three: 3,334 to Rina, who paid, and 3,333 each to the others.
    expect(splitPreview(draft)).toEqual({ shares: { 'p-rina': 3_334, 'p-andi': 3_333, 'p-budi': 3_333 }, leftMinor: 0 });
    expect(splitPreview({ ...draft, splitMode: 'amounts', amounts: { 'p-rina': '40', 'p-andi': '' } })).toEqual({ shares: { 'p-rina': 4_000 }, leftMinor: 6_000 });
    expect(splitPreview({ ...draft, amount: '' })).toBeNull();
  });
});
