import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balances, type ExpenseRecord, expenseInEvent, fewestPayments, myExpenseLines, mySettlementLines, type PostingLine, type SettlementRecord, sharesOf } from '../src/index';

/*
 * Spec §4's three properties, and Review Focus 2 and 4: the split always sums to the total; balances sum to zero; the
 * suggestions settle every balance and do not depend on the order the balances were read in; and each phone's lines
 * balance per currency while moving its trip balance by exactly its Balances figure.
 */
const RUNS = 300;
const SEED = 20261015;
const PEOPLE = ['p-andi', 'p-budi', 'p-dewi', 'p-rina'] as const;
const personArb = fc.constantFrom(...PEOPLE);
const currencyArb = fc.constantFrom('TRY', 'EUR', 'IDR');
const rateArb = fc.constantFrom('0.0211', '1', '31.5', '1.0007', '640', '0.5');

const splitArb = (amountMinor: number) =>
  fc.oneof(
    fc.uniqueArray(personArb, { minLength: 1, maxLength: 4 }).map((people) => ({ mode: 'equal' as const, people })),
    fc.uniqueArray(personArb, { minLength: 1, maxLength: 4 }).chain((people) =>
      fc.array(fc.nat({ max: 1000 }), { minLength: people.length, maxLength: people.length }).map((weights) => {
        const sum = weights.reduce((a, b) => a + b, 0) || 1;
        const shares = people.map((personId, i) => ({ personId, minor: Math.floor((amountMinor * weights[i]!) / sum) }));
        shares[0]!.minor += amountMinor - shares.reduce((a, s) => a + s.minor, 0);
        return { mode: 'amounts' as const, shares };
      }),
    ),
  );

const expenseArb = (eventCurrency: string): fc.Arbitrary<ExpenseRecord> =>
  fc.record({ amountMinor: fc.integer({ min: 1, max: 50_000_000 }), currency: currencyArb, payerPersonId: personArb, rate: rateArb, voided: fc.boolean() }).chain(({ amountMinor, currency, payerPersonId, rate, voided }) =>
    splitArb(amountMinor).map((split) => ({ id: `e-${amountMinor}`, amountMinor, currency, rateToEvent: currency === eventCurrency ? '1' : rate, payerPersonId, split, voided })),
  );

const settlementArb: fc.Arbitrary<SettlementRecord> = fc
  .tuple(personArb, personArb, fc.integer({ min: 1, max: 9_000_000 }), fc.boolean())
  .filter(([from, to]) => from !== to)
  .map(([fromPersonId, toPersonId, amountMinor, voided]) => ({ id: `s-${amountMinor}`, fromPersonId, toPersonId, amountMinor, voided }));

describe('shared events, properties', () => {
  it('the split always sums to the total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50_000_000 }).chain((amountMinor) => fc.tuple(fc.constant(amountMinor), splitArb(amountMinor), personArb)), ([amountMinor, split, payer]) => {
        const shares = sharesOf({ amountMinor, payerPersonId: payer, split });
        expect(shares.reduce((sum, s) => sum + s.minor, 0)).toBe(amountMinor);
        if (split.mode === 'equal') expect(Math.max(...shares.map((s) => s.minor)) - Math.min(...shares.map((s) => s.minor))).toBeLessThan(split.people.length);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('each expense nets to exactly zero in the event currency, and balances sum to zero', () => {
    fc.assert(
      fc.property(fc.array(expenseArb('TRY'), { maxLength: 8 }), fc.array(settlementArb, { maxLength: 4 }), (expenses, settlements) => {
        for (const e of expenses) {
          const { paidMinor, shares } = expenseInEvent(e, 'TRY');
          expect(paidMinor).toBe(shares.reduce((sum, s) => sum + s.minor, 0));
        }
        expect(Object.values(balances(expenses, settlements, 'TRY')).reduce((a, b) => a + b, 0)).toBe(0);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('the suggestions settle every balance, in at most n−1 payments, whatever order the balances were read in', () => {
    fc.assert(
      fc.property(fc.array(expenseArb('TRY'), { minLength: 1, maxLength: 8 }), fc.array(settlementArb, { maxLength: 4 }), (expenses, settlements) => {
        const owed = balances(expenses, settlements, 'TRY', PEOPLE);
        const plan = fewestPayments(owed);
        const after = { ...owed };
        for (const p of plan) {
          expect(p.amountMinor).toBeGreaterThan(0);
          after[p.fromPersonId]! += p.amountMinor;
          after[p.toPersonId]! -= p.amountMinor;
        }
        expect(Object.values(after).every((v) => v === 0)).toBe(true);
        const nonZero = Object.values(owed).filter((v) => v !== 0).length;
        expect(plan.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
        const reversed = Object.fromEntries(Object.entries(owed).reverse());
        expect(fewestPayments(reversed)).toEqual(plan);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('each phone’s lines balance per currency and move its trip balance by exactly its Balances figure', () => {
    const accounts = { shareAccountId: 'share', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx' };
    const perCurrency = (lines: PostingLine[]) => {
      const sums = new Map<string, number>();
      for (const l of lines) sums.set(l.currency, (sums.get(l.currency) ?? 0) + l.amountMinor);
      return [...sums.values()];
    };
    fc.assert(
      fc.property(fc.array(expenseArb('TRY'), { minLength: 1, maxLength: 6 }), fc.array(settlementArb, { maxLength: 3 }), personArb, (expenses, settlements, me) => {
        let trip = 0;
        for (const e of expenses) {
          const paidFrom = e.payerPersonId === me ? { accountId: 'bank', currency: e.currency, chargedMinor: e.amountMinor } : null;
          const out = myExpenseLines({ expense: e, eventCurrency: 'TRY', me, accounts, paidFrom });
          if (out.kind !== 'lines') continue;
          expect(perCurrency(out.lines).every((sum) => sum === 0)).toBe(true);
          expect(out.lines.every((l) => l.amountMinor !== 0)).toBe(true);
          trip += out.lines.filter((l) => l.accountId === 'trip').reduce((sum, l) => sum + l.amountMinor, 0);
        }
        for (const s of settlements) {
          const out = mySettlementLines({ settlement: s, eventCurrency: 'TRY', me, eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: { accountId: 'bank', currency: 'TRY', amountMinor: s.amountMinor } });
          if (out.kind !== 'lines') continue;
          expect(perCurrency(out.lines).every((sum) => sum === 0)).toBe(true);
          trip += out.lines.filter((l) => l.accountId === 'trip').reduce((sum, l) => sum + l.amountMinor, 0);
        }
        expect(trip).toBe(balances(expenses, settlements, 'TRY', PEOPLE)[me]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
