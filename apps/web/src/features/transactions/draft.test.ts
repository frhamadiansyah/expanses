import type { PostingLine } from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { isEditable } from './draft';

const accounts = [
  { id: 'checking', kind: 'asset' },
  { id: 'visa', kind: 'liability' },
  { id: 'groceries', kind: 'expense' },
  { id: 'opening', kind: 'equity' },
] as AccountRow[];

/** Simulates what the ledger returns after posting these lines. */
function view(lines: PostingLine[], status: TransactionView['status'] = 'posted'): TransactionView {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return {
    id: 'tx1', occurredOn: '2026-09-11', description: 'Test', source: 'manual', status, externalRef: null, mcc: null, cardId: null, goalId: null,
    originalCurrency: null, originalAmountMinor: null, createdAt: '2026-09-11T00:00:00Z',
    entries: lines.map((l, i) => ({
      id: `e${i}`, accountId: l.accountId, accountName: l.accountId, accountKind: byId.get(l.accountId)!.kind,
      amountMinor: l.amountMinor, currency: l.currency, fxRateToBase: 1, amountBaseMinor: l.amountMinor, memo: null, spendCategoryId: null,
    })),
  } as TransactionView;
}

/*
 * What is left of this file. The old form's money pipeline used to live beside `isEditable` and be tested here —
 * a second `positive`, a second `typedMcc`, a second set of posting lines — long after `TransactionForm.tsx` was
 * deleted and nothing but this test could reach any of it. `tx-form.test.ts` holds the pipeline's tests now,
 * against the pipeline the app actually runs.
 */
describe('which transactions have a form at all', () => {
  const expense = view([{ accountId: 'groceries', amountMinor: 1000, currency: 'IDR' }, { accountId: 'visa', amountMinor: -1000, currency: 'IDR' }]);

  it('does not offer editing for opening balances or voided rows', () => {
    const opening = view([{ accountId: 'checking', amountMinor: 1000, currency: 'IDR' }, { accountId: 'opening', amountMinor: -1000, currency: 'IDR' }]);
    expect(isEditable(opening)).toBe(false);
    expect(isEditable(expense)).toBe(true);
    expect(isEditable({ ...expense, status: 'void' })).toBe(false);
  });

  it('offers editing for a transfer and for income, which have forms of their own', () => {
    const transfer = view([{ accountId: 'checking', amountMinor: -1000, currency: 'IDR' }, { accountId: 'visa', amountMinor: 1000, currency: 'IDR' }]);
    expect(isEditable(transfer)).toBe(true);
    // A draft is not posted, so there is nothing to correct yet either.
    expect(isEditable(view([{ accountId: 'groceries', amountMinor: 1000, currency: 'IDR' }], 'void'))).toBe(false);
  });
});
