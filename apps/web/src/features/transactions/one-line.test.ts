import { convertMinor, readExpenseLine, type CategoryOption, type PaymentOption } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  afterSave,
  baseOf,
  canSaveLine,
  categoryGuess,
  foreignCharge,
  lineDraft,
  previewDay,
  previewOf,
  previewRow,
  withAccountDigits,
  type LineContext,
} from './one-line';
import { formToPost } from './tx-form';

// Invented: no real bank, card or wallet.
const TODAY = '2026-11-10';
const NUSA: PaymentOption = { accountId: 'nusa', cardId: 'nusa-a', accountName: 'Bank Nusa', last4: '4417', holderName: null };
const BIRU: PaymentOption = { accountId: 'biru', cardId: null, accountName: 'Dompet Biru', last4: null, holderName: null };
const OPTIONS = [NUSA, BIRU];

const read = (line: string) => readExpenseLine(line, { today: TODAY, currency: 'IDR', payments: OPTIONS });
const context = (over: Partial<LineContext> = {}): LineContext => ({
  today: TODAY,
  sittingDay: TODAY,
  lastPaid: null,
  defaultPaid: null,
  options: OPTIONS,
  category: null,
  ...over,
});

const accounts = [
  { id: 'nusa', name: 'Bank Nusa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'cat-a', name: 'Coffee', kind: 'expense', subtype: 'category', currency: null },
] as AccountRow[];

describe('previewOf', () => {
  it("takes the line's paid-with as sure", () => {
    const preview = previewOf(read('kopi 38rb biru'), context(), {});
    expect(preview.paid?.accountId).toBe('biru');
    expect(preview.unsure.has('paid')).toBe(false);
    expect(preview.missing).toEqual([]);
    expect(canSaveLine(preview)).toBe(true);
  });

  it('maps a card read from the line back to its option', () => {
    const preview = previewOf(read('kopi 38rb 4417'), context(), {});
    expect(preview.paid).toEqual(NUSA);
  });

  it('falls back to the last paid-with of the sitting, then the default, as unsure', () => {
    const last = previewOf(read('kopi 38rb'), context({ lastPaid: NUSA, defaultPaid: BIRU }), {});
    expect(last.paid?.accountId).toBe('nusa');
    expect(last.unsure.has('paid')).toBe(true);
    const fallback = previewOf(read('kopi 38rb'), context({ lastPaid: null, defaultPaid: BIRU }), {});
    expect(fallback.paid?.accountId).toBe('biru');
    expect(fallback.unsure.has('paid')).toBe(true);
  });

  it('asks for paid-with when nothing can pay (ruling 2)', () => {
    const preview = previewOf(read('kopi 38rb'), context(), {});
    expect(preview.paid).toBeNull();
    expect(preview.missing).toEqual(['paid']);
    expect(canSaveLine(preview)).toBe(false);
  });

  it('asks for an amount when none is read', () => {
    const preview = previewOf(read('parkir'), context({ lastPaid: NUSA }), {});
    expect(preview.amountMinor).toBeNull();
    expect(preview.missing).toContain('amount');
    expect(canSaveLine(preview)).toBe(false);
  });

  it("keeps the sitting's day when the line names none", () => {
    expect(previewOf(read('roti 15rb'), context({ sittingDay: '2026-11-09' }), {}).occurredOn).toBe('2026-11-09');
  });

  it('a day in the line or a picked day wins over the sitting', () => {
    expect(previewOf(read('kemarin roti 15rb'), context({ sittingDay: '2026-11-01' }), {}).occurredOn).toBe('2026-11-09');
    expect(previewOf(read('kemarin roti 15rb'), context(), { occurredOn: '2026-11-05' }).occurredOn).toBe('2026-11-05');
  });

  it('a picked part is sure', () => {
    const ambiguous = previewOf(read('kopi 18,000'), context({ lastPaid: NUSA }), {});
    expect(ambiguous.unsure.has('amount')).toBe(true);
    const picked = previewOf(read('kopi 18,000'), context({ lastPaid: NUSA }), { amountMinor: 18_000 });
    expect(picked.unsure.has('amount')).toBe(false);
    expect(picked.amountMinor).toBe(18_000);

    const word = context({ lastPaid: NUSA, category: { id: 'cat-w', from: 'word' } });
    expect(previewOf(read('kopi 18rb'), word, {}).unsure.has('category')).toBe(true);
    const chosen = previewOf(read('kopi 18rb'), word, { categoryId: 'cat-b' });
    expect(chosen.unsure.has('category')).toBe(false);
    expect(chosen.categoryId).toBe('cat-b');

    const pickedPaid = previewOf(read('kopi 18rb'), context({ lastPaid: NUSA }), { paid: BIRU });
    expect(pickedPaid.paid).toEqual(BIRU);
    expect(pickedPaid.unsure.has('paid')).toBe(false);
  });

  it('a category from history is sure', () => {
    const preview = previewOf(read('kopi 18rb'), context({ lastPaid: NUSA, category: { id: 'cat-a', from: 'history' } }), {});
    expect(preview.categoryId).toBe('cat-a');
    expect(preview.unsure.has('category')).toBe(false);
  });
});

describe('categoryGuess', () => {
  it('prefers history, then one word match', () => {
    const opts: CategoryOption[] = [{ id: 'p', name: 'Parking', parentName: 'Transport' }];
    expect(categoryGuess('cat-a', 'Parkir', opts)).toEqual({ id: 'cat-a', from: 'history' });
    expect(categoryGuess(null, 'Toko parking', opts)).toEqual({ id: 'p', from: 'word' });
    expect(categoryGuess(null, 'Xyz', opts)).toBeNull();
  });

  it('skips words under three letters and words that match more than one category', () => {
    const opts: CategoryOption[] = [
      { id: 'p', name: 'Parking', parentName: 'Transport' },
      { id: 't', name: 'Taxi', parentName: 'Transport' },
    ];
    expect(categoryGuess(null, 'Pa', opts)).toBeNull();
    expect(categoryGuess(null, 'Transport', opts)).toBeNull();
    expect(categoryGuess(null, '', opts)).toBeNull();
  });
});

describe('previewDay', () => {
  it('says Today, Yesterday, else the short date', () => {
    expect(previewDay('2026-11-10', TODAY)).toBe('Today');
    expect(previewDay('2026-11-09', TODAY)).toBe('Yesterday');
    expect(previewDay('2026-10-28', TODAY)).toBe('28 Oct');
    expect(previewDay('2026-12-31', '2027-01-01')).toBe('Yesterday');
  });
});

describe('foreignCharge', () => {
  it("converts at the day's rate, or says nothing (Review Focus)", () => {
    const args = { amountMinor: 95_000, currency: 'KRW', payerCurrency: 'IDR', base: 'IDR' };
    expect(foreignCharge({ ...args, rates: { KRW: 11.5 } })).toEqual({ minor: 1_092_500, text: '1092500' });
    expect(foreignCharge({ ...args, rates: {} })).toBeNull();
  });

  it('crosses through the base when neither side is the base', () => {
    // 1 USD = 16 000 IDR, 1 SGD = 12 000 IDR: USD 10.00 is SGD 13.33.
    const charge = foreignCharge({ amountMinor: 1_000, currency: 'USD', payerCurrency: 'SGD', base: 'IDR', rates: { USD: 16_000, SGD: 12_000 } });
    expect(charge).toEqual({ minor: 1_333, text: '13.33' });
    expect(foreignCharge({ amountMinor: 1_000, currency: 'USD', payerCurrency: 'SGD', base: 'IDR', rates: { USD: 16_000 } })).toBeNull();
  });
});

describe('lineDraft', () => {
  it('posts what the Add form posts', () => {
    const preview = previewOf(read('kopi 38rb nusa'), context({ category: { id: 'cat-a', from: 'history' } }), {});
    const post = formToPost(lineDraft(preview, 'ws-1', ''), accounts);
    expect(post.kind).toBe('post');
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.cardId).toBe('nusa-a');
    expect(post.input.description).toBe('Kopi');
    expect(post.input.occurredOn).toBe(TODAY);
    expect(post.input.lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(0);
    expect(post.input.lines.find((line) => line.accountId === 'cat-a')?.amountMinor).toBe(38_000);
  });

  it('carries a foreign amount and its charge', () => {
    const reading = readExpenseLine('kopi KRW 95000 nusa', { today: TODAY, currency: 'IDR', payments: OPTIONS });
    expect(reading.currency).toBe('KRW');
    const preview = previewOf(reading, context({ category: { id: 'cat-a', from: 'history' } }), {});
    const post = formToPost(lineDraft(preview, 'ws-1', '1092500'), accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.originalCurrency).toBe('KRW');
    expect(post.input.originalAmountMinor).toBe(95_000);
    expect(post.input.lines.find((line) => line.accountId === 'cat-a')?.amountMinor).toBe(1_092_500);
  });

  it('saves an amount alone with an empty description', () => {
    const preview = previewOf(read('38rb nusa'), context({ category: { id: 'cat-a', from: 'history' } }), {});
    const draft = lineDraft(preview, 'ws-1', '');
    expect(draft.mode).toBe('expense');
    const post = formToPost(draft, accounts);
    if (post.kind !== 'post') throw new Error('expected a post');
    expect(post.input.description).toBe('');
  });

  it("leaves the category for later as '' (Choose later)", () => {
    const preview = previewOf(read('kopi 38rb nusa'), context(), {});
    expect(lineDraft(preview, 'ws-1', '').categoryId).toBe('');
  });
});

describe('baseOf', () => {
  it("counts the settled figure in the workspace's currency", () => {
    expect(baseOf(38_000, 'IDR', 'IDR', {})).toBe(38_000);
    expect(baseOf(1_250, 'USD', 'IDR', { USD: 16_000 })).toBe(convertMinor(1_250, 'USD', 'IDR', 16_000));
  });
});

describe('afterSave', () => {
  it('keeps the day and the paid-with', () => {
    const ctx = context({ lastPaid: BIRU });
    const saved = previewOf(read('kemarin kopi 20rb nusa'), ctx, {});
    expect(afterSave(ctx, saved)).toEqual({ sittingDay: saved.occurredOn, lastPaid: saved.paid });
    expect(afterSave(ctx, saved)).toEqual({ sittingDay: '2026-11-09', lastPaid: NUSA });
  });
});

describe('withAccountDigits', () => {
  it('fills only missing digits', () => {
    const [nusa, biru] = withAccountDigits(OPTIONS, { biru: '7720', nusa: '9999' });
    expect(biru?.last4).toBe('7720');
    expect(nusa?.last4).toBe('4417');
    expect(withAccountDigits([BIRU], {})[0]?.last4).toBeNull();
  });
});

describe('previewRow', () => {
  it('stands for the preview as a Cashflow row', () => {
    const preview = previewOf(read('kopi 38rb nusa'), context(), {});
    const row = previewRow(preview, 'preview', null);
    expect(row).toMatchObject({
      kind: 'tx',
      id: 'preview',
      type: 'expense',
      date: TODAY,
      description: 'Kopi',
      amountMinor: 38_000,
      currency: 'IDR',
      categoryId: null,
      categoryName: null,
      needsCategory: true,
      accountLabel: 'Bank Nusa',
      last4: '4417',
      deleted: false,
      excluded: false,
      needs: [],
    });
    const named = previewRow(previewOf(read('kopi 38rb'), context({ category: { id: 'cat-a', from: 'history' } }), {}), 'x', 'Coffee');
    expect(named).toMatchObject({ categoryId: 'cat-a', categoryName: 'Coffee', needsCategory: false, accountLabel: '', last4: null });
  });
});
