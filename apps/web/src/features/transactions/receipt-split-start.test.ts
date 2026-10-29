import { describe, expect, it } from 'vitest';
import { startDraft } from './receipt-split-start';
import { type ReceiptMemo } from './receipt-split-model';
import { withReceiptApplied } from './receipt-split-model';

const people = [
  { debtAccountId: 'acc-1', name: 'Person A', amount: '5' },
  { debtAccountId: '', name: 'Person B', amount: '' },
];

describe('startDraft', () => {
  it('is a blank expense with the people and no amount', () => {
    const draft = startDraft('book-1', people, null, '2026-10-01');
    expect(draft.mode).toBe('expense');
    expect(draft.bookId).toBe('book-1');
    expect(draft.amount).toBe('');
    expect(draft.with.map((row) => row.amount)).toEqual(['', '']);
    expect(draft.moneyId).toBe('');
  });

  it('carries the Default account and card when there is one', () => {
    const draft = startDraft('book-1', [], { accountId: 'acc-9', cardId: 'card-2' }, '2026-10-01');
    expect([draft.moneyId, draft.cardId]).toEqual(['acc-9', 'card-2']);
    expect(startDraft('book-1', [], { accountId: 'acc-9' }, '2026-10-01').cardId).toBe('');
  });

  it('keeps the payer when the receipt fills the rest', () => {
    const memo: ReceiptMemo = {
      items: [
        { id: 'i1', name: 'Item one', quantity: 1, amountMinor: 30000, sharedBy: [1] },
        { id: 'i2', name: 'Item two', quantity: 1, amountMinor: 20000, sharedBy: [0] },
      ],
      charges: [],
      printedTotal: 50000,
      useTotal: false,
      merchant: 'Place',
      date: null,
      currency: 'IDR',
      people: [{ debtAccountId: 'acc-1', name: 'Person A' }],
    };
    const next = withReceiptApplied(startDraft('book-1', people.slice(0, 1), { accountId: 'acc-9' }, '2026-10-01'), memo, '2026-10-01');
    expect(next.moneyId).toBe('acc-9');
    expect(next.description).toBe('Place');
    expect(next.with).toHaveLength(1);
    expect(next.withEqually).toBe(false);
  });
});
