import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balances, type ExpenseRecord, expenseInEvent, fewestPayments, myExpenseLines, refundSplitLike, type SettlementRecord, sharesOf } from '../src/index';

/*
 * A refund in a shared event is an expense below zero (money back), shared and netted exactly as an expense is.
 * Invented people and figures.
 */
const PEOPLE = ['p-andi', 'p-budi', 'p-rina'] as const;
const expense = (id: string, amountMinor: number, payerPersonId: string, split: ExpenseRecord['split'], rateToEvent = '1', currency = 'TRY'): ExpenseRecord => ({ id, amountMinor, currency, rateToEvent, payerPersonId, split, voided: false });
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('refunds in a shared event', () => {
  it('an equal refund shares back below zero, the units left over going to the payer', () => {
    const shares = sharesOf({ amountMinor: -1_001, payerPersonId: 'p-rina', split: { mode: 'equal', people: ['p-andi', 'p-rina'] } });
    expect(shares).toEqual([
      { personId: 'p-andi', minor: -500 },
      { personId: 'p-rina', minor: -501 },
    ]);
  });

  it('an amounts refund must be zero or below for each person and add up to the refund', () => {
    expect(() => sharesOf({ amountMinor: -100, payerPersonId: 'p-rina', split: { mode: 'amounts', shares: [{ personId: 'p-rina', minor: 150 }, { personId: 'p-andi', minor: -250 }] } })).toThrow();
    expect(sharesOf({ amountMinor: -100, payerPersonId: 'p-rina', split: { mode: 'amounts', shares: [{ personId: 'p-rina', minor: -100 }, { personId: 'p-andi', minor: 0 }] } })).toHaveLength(2);
    expect(() => sharesOf({ amountMinor: 0, payerPersonId: 'p-rina', split: { mode: 'equal', people: ['p-rina'] } })).toThrow();
  });

  it('a full refund brings every balance back to what it was before the purchase', () => {
    const buy = expense('e1', 90_001, 'p-rina', { mode: 'amounts', shares: [{ personId: 'p-rina', minor: 30_001 }, { personId: 'p-andi', minor: 40_000 }, { personId: 'p-budi', minor: 20_000 }] });
    const back = expense('r1', -90_001, 'p-rina', refundSplitLike(sharesOf(buy), -90_001));
    expect(sharesOf(back).map((s) => s.minor)).toEqual([-30_001, -40_000, -20_000]);
    expect(balances([buy, back], [], 'TRY', PEOPLE)).toEqual({ 'p-andi': 0, 'p-budi': 0, 'p-rina': 0 });
  });

  it('a partial refund divides in the original proportions, adds up exactly, and reduces who owes whom', () => {
    const buy = expense('e1', 100_000, 'p-rina', { mode: 'amounts', shares: [{ personId: 'p-rina', minor: 50_000 }, { personId: 'p-andi', minor: 30_000 }, { personId: 'p-budi', minor: 20_000 }] });
    const back = expense('r1', -3_333, 'p-rina', refundSplitLike(sharesOf(buy), -3_333));
    const shares = sharesOf(back);
    expect(sum(shares.map((s) => s.minor))).toBe(-3_333);
    expect(shares.every((s) => s.minor <= 0)).toBe(true);
    const owed = balances([buy, back], [], 'TRY', PEOPLE);
    expect(sum(Object.values(owed))).toBe(0);
    const before = balances([buy], [], 'TRY', PEOPLE);
    expect(owed['p-andi']!).toBeGreaterThan(before['p-andi']!);
    expect(owed['p-budi']!).toBeGreaterThan(before['p-budi']!);
    expect(fewestPayments(owed).reduce((s, p) => s + p.amountMinor, 0)).toBe(-owed['p-andi']! - owed['p-budi']!);
  });

  it('a refund larger than one person’s share leaves that person owed, and still sums to zero', () => {
    const buy = expense('e1', 10_000, 'p-andi', { mode: 'equal', people: ['p-andi', 'p-rina'] });
    const back = expense('r1', -30_000, 'p-rina', { mode: 'equal', people: ['p-andi', 'p-rina'] });
    const owed = balances([buy, back], [], 'TRY', PEOPLE);
    expect(owed).toEqual({ 'p-andi': 20_000, 'p-budi': 0, 'p-rina': -20_000 });
    expect(fewestPayments(owed)).toEqual([{ fromPersonId: 'p-rina', toPersonId: 'p-andi', amountMinor: 20_000 }]);
  });

  it('a refund after a settlement keeps the balances summing to zero and suggests the way back', () => {
    const buy = expense('e1', 60_000, 'p-rina', { mode: 'equal', people: ['p-andi', 'p-rina'] });
    const paid: SettlementRecord = { id: 's1', fromPersonId: 'p-andi', toPersonId: 'p-rina', amountMinor: 30_000, voided: false };
    const back = expense('r1', -20_000, 'p-rina', refundSplitLike(sharesOf(buy), -20_000));
    const owed = balances([buy, back], [paid], 'TRY', PEOPLE);
    expect(owed).toEqual({ 'p-andi': 10_000, 'p-budi': 0, 'p-rina': -10_000 });
    expect(fewestPayments(owed)).toEqual([{ fromPersonId: 'p-rina', toPersonId: 'p-andi', amountMinor: 10_000 }]);
  });

  it('a voided refund counts for nothing', () => {
    const buy = expense('e1', 60_000, 'p-rina', { mode: 'equal', people: ['p-andi', 'p-rina'] });
    const back = { ...expense('r1', -20_000, 'p-rina', { mode: 'equal', people: ['p-andi', 'p-rina'] }), voided: true };
    expect(balances([buy, back], [], 'TRY', PEOPLE)).toEqual(balances([buy], [], 'TRY', PEOPLE));
  });

  it('the recorder’s card is credited and the trip balance falls by the others’ share', () => {
    const back = expense('r1', -20_000, 'p-rina', { mode: 'equal', people: ['p-andi', 'p-rina'] });
    const accounts = { shareAccountId: 'cat', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx' };
    const out = myExpenseLines({ expense: back, eventCurrency: 'TRY', me: 'p-rina', accounts, paidFrom: { accountId: 'card', currency: 'TRY', chargedMinor: -20_000 } });
    expect(out).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'card', amountMinor: 20_000, currency: 'TRY' },
        { accountId: 'cat', amountMinor: -10_000, currency: 'TRY' },
        { accountId: 'trip', amountMinor: -10_000, currency: 'TRY' },
      ],
    });
    // The sign of what was charged must agree with the refund's.
    expect(() => myExpenseLines({ expense: back, eventCurrency: 'TRY', me: 'p-rina', accounts, paidFrom: { accountId: 'card', currency: 'TRY', chargedMinor: 20_000 } })).toThrow();
  });

  it('properties: purchases and refunds in several currencies and uneven splits always net to zero and settle', () => {
    const personArb = fc.constantFrom(...PEOPLE);
    const case_ = fc
      .record({
        amount: fc.integer({ min: 1, max: 5_000_000 }),
        refundPct: fc.integer({ min: 1, max: 150 }),
        payer: personArb,
        weights: fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 3, maxLength: 3 }).filter((w) => w.some((x) => x > 0)),
        currency: fc.constantFrom('TRY', 'EUR'),
        rate: fc.constantFrom('1', '31.5', '0.0211', '1.0007'),
      })
      .map((c) => ({ ...c, rate: c.currency === 'TRY' ? '1' : c.rate }));
    fc.assert(
      fc.property(fc.array(case_, { minLength: 1, maxLength: 5 }), (cases) => {
        const records: ExpenseRecord[] = [];
        for (const [i, c] of cases.entries()) {
          const total = c.weights.reduce((a, b) => a + b, 0);
          const shares = PEOPLE.map((personId, k) => ({ personId, minor: Math.floor((c.amount * c.weights[k]!) / total) }));
          shares[0]!.minor += c.amount - sum(shares.map((s) => s.minor));
          const buy = expense(`e${i}`, c.amount, c.payer, { mode: 'amounts', shares }, c.rate, c.currency);
          const refund = -Math.max(1, Math.floor((c.amount * c.refundPct) / 100));
          const back = expense(`r${i}`, refund, c.payer, refundSplitLike(sharesOf(buy), refund), c.rate, c.currency);
          expect(sum(sharesOf(back).map((s) => s.minor))).toBe(refund);
          const { paidMinor, shares: eventShares } = expenseInEvent(back, 'TRY');
          expect(paidMinor).toBe(sum(eventShares.map((s) => s.minor)));
          records.push(buy, back);
        }
        const owed = balances(records, [], 'TRY', PEOPLE);
        expect(sum(Object.values(owed))).toBe(0);
        const after = { ...owed };
        for (const p of fewestPayments(owed)) {
          after[p.fromPersonId]! += p.amountMinor;
          after[p.toPersonId]! -= p.amountMinor;
        }
        expect(Object.values(after).every((v) => v === 0)).toBe(true);
      }),
      { numRuns: 300, seed: 20261026 },
    );
  });
});
