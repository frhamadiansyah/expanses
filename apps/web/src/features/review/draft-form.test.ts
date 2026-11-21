import type { AccountRow, DraftRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { chargedFigure, DECIMALS_REFUSAL, emptyForm, estimatedCharge, type FormDraft } from '../transactions/tx-form';
import { canRecord, corrections, draftPatch, foreignPair, formFromDraft, quickCharge, savedWhere } from './draft-form';

const draft = (over: Partial<DraftRow> = {}): DraftRow => ({
  id: 'd1',
  source: 'screen',
  kind: 'expense',
  status: 'pending',
  rawPayload: null,
  occurredOn: '2026-09-30',
  description: 'TOKO KOPI',
  amountMinor: 38_000,
  currency: 'IDR',
  accountId: 'bank',
  toAccountId: null,
  categoryAccountId: 'cafe',
  cardId: null,
  sourceId: 's1',
  captureIds: ['c1'],
  imageFile: null,
  reading: null,
  mergedInto: null,
  confidence: 90,
  externalRef: null,
  transactionId: null,
  ...over,
});

/** What the form is read against: the accounts a draft can name, each with the currency it settles in. */
const ACCOUNTS = [
  { id: 'bank', name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR' },
  { id: 'wallet', name: 'Pay wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' },
  { id: 'visa-account', name: 'Travel card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'cafe', name: 'Cafe', kind: 'expense', subtype: 'category', currency: null },
] as AccountRow[];

/** The form as the card holds it once the prefill is spread over an empty one. */
const formOf = (row: DraftRow, over: Partial<FormDraft> = {}): FormDraft => ({ ...emptyForm('book', '2026-10-02'), ...formFromDraft(row), ...over });

describe('formFromDraft', () => {
  it('fills the Add form from what was read: kind, accounts, category, figure, note and day', () => {
    expect(formFromDraft(draft())).toEqual({
      mode: 'expense',
      occurredOn: '2026-09-30',
      description: 'TOKO KOPI',
      moneyId: 'bank',
      cardId: '',
      toId: '',
      categoryId: 'cafe',
      amount: '38000',
      currency: 'IDR',
    });
  });

  it('shows money in as a positive figure on the Income tab', () => {
    const form = formFromDraft(draft({ kind: 'income', amountMinor: -899_000, categoryAccountId: null }));
    expect(form.mode).toBe('income');
    expect(form.amount).toBe('899000');
    expect(form.categoryId).toBe('');
  });

  it('gives a transfer its To and no category, and lets the From account name the currency', () => {
    const form = formFromDraft(draft({ kind: 'transfer', toAccountId: 'wallet', categoryAccountId: null }));
    expect(form).toMatchObject({ mode: 'transfer', moneyId: 'bank', toId: 'wallet', categoryId: '', currency: '' });
  });

  it('leaves the amount empty when nothing was read, and an unknown account empty', () => {
    expect(formFromDraft(draft({ amountMinor: 0, accountId: null }))).toMatchObject({ amount: '', moneyId: '' });
  });

  it('reads cents for a currency that has them', () => {
    expect(formFromDraft(draft({ currency: 'USD', amountMinor: 1250 })).amount).toBe('12.5');
  });
});

describe('draftPatch', () => {
  it('writes an expense back as money out of the paying account', () => {
    const row = draft();
    expect(draftPatch(formOf(row, { amount: '52.000', description: ' SOTO BETAWI ' }), row, ACCOUNTS)).toEqual({
      kind: 'expense',
      accountId: 'bank',
      toAccountId: null,
      categoryAccountId: 'cafe',
      cardId: null,
      amountMinor: 52_000,
      currency: 'IDR',
      description: 'SOTO BETAWI',
      occurredOn: '2026-09-30',
    });
  });

  it('writes income back negative, the draft convention for money in', () => {
    const row = draft({ kind: 'income', amountMinor: -899_000 });
    expect(draftPatch(formOf(row), row, ACCOUNTS)).toMatchObject({ kind: 'income', amountMinor: -899_000, cardId: null });
  });

  it('writes a tab change across: an expense recorded as income turns negative', () => {
    const row = draft();
    expect(draftPatch(formOf(row, { mode: 'income' }), row, ACCOUNTS)).toMatchObject({ kind: 'income', amountMinor: -38_000 });
  });

  it('writes a transfer back positive, with its To and no category', () => {
    const row = draft({ kind: 'transfer', toAccountId: 'wallet', categoryAccountId: null });
    expect(draftPatch(formOf(row), row, ACCOUNTS)).toMatchObject({
      kind: 'transfer',
      accountId: 'bank',
      toAccountId: 'wallet',
      categoryAccountId: null,
      amountMinor: 38_000,
      currency: 'IDR',
    });
  });

  it('keeps the card a purchase was made on', () => {
    const row = draft();
    expect(draftPatch(formOf(row, { cardId: 'visa' }), row, ACCOUNTS).cardId).toBe('visa');
  });

  it('keeps the name that was read when the note is emptied', () => {
    const row = draft();
    expect(draftPatch(formOf(row, { description: '  ' }), row, ACCOUNTS).description).toBe('TOKO KOPI');
  });

  it('refuses a figure that is not a positive amount', () => {
    const row = draft();
    expect(() => draftPatch(formOf(row, { amount: '' }), row, ACCOUNTS)).toThrow(/Amount/);
    expect(() => draftPatch(formOf(row, { amount: '0' }), row, ACCOUNTS)).toThrow(/Amount/);
  });
});

describe('canRecord', () => {
  it('needs an account for spending and income; a blank category records (under Uncategorised)', () => {
    const row = draft();
    expect(canRecord(formOf(row), row, ACCOUNTS)).toBe(true);
    expect(canRecord(formOf(row, { moneyId: '' }), row, ACCOUNTS)).toBe(false);
    // One record rule with the swipe (owner 2026-11-21): Paid with and a figure, the category filed under Uncategorised.
    expect(canRecord(formOf(row, { categoryId: '' }), row, ACCOUNTS)).toBe(true);
    expect(canRecord(formOf(row, { categoryId: '', moneyId: '' }), row, ACCOUNTS)).toBe(false);
    expect(canRecord(formOf(row, { categoryId: '', amount: '' }), row, ACCOUNTS)).toBe(false);
    expect(canRecord(formOf(row, { mode: 'income' }), row, ACCOUNTS)).toBe(true);
  });

  it('needs a To, other than the From, for a transfer', () => {
    const row = draft({ kind: 'transfer', categoryAccountId: null, toAccountId: 'wallet' });
    expect(canRecord(formOf(row), row, ACCOUNTS)).toBe(true);
    expect(canRecord(formOf(row, { toId: '' }), row, ACCOUNTS)).toBe(false);
    expect(canRecord(formOf(row, { toId: 'bank' }), row, ACCOUNTS)).toBe(false);
  });

  it('needs a figure', () => {
    expect(canRecord(formOf(draft(), { amount: '' }), draft(), ACCOUNTS)).toBe(false);
  });
});

describe('corrections', () => {
  it('says nothing when the form holds what was read', () => {
    const row = draft();
    expect(corrections(formOf(row), row, ACCOUNTS)).toEqual([]);
  });

  it('names each field the owner changed, with what they put there', () => {
    const row = draft({ amountMinor: -38_000, kind: 'income' });
    const form = formOf(row, { amount: '52.000', description: 'SOTO BETAWI', occurredOn: '2026-09-29' });
    expect(corrections(form, row, ACCOUNTS)).toEqual([
      { field: 'amount', value: '52.000' },
      { field: 'name', value: 'SOTO BETAWI' },
      { field: 'date', value: '2026-09-29' },
    ]);
  });

  it('does not count the same figure written another way as a correction', () => {
    const row = draft();
    expect(corrections(formOf(row, { amount: '38.000' }), row, ACCOUNTS)).toEqual([]);
  });
});

describe('cents on a whole-unit currency under review', () => {
  it('keeps the exact figure the capture read while the amount is left alone', () => {
    const row = draft({ amountMinor: 12_501, exactHundredths: 1_250_030 });
    const form = formOf(row);
    // The whole figure that posts is what the form shows.
    expect(form.amount).toBe('12501');
    const patch = draftPatch(form, row, ACCOUNTS);
    expect(patch.amountMinor).toBe(12_501);
    // Left out, so `editDraft` keeps the draft's own figure.
    expect('exactHundredths' in patch).toBe(false);
    expect(corrections(form, row, ACCOUNTS)).toEqual([]);
  });

  it('writes a figure typed with cents as the rounded amount and the exact figure: up for money out, down for money in', () => {
    const row = draft();
    expect(draftPatch(formOf(row, { amount: '12500.30' }), row, ACCOUNTS)).toMatchObject({ amountMinor: 12_501, exactHundredths: 1_250_030 });
    expect(draftPatch(formOf(row, { mode: 'income', amount: '12.345,67' }), row, ACCOUNTS)).toMatchObject({ amountMinor: -12_345, exactHundredths: 1_234_567 });
    expect(canRecord(formOf(row, { amount: '12500.30' }), row, ACCOUNTS)).toBe(true);
  });

  it('refuses cents on a transfer', () => {
    const row = draft({ kind: 'transfer', toAccountId: 'wallet', categoryAccountId: null });
    expect(canRecord(formOf(row, { amount: '12500.30' }), row, ACCOUNTS)).toBe(false);
    expect(() => draftPatch(formOf(row, { amount: '12500.30' }), row, ACCOUNTS)).toThrow(DECIMALS_REFUSAL);
  });
});

describe('a draft read in a currency its account does not hold', () => {
  /** A purchase abroad on a rupiah card, read in the merchant's own figure. */
  const abroad = (over: Partial<DraftRow> = {}) => draft({ description: 'TOKO KOPI CONTOH', amountMinor: 94_300, currency: 'KRW', accountId: 'visa-account', ...over });

  it('opens with the merchant’s figure under its own flag, and nothing charged yet', () => {
    expect(formOf(abroad())).toMatchObject({ amount: '94300', currency: 'KRW', moneyId: 'visa-account', chargedAmount: '' });
  });

  it('cannot be recorded until the charged figure is there', () => {
    const row = abroad();
    expect(canRecord(formOf(row), row, ACCOUNTS)).toBe(false);
    expect(canRecord(formOf(row, { chargedAmount: '0' }), row, ACCOUNTS)).toBe(false);
    expect(canRecord(formOf(row, { chargedAmount: '1034500' }), row, ACCOUNTS)).toBe(true);
    expect(() => chargedFigure(formOf(row), ACCOUNTS)).toThrow('Enter the amount charged in IDR');
  });

  it('reads the charged figure in the account’s currency, as the Add form posts it', () => {
    const row = abroad();
    expect(chargedFigure(formOf(row, { chargedAmount: '1.034.500' }), ACCOUNTS)).toEqual({ amountMinor: 1_034_500, exactHundredths: null });
    // Cents on a whole-unit currency go on the figure that posts: the charge, rounded up for money out.
    expect(chargedFigure(formOf(row, { chargedAmount: '1034500,25' }), ACCOUNTS)).toEqual({ amountMinor: 1_034_501, exactHundredths: 103_450_025 });
    expect(chargedFigure(formOf(row, { mode: 'income', chargedAmount: '1034500,25' }), ACCOUNTS)).toEqual({ amountMinor: 1_034_500, exactHundredths: 103_450_025 });
  });

  it('has no charged figure when the amount is in the account’s own currency', () => {
    const row = draft();
    expect(chargedFigure(formOf(row, { chargedAmount: '999' }), ACCOUNTS)).toBeNull();
    // The flag turned back to the account's currency: the figure on the amount row is the one that posts.
    expect(chargedFigure(formOf(abroad(), { currency: 'IDR', chargedAmount: '999' }), ACCOUNTS)).toBeNull();
  });

  it('writes the draft back in the currency it was read in: the charge is the posting’s, not the draft’s', () => {
    const row = abroad();
    const form = formOf(row, { chargedAmount: '1034500' });
    expect(draftPatch(form, row, ACCOUNTS)).toMatchObject({ kind: 'expense', accountId: 'visa-account', amountMinor: 94_300, currency: 'KRW' });
    // What was read still stands, so nothing is taught to the source.
    expect(corrections(form, row, ACCOUNTS)).toEqual([]);
  });

  it('counts a corrected foreign figure as a correction, in the currency it was read in', () => {
    const row = abroad();
    const form = formOf(row, { amount: '49300', chargedAmount: '540000' });
    expect(draftPatch(form, row, ACCOUNTS)).toMatchObject({ amountMinor: 49_300, currency: 'KRW' });
    expect(corrections(form, row, ACCOUNTS)).toEqual([{ field: 'amount', value: '49300' }]);
  });

  it('follows the flag when the owner says the figure was the account’s currency after all', () => {
    const row = abroad();
    const form = formOf(row, { currency: 'IDR' });
    expect(canRecord(form, row, ACCOUNTS)).toBe(true);
    expect(draftPatch(form, row, ACCOUNTS)).toMatchObject({ amountMinor: 94_300, currency: 'IDR' });
  });

  it('writes a transfer in the From account’s currency, which is what the form shows its figure in', () => {
    const row = draft({ kind: 'transfer', currency: 'SGD', amountMinor: 5_000, toAccountId: 'wallet', categoryAccountId: null });
    const form = formOf(row, { amount: '600000' });
    expect(chargedFigure(form, ACCOUNTS)).toBeNull();
    expect(draftPatch(form, row, ACCOUNTS)).toMatchObject({ kind: 'transfer', amountMinor: 600_000, currency: 'IDR' });
  });

  it('reads the figure in the draft’s currency until an account is chosen', () => {
    const row = abroad({ accountId: null });
    expect(draftPatch(formOf(row), row, ACCOUNTS)).toMatchObject({ accountId: null, amountMinor: 94_300, currency: 'KRW' });
  });
});

describe('recording a foreign draft without opening the form', () => {
  const abroad = (over: Partial<DraftRow> = {}) => draft({ description: 'TOKO KOPI CONTOH', amountMinor: 94_300, currency: 'KRW', accountId: 'visa-account', ...over });
  const RATES = { rates: { KRW: 10.97 }, stale: [], missing: [] };

  it('names the pair only when the draft’s currency is not its account’s', () => {
    expect(foreignPair(abroad(), ACCOUNTS)).toEqual({ from: 'KRW', to: 'IDR' });
    expect(foreignPair(draft(), ACCOUNTS)).toBeNull();
    // No account yet: nothing says what it settles in, and the draft has that question to answer first.
    expect(foreignPair(abroad({ accountId: null }), ACCOUNTS)).toBeNull();
  });

  it('works out the charge at the day’s rate, to the same figure the form’s row would open on', () => {
    const row = abroad();
    expect(quickCharge(row, { from: 'KRW', to: 'IDR' }, RATES, 'IDR')).toEqual({ kind: 'charged', amountMinor: 1_034_471, currency: 'IDR' });
    expect(estimatedCharge({ amount: '94300', currency: 'KRW', accountCurrency: 'IDR', rate: 10.97 })).toBe('1034471');
  });

  it('crosses through the base currency for an account that is not in it', () => {
    const rates = { rates: { KRW: 11, USD: 16_500 }, stale: [], missing: [] };
    // 94.300 won at 11 rupiah is 1.037.300 rupiah, which is 62,87 dollars at 16.500.
    expect(quickCharge(abroad(), { from: 'KRW', to: 'USD' }, rates, 'IDR')).toEqual({ kind: 'charged', amountMinor: 6_287, currency: 'USD' });
  });

  it('asks on the form rather than post a figure from a rate that is missing, or from another day', () => {
    const pair = { from: 'KRW', to: 'IDR' };
    expect(quickCharge(abroad(), pair, { rates: {}, stale: [], missing: ['KRW'] }, 'IDR')).toEqual({ kind: 'ask' });
    expect(quickCharge(abroad(), pair, { rates: { KRW: 10.97 }, stale: ['KRW'], missing: [] }, 'IDR')).toEqual({ kind: 'ask' });
    // The rates could not be read at all.
    expect(quickCharge(abroad(), pair, null, 'IDR')).toEqual({ kind: 'ask' });
  });

  it('asks on the form for a figure of nothing, and for a transfer, whose figure is the From account’s own', () => {
    const pair = { from: 'KRW', to: 'IDR' };
    expect(quickCharge(abroad({ amountMinor: 0 }), pair, RATES, 'IDR')).toEqual({ kind: 'ask' });
    expect(quickCharge(abroad({ kind: 'transfer', toAccountId: 'wallet' }), pair, RATES, 'IDR')).toEqual({ kind: 'ask' });
  });

  it('works out money received the same way, from the figure’s size', () => {
    const row = abroad({ kind: 'income', amountMinor: -94_300, accountId: 'bank' });
    expect(quickCharge(row, { from: 'KRW', to: 'IDR' }, RATES, 'IDR')).toEqual({ kind: 'charged', amountMinor: 1_034_471, currency: 'IDR' });
  });
});

describe('savedWhere: where a confirmed transfer can be found (Cashflow lists only money in and out, owner 2026-11-16)', () => {
  const cards = [
    { id: 'plastic', accountId: 'visa-account', last4: '4821', holderName: null, isPrimary: true },
    { id: 'second', accountId: 'visa-account', last4: '7300', holderName: 'Partner', isPrimary: false },
  ];
  const payment = draft({ kind: 'transfer', description: 'CARD PAYMENT', accountId: 'bank', toAccountId: 'visa-account', categoryAccountId: null });

  it('names the card whose statement a card payment is on, by its digits', () => {
    expect(savedWhere(payment, ACCOUNTS, cards)).toBe('Saved on card 4821’s statement');
  });

  it('names the card the capture read, when it read one of the account’s cards', () => {
    expect(savedWhere({ ...payment, cardId: 'second' }, ACCOUNTS, cards)).toBe('Saved on card 7300’s statement');
  });

  it('names the card account when it has no digits on record', () => {
    expect(savedWhere(payment, ACCOUNTS, [])).toBe('Saved on Travel card’s statement');
  });

  it('a top-up or a move between two money accounts is on both accounts’ pages', () => {
    expect(savedWhere({ ...payment, toAccountId: 'wallet' }, ACCOUNTS, cards)).toBe('Saved on both accounts’ pages');
    // One side alone cannot say where it went: the toast reads as it always did.
    expect(savedWhere({ ...payment, toAccountId: null }, ACCOUNTS, cards)).toBeNull();
  });

  it('a joint account or a loan is on both pages too: Cashflow lists no transfer of any reach (owner 2026-11-16)', () => {
    const accounts = [...ACCOUNTS, { id: 'joint', name: 'Joint bank', kind: 'asset', subtype: 'bank', currency: 'IDR' }, { id: 'loan', name: 'Car loan', kind: 'liability', subtype: 'loan', currency: 'IDR' }] as AccountRow[];
    expect(savedWhere({ ...payment, toAccountId: 'joint' }, accounts, cards)).toBe('Saved on both accounts’ pages');
    expect(savedWhere({ ...payment, toAccountId: 'loan' }, accounts, cards)).toBe('Saved on both accounts’ pages');
  });

  it('a side this phone does not hold (the partner’s) names the side it does', () => {
    expect(savedWhere({ ...payment, accountId: 'wallet', toAccountId: 'partner-item' }, ACCOUNTS, cards)).toBe(`Saved on ${ACCOUNTS.find((a) => a.id === 'wallet')!.name}’s page`);
  });

  it('says nothing for a transfer with a fee, which Cashflow lists', () => {
    expect(savedWhere(payment, ACCOUNTS, cards, { fee: true })).toBeNull();
  });

  it('says nothing for spending or income, which Cashflow lists', () => {
    expect(savedWhere(draft(), ACCOUNTS, cards)).toBeNull();
    expect(savedWhere(draft({ kind: 'income' }), ACCOUNTS, cards)).toBeNull();
  });

  it('never speaks to the reader as "you"', () => {
    for (const each of [payment, { ...payment, toAccountId: 'wallet' }]) expect(savedWhere(each, ACCOUNTS, cards)).not.toMatch(/\byou(r)?\b/i);
  });
});
