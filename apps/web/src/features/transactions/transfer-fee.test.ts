import type { AccountRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { emptyForm, type FormDraft, formFromTransaction, formToPost, offersTransferFee } from './tx-form';

const accounts = [
  { id: 'card', name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'gopay', name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' },
  { id: 'wise', name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' },
  { id: 'bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
  { id: 'fees', name: 'Fees & charges', kind: 'expense', subtype: 'category', currency: null, systemKey: 'miscellaneous.fees_charges' },
  { id: 'topups', name: 'Top-ups', kind: 'expense', subtype: 'category', currency: null, systemKey: 'miscellaneous.top_ups' },
  { id: 'dining', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null, systemKey: 'food_beverage.restaurants' },
  { id: 'fx', name: 'Currency exchange', kind: 'equity', subtype: 'system', currency: null, systemKey: 'currency_exchange' },
  { id: 'gold', name: 'Antam gold', kind: 'asset', subtype: 'investment', currency: 'IDR' },
] as AccountRow[];

const topUp: FormDraft = { ...emptyForm('b'), mode: 'transfer', moneyId: 'card', toId: 'gopay', amount: '1000000', fee: '10000', feeCategoryId: 'fees', occurredOn: '2026-10-22' };

const entry = (accountId: string, amountMinor: number, o: Partial<TransactionView['entries'][number]> = {}) => {
  const account = accounts.find((a) => a.id === accountId)!;
  return { accountId, accountKind: account.kind, accountSubtype: account.subtype, accountName: account.name, amountMinor, amountBaseMinor: amountMinor, currency: 'IDR', spendCategoryId: null, ...o };
};
const view = (entries: unknown[]): TransactionView =>
  ({ id: 't', occurredOn: '2026-10-22', description: 'GoPay top-up', source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null, createdAt: '', entries }) as TransactionView;

describe('a transfer with a fee', () => {
  it('lands the transfer, charges the transfer and the fee together, and files the fee as spending', () => {
    const post = formToPost(topUp, accounts);
    expect(post.kind).toBe('post');
    if (post.kind !== 'post') return;
    expect(post.input.lines).toEqual([
      { accountId: 'gopay', amountMinor: 1_000_000, currency: 'IDR' },
      // A card's top-up of a wallet: the card's line names Top-ups, so points read the whole Rp 1.010.000 once, under
      // Top-ups' MCC — never under Fees & charges, which a card's rules treat as a bank charge that earns nothing.
      { accountId: 'card', amountMinor: -1_010_000, currency: 'IDR', spendCategoryId: 'topups' },
      { accountId: 'fees', amountMinor: 10_000, currency: 'IDR' },
    ]);
  });

  it('names no category on the paying line when it is not a card', () => {
    const post = formToPost({ ...topUp, moneyId: 'bank' }, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines[1]).toEqual({ accountId: 'bank', amountMinor: -1_010_000, currency: 'IDR' });
  });

  it('balances a card top-up with a fee: the card owes what landed and the fee together', () => {
    const post = formToPost(topUp, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(0);
    expect(post.input.lines[2]).toEqual({ accountId: 'fees', amountMinor: 10_000, currency: 'IDR' });
  });

  it('names Top-ups on the card line of a top-up with no fee, so its points still read', () => {
    const post = formToPost({ ...topUp, fee: '', feeCategoryId: '' }, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines).toEqual([
      { accountId: 'gopay', amountMinor: 1_000_000, currency: 'IDR' },
      { accountId: 'card', amountMinor: -1_000_000, currency: 'IDR', spendCategoryId: 'topups' },
    ]);
  });

  it("takes the open book's Top-ups the screen hands it over the first one the accounts hold", () => {
    const post = formToPost({ ...topUp, topUpCategoryId: 'topups-business' }, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines[1]).toEqual({ accountId: 'card', amountMinor: -1_010_000, currency: 'IDR', spendCategoryId: 'topups-business' });
  });

  it("keeps the fee's category on a card paying anything but a wallet", () => {
    const post = formToPost({ ...topUp, toId: 'bank' }, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines).toEqual([
      { accountId: 'bank', amountMinor: 1_000_000, currency: 'IDR' },
      { accountId: 'card', amountMinor: -1_010_000, currency: 'IDR', spendCategoryId: 'fees' },
      { accountId: 'fees', amountMinor: 10_000, currency: 'IDR' },
    ]);
    // And a fee filed somewhere else by hand stays where it was put.
    const chosen = formToPost({ ...topUp, toId: 'bank', feeCategoryId: 'dining' }, accounts);
    if (chosen.kind !== 'post') throw new Error('expected a post');
    expect(chosen.input.lines[1]).toMatchObject({ spendCategoryId: 'dining' });
  });

  it('names nothing on a card paying a bank with no fee, or a bank topping up a wallet', () => {
    const toBank = formToPost({ ...topUp, toId: 'bank', fee: '', feeCategoryId: '' }, accounts);
    if (toBank.kind !== 'post') throw new Error('expected a post');
    expect(toBank.input.lines.every((line) => !('spendCategoryId' in line))).toBe(true);
    const fromBank = formToPost({ ...topUp, moneyId: 'bank', fee: '', feeCategoryId: '' }, accounts);
    if (fromBank.kind !== 'post') throw new Error('expected a post');
    expect(fromBank.input.lines.every((line) => !('spendCategoryId' in line))).toBe(true);
  });

  it('falls back to the fee category when the workspace has no Top-ups at all', () => {
    const post = formToPost(topUp, accounts.filter((a) => a.id !== 'topups'));
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines[1]).toMatchObject({ spendCategoryId: 'fees' });
  });

  it('refuses a fee without a category', () => {
    expect(() => formToPost({ ...topUp, feeCategoryId: '' }, accounts)).toThrow('Choose a category for the fee');
  });

  it('reads back as a transfer of what landed, with its fee — never as Rp 10.000 of spending', () => {
    const saved = view([entry('gopay', 1_000_000), entry('card', -1_010_000, { spendCategoryId: 'topups' }), entry('fees', 10_000)]);
    expect(classify(saved)).toMatchObject({ type: 'transfer', amountMinor: 1_000_000, feeMinor: 10_000 });
    expect(formFromTransaction(saved, accounts)).toMatchObject({ mode: 'transfer', moneyId: 'card', toId: 'gopay', amount: '1000000', fee: '10000', feeCategoryId: 'fees' });
  });

  it('leaves a holding bought with a fee as it was: not a transfer', () => {
    const buy = view([entry('gold', 2_000_000), entry('bank', -2_010_000), entry('fees', 10_000)]);
    expect(classify(buy).type).toBe('expense');
  });
});

describe('a transfer between two currencies with a fee', () => {
  // Rp 1.600.000 leaves BCA for US$ 100 in Wise, the bank charging Rp 25.000.
  const foreign: FormDraft = { ...emptyForm('b'), mode: 'transfer', moneyId: 'bank', toId: 'wise', amount: '1600000', toAmount: '100', fee: '25000', feeCategoryId: 'fees', occurredOn: '2026-10-22' };

  it('charges the amount and the fee together in the From currency, lands the converted amount alone, files the fee in rupiah', () => {
    const post = formToPost(foreign, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines).toEqual([
      { accountId: 'bank', amountMinor: -1_625_000, currency: 'IDR' },
      { accountId: 'fx', amountMinor: 1_600_000, currency: 'IDR' },
      { accountId: 'wise', amountMinor: 10_000, currency: 'USD' },
      { accountId: 'fx', amountMinor: -10_000, currency: 'USD' },
      { accountId: 'fees', amountMinor: 25_000, currency: 'IDR' },
    ]);
    const sums = new Map<string, number>();
    for (const l of post.input.lines) sums.set(l.currency, (sums.get(l.currency) ?? 0) + l.amountMinor);
    expect([...sums.values()]).toEqual([0, 0]);
  });

  it('is the plain exchange with no fee, and refuses a fee without a category', () => {
    const post = formToPost({ ...foreign, fee: '', feeCategoryId: '' }, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.lines).toHaveLength(4);
    expect(() => formToPost({ ...foreign, feeCategoryId: '' }, accounts)).toThrow('Choose a category for the fee');
  });

  it('reads back as a transfer with the fee in the From currency, and round-trips through the form', () => {
    const saved = view(
      [
        entry('bank', -1_625_000),
        entry('fx', 1_600_000),
        entry('wise', 10_000, { currency: 'USD' }),
        entry('fx', -10_000, { currency: 'USD' }),
        entry('fees', 25_000),
      ].map((e) => (e.accountId === 'fx' ? { ...e, accountSystemKey: 'currency_exchange' } : e)),
    );
    expect(classify(saved)).toMatchObject({ type: 'transfer', amountMinor: 10_000, currency: 'USD', feeMinor: 25_000, feeCurrency: 'IDR' });
    const form = formFromTransaction(saved, accounts);
    expect(form).toMatchObject({ mode: 'transfer', moneyId: 'bank', toId: 'wise', amount: '1600000', toAmount: '100.00', fee: '25000', feeCategoryId: 'fees' });
    const again = formToPost(form, accounts);
    if (again.kind !== 'post') throw new Error('expected a post');
    expect(again.input.lines.find((l) => l.accountId === 'bank')!.amountMinor).toBe(-1_625_000);
  });
});

describe('offersTransferFee', () => {
  const idr = { currency: 'IDR' };
  const usd = { currency: 'USD' };
  it('offers the fee within one currency and between two', () => {
    expect(offersTransferFee(idr, idr, false)).toBe(true);
    expect(offersTransferFee(idr, usd, false)).toBe(true);
    expect(offersTransferFee(usd, idr, false)).toBe(true);
    expect(offersTransferFee(idr, undefined, false)).toBe(true);
    expect(offersTransferFee(undefined, undefined, false)).toBe(true);
  });
  it('offers none when the accounts are locked', () => {
    expect(offersTransferFee(idr, usd, true)).toBe(false);
    expect(offersTransferFee(idr, idr, true)).toBe(false);
  });
});
