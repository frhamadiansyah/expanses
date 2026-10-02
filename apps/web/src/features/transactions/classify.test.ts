import type { TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { isEditable } from './draft';
import { buildRows } from './list-model';

const against = (systemKey: string, amountMinor: number): TransactionView => ({
  id: systemKey,
  occurredOn: '2026-09-30',
  description: 'Balance adjusted',
  source: 'manual',
  status: 'posted',
  externalRef: null,
  originalCurrency: null,
  originalAmountMinor: null,
  mcc: null,
  cardId: null,
  goalId: null,
  createdAt: '2026-09-30T00:00:00Z',
  entries: [
    { id: 'a', accountId: 'bca', accountName: 'BCA', accountKind: 'asset', amountMinor, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: amountMinor, memo: null, spendCategoryId: null },
    { id: 'b', accountId: 'eq', accountName: 'Equity', accountKind: 'equity', accountSystemKey: systemKey, amountMinor: -amountMinor, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: -amountMinor, memo: null, spendCategoryId: null },
  ],
});

describe('a balance correction', () => {
  it('is told from an opening balance by its equity account, and neither is edited by a form', () => {
    expect(classify(against('balance_correction', -20_000)).type).toBe('correction');
    expect(classify(against('opening_balance', 500_000)).type).toBe('opening');
    expect(isEditable(against('balance_correction', -20_000))).toBe(false);
  });

  it('is neither spending nor income in the list', () => {
    const [row] = buildRows([against('balance_correction', -20_000)], [], [], []);
    expect(row).toMatchObject({ type: 'correction', amountMinor: 20_000, spentMinor: 0, earnedMinor: 0, baseMinor: 0 });
  });
});
