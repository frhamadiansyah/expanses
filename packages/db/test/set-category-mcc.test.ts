import { computeCycleEarn, type EarnRule, expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardSpendLines,
  createAccount,
  ensureDefaultCategorySets,
  listCategorySets,
  listSetCategories,
  postTransaction,
  saveCategoryMcc,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** 5 points per Rp 10.000, but only at airlines. */
const AIRLINE_RULE: EarnRule = {
  id: 'airline',
  name: '5x at airlines',
  priority: 10,
  stackable: false,
  match: { mccs: ['4511'] },
  rateNum: 5,
  rateDen: 10_000,
  rounding: 'per_increment',
  capSpendMinor: null,
  capPoints: null,
  minTransactionMinor: null,
  validFrom: null,
  validTo: null,
};

/**
 * A set category carries no key and no parent, so it inherits no MCC from anywhere. A merchant the
 * bundled list knows still resolves on its own name, so this matters for the ones it does not: a local
 * travel agent, a guesthouse, an operator abroad. Without a category MCC those are invisible to every
 * airline rule a travel card has.
 */
describe('a card MCC on a set category', () => {
  it('is what makes its spending earn the rate the card pays at airlines', async () => {
    current = await setupDb();
    const { database, ws } = current;
    await ensureDefaultCategorySets(database, ws);
    const card = await createAccount(database, ws, { name: 'Travel Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const holiday = (await listCategorySets(database, ws)).find((set) => set.name === 'Holiday')!;
    const flights = (await listSetCategories(database, ws, holiday.id)).find((row) => row.name === 'Flights')!;

    await postTransaction(database, ws, {
      occurredOn: '2026-09-09',
      description: 'AGEN TIKET SEJAHTERA',
      lines: expenseLines({ categoryAccountId: flights.id, paymentAccountId: card.id, amountMinor: 8_000_000, currency: 'IDR' }),
    });

    const earnOf = async () => {
      const lines = await cardSpendLines(database, ws, card.id, '2026-09-01', '2026-09-30');
      return { lines, earn: computeCycleEarn(lines, [AIRLINE_RULE], {}) };
    };

    // Before: a merchant the bundled list has never heard of, so nothing says this was a flight.
    const before = await earnOf();
    expect(before.lines[0]!.mcc).toBeNull();
    expect(before.earn.totalPoints).toBe(0);

    await saveCategoryMcc(database, ws, flights.id, '4511');

    // After: resolved from the category, and the same purchase earns the airline rate.
    const after = await earnOf();
    expect(after.lines[0]!.mcc).toBe('4511');
    expect(after.lines[0]!.mccSource).toBe('category');
    expect(after.earn.totalPoints).toBe(4000);
  });
});
