import { describe, expect, it } from 'vitest';
import {
  budgetSheet,
  CARD_CASHBACK,
  CATEGORY_COLOURS,
  categoryVisual,
  DEFAULT_CATEGORY_KEYS,
  DEFAULT_CATEGORY_NEEDS,
  essentialSplit,
  isCardCashbackKey,
  isUncategorisedKey,
  needOf,
} from '../src/index';

describe('Cashback & Rewards into a credit card', () => {
  it('is a spending category of its own, made on first use rather than with every workspace', () => {
    expect(CARD_CASHBACK).toEqual({ key: 'expense.cashback', name: 'Cashback & Rewards', kind: 'expense' });
    expect(DEFAULT_CATEGORY_KEYS.has(CARD_CASHBACK.key)).toBe(false);
    expect(isCardCashbackKey('expense.cashback')).toBe(true);
    // The income one, for cashback into a bank, cash or a wallet, stays income.
    expect(isCardCashbackKey('income.cashback')).toBe(false);
    expect(isCardCashbackKey(null)).toBe(false);
    expect(isUncategorisedKey(CARD_CASHBACK.key)).toBe(false);
  });

  it('wears the badge-percent in the income green, as Income › Cashback & Rewards does', () => {
    expect(categoryVisual(CARD_CASHBACK.key, CARD_CASHBACK.key)).toEqual({ icon: 'badge-percent', colour: CATEGORY_COLOURS.income });
    expect(categoryVisual('income.cashback', 'income.cashback')).toEqual({ icon: 'badge-percent', colour: CATEGORY_COLOURS.income });
  });

  it('is neither Essential nor Lifestyle: it sits with Debts & savings by default', () => {
    expect(DEFAULT_CATEGORY_NEEDS[CARD_CASHBACK.key]).toBe('debts_savings');
    expect(needOf('cb', [{ id: 'cb', parentId: null, systemKey: CARD_CASHBACK.key }], {})).toEqual({ need: 'debts_savings', source: 'default' });
  });

  it('lowers what was spent without lowering Essential or Lifestyle, and the three still add back to the income', () => {
    // Invented: income 1.000.000; groceries 320.000 (essential); cashback −75.000 onto the card.
    const split = essentialSplit({
      incomeMinor: 1_000_000,
      spending: [
        { accountId: 'groceries', amountBaseMinor: 320_000 },
        { accountId: 'cashback', amountBaseMinor: -75_000 },
      ],
      needs: { groceries: 'essential', cashback: 'debts_savings' },
    });
    expect(split.spendingMinor).toBe(245_000);
    expect(split.essentialMinor).toBe(320_000);
    expect(split.lifestyleMinor).toBe(0);
    expect(split.debtsSavingsMinor).toBe(680_000);
    expect(split.essentialMinor + split.lifestyleMinor + split.debtsSavingsMinor).toBe(split.incomeMinor);
    expect(split.essentialMinor + split.lifestyleMinor + split.debtsSavingsSpentMinor).toBe(split.spendingMinor);
  });

  it('has no line on the budget sheet, yet lowers what was spent there and keeps Groceries whole', () => {
    const sheet = budgetSheet({
      month: '2026-11',
      categories: [
        { id: 'household', parentId: null, name: 'Household' },
        { id: 'groceries', parentId: 'household', name: 'Groceries' },
      ],
      amounts: [{ accountId: 'groceries', amountBaseMinor: 320_000 }],
      cashbackMinor: -75_000,
      caps: [{ categoryId: 'groceries', amountMinor: 400_000 }],
      incomePlanMinor: 1_000_000,
      incomeActualMinor: 1_000_000,
      debtPaymentsPlanMinor: 0,
      debtPaymentsActualMinor: 0,
      savings: [],
      eventSpendingMinor: 0,
      eventsInCaps: false,
      needs: { household: 'essential', groceries: 'essential' },
    });
    const groceries = sheet.lines[0]!.children[0]!;
    expect(groceries).toMatchObject({ id: 'groceries', totalMinor: 320_000, capMinor: 400_000, overMinor: 0 });
    expect(sheet.lines.map((line) => line.id)).toEqual(['household']);
    expect(sheet.spendingActualMinor).toBe(245_000);
    expect(sheet.essentialActualMinor).toBe(320_000);
    expect(sheet.lifestyleActualMinor).toBe(0);
    expect(sheet.debtsSavingsActualMinor).toBe(-75_000);
    // Named on its own, so the Essential and lifestyle sheet can show shares of what was bought and the cashback beneath.
    expect(sheet.cashbackActualMinor).toBe(-75_000);
    expect(sheet.essentialActualMinor + sheet.lifestyleActualMinor + sheet.debtsSavingsActualMinor).toBe(sheet.spendingActualMinor);
    expect(sheet.leftOverActualMinor).toBe(755_000);
  });
});
