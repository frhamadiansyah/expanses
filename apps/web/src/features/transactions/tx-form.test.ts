import { evaluateAmount, expenseLines, parseMajor } from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  amountAfterEnter,
  canEditInSheet,
  chargedHint,
  chargedInNeeded,
  emptyForm,
  extraRows,
  type FormDraft,
  formFromTransaction,
  formToPost,
  KEYPAD_KEYS,
  keypadPress,
  recentCurrencies,
  suggestedRate,
} from './tx-form';

const accounts = [
  { id: 'acct-bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
  { id: 'acct-card', name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'acct-cny', name: 'Alipay', kind: 'asset', subtype: 'cash', currency: 'CNY' },
  { id: 'cat-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null },
] as AccountRow[];

/** An ordinary expense off the bank account: the case every other draft below is a variation on. */
const draft: FormDraft = {
  ...emptyForm('ws-1'),
  moneyId: 'acct-bank',
  categoryId: 'cat-restaurants',
  amount: '120000',
  currency: 'IDR',
  description: 'Warung Steak',
  occurredOn: '2026-09-17',
};
/** The same expense typed in CNY off an IDR account, so C2's "Charged in IDR" row applies. */
const foreign: FormDraft = { ...draft, currency: 'CNY', amount: '120', chargedAmount: '272400' };
/** A transfer with no From chosen yet, for the error message. */
const transfer: FormDraft = { ...emptyForm('ws-1'), mode: 'transfer', toId: 'acct-card', amount: '500000' };

/** Four views built the way `dinner()` is in receipt-view.test.ts: only the facts each assertion turns on. */
const view = (over: Partial<TransactionView>): TransactionView =>
  ({
    id: 'tx-1',
    occurredOn: '2026-09-17',
    description: 'Dinner',
    status: 'posted',
    originalCurrency: null,
    originalAmountMinor: null,
    mcc: null,
    cardId: null,
    entries: [],
    ...over,
  }) as TransactionView;

const paid = (amountMinor: number, currency = 'IDR') => ({
  accountId: 'acct-card',
  accountKind: 'liability',
  accountName: 'BCA KrisFlyer',
  amountMinor,
  amountBaseMinor: amountMinor,
  currency,
});
const spent = (accountId: string, amountMinor: number, currency = 'IDR') => ({
  accountId,
  accountKind: 'expense',
  accountName: 'Restaurants',
  amountMinor,
  amountBaseMinor: amountMinor,
  currency,
});

const plainExpense = view({ entries: [paid(-400_000), spent('cat-restaurants', 400_000)] as TransactionView['entries'] });
const splitPurchase = view({
  entries: [paid(-400_000), spent('cat-restaurants', 250_000), spent('cat-groceries', 150_000)] as TransactionView['entries'],
});
const transferTx = view({
  entries: [
    paid(-500_000),
    { accountId: 'acct-bank', accountKind: 'asset', accountName: 'BCA Tahapan', amountMinor: 500_000, amountBaseMinor: 500_000, currency: 'IDR' },
  ] as TransactionView['entries'],
});
const foreignPurchase = view({
  originalCurrency: 'CNY',
  originalAmountMinor: 12_000,
  entries: [paid(-272_400), spent('cat-restaurants', 272_400)] as TransactionView['entries'],
});

describe('what the form adds up to', () => {
  // `formToPost` returns a discriminated result, so every assertion about what was built reaches through `input`.
  it('builds an expense exactly as the old form did', () => {
    expect(formToPost(draft, accounts)).toMatchObject({
      kind: 'post',
      input: { lines: expenseLines({ categoryAccountId: 'cat-restaurants', paymentAccountId: 'acct-bank', amountMinor: 120_000, currency: 'IDR' }) },
    });
  });

  it('keeps the typed currency as the original, and the charged amount as the posting', () => {
    expect(formToPost(foreign, accounts)).toMatchObject({ kind: 'post', input: { originalCurrency: 'CNY', originalAmountMinor: 12_000 } });
    // The posting itself is what the account was charged, in the account's own currency — not the 120 typed.
    expect(formToPost(foreign, accounts)).toMatchObject({
      kind: 'post',
      input: { lines: expenseLines({ categoryAccountId: 'cat-restaurants', paymentAccountId: 'acct-bank', amountMinor: 272_400, currency: 'IDR' }) },
    });
  });

  it('clears the original pair when the currency is the account’s own', () => {
    expect(formToPost(draft, accounts)).toMatchObject({ kind: 'post', input: { originalCurrency: null, originalAmountMinor: null } });
  });

  it('asks for the charged amount only when the currencies differ', () => {
    expect(chargedInNeeded(foreign, accounts)).toBe(true);
    expect(chargedInNeeded(draft, accounts)).toBe(false);
    // An account paid in its own currency never asks, whichever currency that is.
    expect(chargedInNeeded({ ...draft, moneyId: 'acct-cny', currency: 'CNY' }, accounts)).toBe(false);
  });

  it('passes the channel, the exclusion, the event and the photos through', () => {
    expect(formToPost({ ...draft, channel: 'online', excluded: true, eventId: 'ev-1', photoIds: ['p1'] }, accounts)).toMatchObject({
      kind: 'post',
      input: { channel: 'online', excludedFromReport: true, eventId: 'ev-1', photoIds: ['p1'] },
    });
  });

  // Three cases, three assertions: the title promised three and one covered only the first.
  it('offers MCC only on a card, With only on a new expense, and the rate row only when one is missing', () => {
    expect(extraRows(draft, accounts, { missingRate: null })).toEqual(['event', 'split', 'with', 'channel', 'photos', 'exclude']);
    expect(extraRows({ ...draft, moneyId: 'acct-card' }, accounts, { missingRate: null })).toEqual([
      'event',
      'split',
      'with',
      'mcc',
      'channel',
      'photos',
      'exclude',
    ]);
    // Editing rather than adding: With is not offered, because splitBill posts a differently shaped transaction (§15.6).
    expect(extraRows({ ...draft, editing: true }, accounts, { missingRate: null })).toEqual(['event', 'split', 'channel', 'photos', 'exclude']);
    // The rate row is last, and only when resolveRates says one is missing.
    expect(extraRows(foreign, accounts, { missingRate: { from: 'CNY', to: 'IDR', onDate: '2026-09-17' } })).toEqual([
      'event',
      'split',
      'with',
      'channel',
      'photos',
      'exclude',
      'rate',
    ]);
  });

  it('offers a goal instead of a split on a transfer, and no channel for money that never left', () => {
    expect(extraRows({ ...transfer, moneyId: 'acct-bank' }, accounts, { missingRate: null })).toEqual(['event', 'goal', 'photos', 'exclude']);
    // A goal can only be attached as the transfer is made; correcting one does not re-tag it.
    expect(extraRows({ ...transfer, moneyId: 'acct-bank', editing: true }, accounts, { missingRate: null })).toEqual(['event', 'photos', 'exclude']);
  });

  it('sends a split with several people to splitBill, not to postTransaction', () => {
    const shared = formToPost({ ...draft, with: [{ debtAccountId: '', name: 'Andi', amount: '100000' }] }, accounts);
    expect(shared).toMatchObject({ kind: 'split' });
    // What Andi owes is what was typed, and the rest of the 120.000 stays as your own spending.
    expect(shared).toMatchObject({
      kind: 'split',
      input: { totalMinor: 120_000, ownShareMinor: 20_000, shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 100_000 }] },
    });
  });

  it('routes a transfer tagged to a goal to recordTaggedTransfer, and checks the same two accounts', () => {
    expect(formToPost({ ...transfer, moneyId: 'acct-bank', goalId: 'goal-1' }, accounts)).toMatchObject({
      kind: 'transfer-goal',
      input: { amountMinor: 500_000, fromAccountId: 'acct-bank', toAccountId: 'acct-card', goalId: 'goal-1' },
    });
    // The From/To check is the same one the untagged transfer makes — one message, both paths.
    expect(() => formToPost({ ...transfer, moneyId: 'acct-card', goalId: 'goal-1' }, accounts)).toThrow('From and To must differ');
  });

  it('leaves you the remainder when the bill is split equally and will not divide', () => {
    const shared = formToPost(
      {
        ...draft,
        amount: '100001',
        withEqually: true,
        with: [
          { debtAccountId: '', name: 'Andi', amount: '' },
          { debtAccountId: '', name: 'Putri', amount: '' },
        ],
      },
      accounts,
    );
    // floor(100001/3) = 33.333 each; the odd 2 stays with you rather than being asked of anyone.
    expect(shared).toMatchObject({
      kind: 'split',
      input: { totalMinor: 100_001, ownShareMinor: 33_335, shares: [{ amountMinor: 33_333 }, { amountMinor: 33_333 }] },
    });
  });

  it('keeps the same messages the old form threw', () => {
    expect(() => formToPost({ ...draft, categoryId: '' }, accounts)).toThrow('Choose a category');
    expect(() => formToPost({ ...transfer, moneyId: '' }, accounts)).toThrow('Choose the From account');
    expect(() => formToPost({ ...draft, mcc: '58' }, accounts)).toThrow('An MCC is four digits, like 5814');
    expect(() => formToPost({ ...transfer, moneyId: 'acct-card', toId: 'acct-card' }, accounts)).toThrow('From and To must differ');
  });

  it('asks for the charged figure by the account’s own currency, and never posts the foreign one by mistake', () => {
    expect(() => formToPost({ ...foreign, chargedAmount: '' }, accounts)).toThrow('Enter the amount charged in IDR');
  });

  it('carries a typed MCC on a card and drops it off a bank account', () => {
    expect(formToPost({ ...draft, moneyId: 'acct-card', mcc: '5814' }, accounts)).toMatchObject({ kind: 'post', input: { mcc: '5814' } });
    expect(formToPost({ ...draft, mcc: '5814' }, accounts)).toMatchObject({ kind: 'post', input: { mcc: null } });
  });

  it('says the sheet cannot hold a split, a transfer or a foreign purchase', () => {
    expect(canEditInSheet(plainExpense)).toBe(true);
    expect(canEditInSheet(splitPurchase)).toBe(false);
    expect(canEditInSheet(transferTx)).toBe(false);
    expect(canEditInSheet(foreignPurchase)).toBe(false);
  });
});

describe('what a transaction reads back as', () => {
  it('reopens a foreign purchase with the typed currency on the flag and the charge underneath', () => {
    const form = formFromTransaction(foreignPurchase, accounts);
    expect(form).toMatchObject({ currency: 'CNY', amount: '120.00', chargedAmount: '272400', editing: true });
    // And it goes back out as the same posting it came from.
    expect(formToPost({ ...form, categoryId: 'cat-restaurants' }, accounts)).toMatchObject({
      kind: 'post',
      input: { originalCurrency: 'CNY', originalAmountMinor: 12_000, lines: expenseLines({ categoryAccountId: 'cat-restaurants', paymentAccountId: 'acct-card', amountMinor: 272_400, currency: 'IDR' }) },
    });
  });

  it('reopens what was chosen beside the money', () => {
    const form = formFromTransaction(view({ ...plainExpense, channel: 'offline', excluded: true, eventId: 'ev-1' }), accounts);
    expect(form).toMatchObject({ channel: 'offline', excluded: true, eventId: 'ev-1' });
  });
});

describe('the amount row on a desktop keyboard', () => {
  it('works the expression out on Enter and holds the save back until it stops changing', () => {
    expect(amountAfterEnter('85000+15000', 'IDR')).toEqual({ text: '100000', submit: false });
    // Second Enter: the field no longer changes, so the form may save.
    expect(amountAfterEnter('100000', 'IDR')).toEqual({ text: '100000', submit: true });
  });

  it('leaves an expression it cannot read alone rather than clearing it', () => {
    expect(amountAfterEnter('85000+', 'IDR')).toEqual({ text: '85000+', submit: true });
  });

  it('reads a decimal figure the way the rest of the app does', () => {
    // The 100x bug: '10.50' in USD is ten dollars fifty, and a row that stripped the separator itself would
    // write back '1050.00'. Asserting the text it writes back is what catches that.
    expect(amountAfterEnter('10.50', 'USD')).toEqual({ text: '10.50', submit: true });
    expect(evaluateAmount('10.50', 'USD')).toBe(parseMajor('10.50', 'USD'));
    expect(amountAfterEnter('10.50×3', 'USD')).toEqual({ text: '31.50', submit: false });
  });

  it('reads the same dot as thousands where the currency has no decimals', () => {
    // The other direction of the same bug: '120.000' in IDR is a hundred and twenty thousand, not 120. Which
    // of '.' and ',' is a decimal point depends on the figure and the currency, and `parseMajor` is the only
    // thing in the app that decides it — this row must not have an opinion of its own.
    expect(amountAfterEnter('120.000', 'IDR')).toEqual({ text: '120000', submit: false });
    expect(amountAfterEnter('120.000+35.000', 'IDR')).toEqual({ text: '155000', submit: false });
  });
});

describe('the keypad', () => {
  it('lays its keys out as the dock draws them, with no Save', () => {
    expect(KEYPAD_KEYS).toEqual(['C', '÷', '×', '⌫', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', 'DONE', '0', '000', '00']);
    expect(KEYPAD_KEYS).not.toContain('Save');
  });

  it('appends, clears and backspaces what was typed', () => {
    expect(keypadPress('85', '000')).toBe('85000');
    expect(keypadPress('85000', '+')).toBe('85000+');
    expect(keypadPress('85000', '⌫')).toBe('8500');
    expect(keypadPress('85000', 'C')).toBe('');
    // ⌫ on an empty row stays empty rather than going negative.
    expect(keypadPress('', '⌫')).toBe('');
  });
});

describe('the rate the charged row suggests', () => {
  it('reads a rate against the base currency the right way round', () => {
    // 2.270 IDR per 1 CNY — not 1/2270, which would suggest the account was charged 0,05 rupiah.
    expect(suggestedRate({ rates: { CNY: 2270 }, from: 'CNY', to: 'IDR', base: 'IDR' })).toBe(2270);
  });

  it('crosses a pair that never touches the base', () => {
    expect(suggestedRate({ rates: { USD: 16_000, CNY: 2000 }, from: 'USD', to: 'CNY', base: 'IDR' })).toBe(8);
  });

  it('gives nothing rather than a guess when a leg is unknown', () => {
    expect(suggestedRate({ rates: { USD: 16_000 }, from: 'USD', to: 'CNY', base: 'IDR' })).toBeNull();
    expect(suggestedRate({ rates: {}, from: 'IDR', to: 'IDR', base: 'IDR' })).toBe(1);
  });
});

describe('the quiet line under the charged row', () => {
  it('names the rate, the day it came from and the account that charged it', () => {
    expect(chargedHint({ rate: 2270, currency: 'CNY', accountCurrency: 'IDR', onDate: '2026-09-17', accountName: 'BCA Tahapan' })).toBe(
      '≈ 2.270 per 1 CNY · suggested from 2026-09-17, change it to what BCA Tahapan charged',
    );
  });

  it('says so when no rate is known', () => {
    expect(chargedHint({ rate: null, currency: 'CNY', accountCurrency: 'IDR', onDate: '2026-09-17', accountName: 'BCA Tahapan' })).toBe(
      'No CNY→IDR rate is known for 2026-09-17. Enter what BCA Tahapan charged.',
    );
  });
});

describe('the currency sheet', () => {
  it('puts the paying account first, then the workspace, then what was used lately', () => {
    expect(recentCurrencies({ accountCurrency: 'CNY', baseCurrency: 'IDR', stored: ['USD', 'SGD', 'JPY', 'THB'] })).toEqual(['CNY', 'IDR', 'USD', 'SGD', 'JPY']);
  });

  it('never repeats one and survives an account with no currency', () => {
    expect(recentCurrencies({ accountCurrency: '', baseCurrency: 'IDR', stored: ['IDR', 'USD'] })).toEqual(['IDR', 'USD']);
  });

  it('drops a code no longer in the list', () => {
    expect(recentCurrencies({ accountCurrency: 'IDR', baseCurrency: 'IDR', stored: ['XXX', 'USD'] })).toEqual(['IDR', 'USD']);
  });
});
