import type { DraftRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { emptyForm, type FormDraft } from '../transactions/tx-form';
import { canRecord, corrections, draftPatch, formFromDraft } from './draft-form';

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
    expect(draftPatch(formOf(row, { amount: '52.000', description: ' SOTO BETAWI ' }), row)).toEqual({
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
    expect(draftPatch(formOf(row), row)).toMatchObject({ kind: 'income', amountMinor: -899_000, cardId: null });
  });

  it('writes a tab change across: an expense recorded as income turns negative', () => {
    const row = draft();
    expect(draftPatch(formOf(row, { mode: 'income' }), row)).toMatchObject({ kind: 'income', amountMinor: -38_000 });
  });

  it('writes a transfer back positive, with its To and no category', () => {
    const row = draft({ kind: 'transfer', toAccountId: 'wallet', categoryAccountId: null });
    expect(draftPatch(formOf(row), row)).toMatchObject({
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
    expect(draftPatch(formOf(row, { cardId: 'visa' }), row).cardId).toBe('visa');
  });

  it('keeps the name that was read when the note is emptied', () => {
    const row = draft();
    expect(draftPatch(formOf(row, { description: '  ' }), row).description).toBe('TOKO KOPI');
  });

  it('refuses a figure that is not a positive amount', () => {
    const row = draft();
    expect(() => draftPatch(formOf(row, { amount: '' }), row)).toThrow(/Amount/);
    expect(() => draftPatch(formOf(row, { amount: '0' }), row)).toThrow(/Amount/);
  });
});

describe('canRecord', () => {
  it('needs an account and a category for spending and income', () => {
    const row = draft();
    expect(canRecord(formOf(row), row)).toBe(true);
    expect(canRecord(formOf(row, { moneyId: '' }), row)).toBe(false);
    expect(canRecord(formOf(row, { categoryId: '' }), row)).toBe(false);
    expect(canRecord(formOf(row, { mode: 'income' }), row)).toBe(true);
  });

  it('needs a To, other than the From, for a transfer', () => {
    const row = draft({ kind: 'transfer', categoryAccountId: null, toAccountId: 'wallet' });
    expect(canRecord(formOf(row), row)).toBe(true);
    expect(canRecord(formOf(row, { toId: '' }), row)).toBe(false);
    expect(canRecord(formOf(row, { toId: 'bank' }), row)).toBe(false);
  });

  it('needs a figure', () => {
    expect(canRecord(formOf(draft(), { amount: '' }), draft())).toBe(false);
  });
});

describe('corrections', () => {
  it('says nothing when the form holds what was read', () => {
    const row = draft();
    expect(corrections(formOf(row), row)).toEqual([]);
  });

  it('names each field the owner changed, with what they put there', () => {
    const row = draft({ amountMinor: -38_000, kind: 'income' });
    const form = formOf(row, { amount: '52.000', description: 'SOTO BETAWI', occurredOn: '2026-09-29' });
    expect(corrections(form, row)).toEqual([
      { field: 'amount', value: '52.000' },
      { field: 'name', value: 'SOTO BETAWI' },
      { field: 'date', value: '2026-09-29' },
    ]);
  });

  it('does not count the same figure written another way as a correction', () => {
    const row = draft();
    expect(corrections(formOf(row, { amount: '38.000' }), row)).toEqual([]);
  });
});
