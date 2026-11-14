import { describe, expect, it } from 'vitest';
import { balances, defaultSplitCosts, expenseInEvent, type ExpenseRecord, fewestPayments, isOnePotSplit, onePotSplit, sharesOf } from '../src/index';

/*
 * Split costs off, a shared trip's one pot (owner, 14 Nov 2026). An invented week in yen: Sari and Dimas, figures in
 * minor units, one dinner charged in euro at an invented 163.25.
 */

const spend = (over: Partial<ExpenseRecord>): ExpenseRecord => ({
  id: 'x',
  amountMinor: 4_100,
  currency: 'JPY',
  rateToEvent: '1',
  payerPersonId: 'sari',
  split: onePotSplit('sari'),
  voided: false,
  ...over,
});

describe('one pot (Split costs off)', () => {
  it('puts the whole amount on the payer: paid and share are the same figure', () => {
    expect(sharesOf(spend({}))).toEqual([{ personId: 'sari', minor: 4_100 }]);
    expect(expenseInEvent(spend({ currency: 'EUR', rateToEvent: '163.25', amountMinor: 2_730 }), 'JPY')).toEqual({ paidMinor: 4_457, shares: [{ personId: 'sari', minor: 4_457 }] });
  });

  it('leaves every balance at zero, whoever pays and in whatever currency, so there is nothing to settle', () => {
    const records = [
      spend({ id: 'a', payerPersonId: 'sari', split: onePotSplit('sari'), amountMinor: 8_300 }),
      spend({ id: 'b', payerPersonId: 'dimas', split: onePotSplit('dimas'), amountMinor: 2_950 }),
      spend({ id: 'c', payerPersonId: 'dimas', split: onePotSplit('dimas'), currency: 'EUR', rateToEvent: '163.25', amountMinor: 1_115 }),
      // A refund recorded in one pot is the payer's alone too.
      spend({ id: 'd', payerPersonId: 'sari', split: { mode: 'amounts', shares: [{ personId: 'sari', minor: -600 }] }, amountMinor: -600 }),
    ];
    const owed = balances(records, [], 'JPY', ['sari', 'dimas']);
    expect(owed).toEqual({ sari: 0, dimas: 0 });
    expect(fewestPayments(owed)).toEqual([]);
  });

  it('keeps a split recorded before it was switched off: those balances are only hidden', () => {
    const before = spend({ id: 'e', split: { mode: 'equal', people: ['sari', 'dimas'] }, amountMinor: 9_000 });
    const after = spend({ id: 'f', payerPersonId: 'dimas', split: onePotSplit('dimas'), amountMinor: 3_000 });
    expect(balances([before, after], [], 'JPY', ['sari', 'dimas'])).toEqual({ sari: 4_500, dimas: -4_500 });
  });

  it('tells a one-pot split from a shared one', () => {
    expect(isOnePotSplit(onePotSplit('sari'), 'sari')).toBe(true);
    expect(isOnePotSplit({ mode: 'amounts', shares: [{ personId: 'sari', minor: 500 }, { personId: 'dimas', minor: 0 }] }, 'sari')).toBe(true);
    expect(isOnePotSplit(onePotSplit('sari'), 'dimas')).toBe(false);
    expect(isOnePotSplit({ mode: 'equal', people: ['sari', 'dimas'] }, 'sari')).toBe(false);
  });
});

describe('Split costs when an event is shared', () => {
  it('is off for the household alone: no names beside it, or only the household’s names', () => {
    expect(defaultSplitCosts({ names: [], household: ['Dimas'] })).toBe(false);
    expect(defaultSplitCosts({ names: [' dimas '], household: ['Dimas'] })).toBe(false);
    expect(defaultSplitCosts({ names: ['', '  '], household: ['Dimas'] })).toBe(false);
  });

  it('is on when anyone else is named, or with no household at all', () => {
    expect(defaultSplitCosts({ names: ['Wulan'], household: ['Dimas'] })).toBe(true);
    expect(defaultSplitCosts({ names: ['Dimas', 'Wulan'], household: ['Dimas'] })).toBe(true);
    expect(defaultSplitCosts({ names: [], household: [] })).toBe(true);
    expect(defaultSplitCosts({ names: ['Dimas'], household: [] })).toBe(true);
  });
});
