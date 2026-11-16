import type { TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { blankTurnForm, instalmentCardOf, instalmentRowValue, interestBps, spreadCaption, turnFooter, turnIntoInput, turnMonths } from './turn-into';

// Invented: a laptop of Rp 12.000.000 on a credit card on 10 Nov 2026, statement day the 18th.
const rp = (text: string | null | undefined) => text?.replace(/ /g, ' ');
const entry = (accountId: string, accountKind: string, accountSubtype: string, amountMinor: number) => ({
  id: `${accountId}-e`, accountId, accountName: accountId, accountKind, accountSubtype, amountMinor, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: amountMinor, memo: null, spendCategoryId: null,
});
const purchase = (paidWith: { id: string; subtype: string; kind?: string }, extra: Partial<TransactionView> = {}) =>
  ({
    id: 't1', occurredOn: '2026-11-10', description: 'Laptop', source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null, createdAt: '',
    entries: [entry('electronics', 'expense', 'category', 12_000_000), entry(paidWith.id, paidWith.kind ?? 'liability', paidWith.subtype, -12_000_000)],
    ...extra,
  }) as unknown as TransactionView;
const own = [
  { id: 'visa', subtype: 'credit_card' },
  { id: 'debit', subtype: 'bank' },
  { id: 'cash', subtype: 'cash' },
] as const;

describe('which purchases offer Turn into instalments', () => {
  it('a posted purchase on one of this phone’s credit cards', () => {
    expect(instalmentCardOf(purchase({ id: 'visa', subtype: 'credit_card' }), own)).toEqual({ cardAccountId: 'visa', amountMinor: 12_000_000 });
  });

  it('not one paid by debit card or cash, a deleted one, or one on another member’s card', () => {
    expect(instalmentCardOf(purchase({ id: 'debit', subtype: 'bank', kind: 'asset' }), own)).toBeNull();
    expect(instalmentCardOf(purchase({ id: 'cash', subtype: 'cash', kind: 'asset' }), own)).toBeNull();
    expect(instalmentCardOf(purchase({ id: 'visa', subtype: 'credit_card' }, { status: 'void' }), own)).toBeNull();
    // The partner's card here is a placeholder this phone's own accounts do not list.
    expect(instalmentCardOf(purchase({ id: 'placeholder', subtype: 'other' }), own)).toBeNull();
    expect(instalmentCardOf(purchase({ id: 'partner-card', subtype: 'credit_card' }), own)).toBeNull();
  });
});

describe('the sheet', () => {
  it('opens at twelve months, first billed after the purchase’s own statement, 0%', () => {
    expect(blankTurnForm('2026-11-10', 18)).toEqual({ months: 12, other: '', firstBilledMonth: '2026-12', interest: '0' });
  });

  it('reads Other as a whole number of months, and the interest as basis points', () => {
    expect(turnMonths({ ...blankTurnForm('2026-11-10', 18), months: 'other', other: '9' })).toBe(9);
    expect(turnMonths({ ...blankTurnForm('2026-11-10', 18), months: 'other', other: '0' })).toBeNull();
    expect(turnMonths({ ...blankTurnForm('2026-11-10', 18), months: 'other', other: '2.5' })).toBeNull();
    expect(interestBps('0')).toBe(0);
    expect(interestBps('2,5')).toBe(250);
    expect(interestBps('-1')).toBeNull();
  });

  it('saves a plan tied to the purchase, always counted each month, earning no points', () => {
    const input = turnIntoInput({ transactionId: 't1', description: 'Laptop', amountMinor: 12_000_000 }, 'visa', { ...blankTurnForm('2026-11-10', 18), months: 6, interest: '1,5' });
    expect(input).toEqual({ cardAccountId: 'visa', description: 'Laptop', totalMinor: 12_000_000, months: 6, firstBilledMonth: '2026-12', transactionId: 't1', countMode: 'each_month', rateBps: 150, earnsPoints: false });
  });

  it('says what counts each month, and when', () => {
    expect(rp(turnFooter(12_000_000, 6, '2026-12', 18, 'IDR'))).toBe('Rp 2.000.000 counts as spending in each month from December 2026 to May 2027.');
    expect(turnFooter(12_000_000, null, '2026-12', 18, 'IDR')).toBeUndefined();
  });
});

describe('the purchase once turned', () => {
  it('reads the plan on its row, and its hero says it is spread', () => {
    expect(rp(instalmentRowValue({ months: 6, monthlyMinor: 2_000_000 }, 'IDR'))).toBe('6 × Rp 2.000.000');
    expect(instalmentRowValue(null, 'IDR')).toBe('None');
    expect(rp(spreadCaption({ months: 6, countMode: 'each_month' }, 'IDR'))).toBe('Spread over 6 months · counts Rp 0 now');
    expect(spreadCaption({ months: 6, countMode: 'at_purchase' }, 'IDR')).toBeNull();
  });
});

describe('an investment bought with the card (TF 139)', () => {
  const buy = (paidWith: { id: string; subtype: string }) =>
    ({
      id: 'b1', occurredOn: '2026-11-10', description: 'Buy ORI030', source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null, createdAt: '',
      entries: [entry('ori', 'asset', 'investment', 6_000_000), entry(paidWith.id, paidWith.subtype === 'credit_card' ? 'liability' : 'asset', paidWith.subtype, -6_000_000)],
    }) as unknown as TransactionView;

  it('a buy paid with this phone’s own card offers the row; one paid from the bank, or on the partner’s card, does not', () => {
    expect(instalmentCardOf(buy({ id: 'visa', subtype: 'credit_card' }), own, { trade: true })).toEqual({ cardAccountId: 'visa', amountMinor: 6_000_000 });
    expect(instalmentCardOf(buy({ id: 'debit', subtype: 'bank' }), own, { trade: true })).toBeNull();
    expect(instalmentCardOf(buy({ id: 'partner-card', subtype: 'credit_card' }), own, { trade: true })).toBeNull();
    expect(instalmentCardOf(buy({ id: 'visa', subtype: 'credit_card' }), own)).toBeNull();
  });

  it('saves At purchase, and says it is not spending', () => {
    const input = turnIntoInput({ transactionId: 'b1', description: 'Buy ORI030', amountMinor: 6_000_000 }, 'visa', { ...blankTurnForm('2026-11-10', 18), months: 6 }, { investment: true });
    expect(input).toMatchObject({ countMode: 'at_purchase', transactionId: 'b1', totalMinor: 6_000_000, months: 6 });
    expect(turnFooter(6_000_000, 6, '2026-12', 18, 'IDR', true)).toBe('An investment, not spending: each instalment is a card repayment, December 2026 to May 2027.');
  });
});
