import { expenseLines, statementCycleFor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  createProgram,
  deriveCycleEntries,
  expireDueEntries,
  expiringSoonAcross,
  listAccounts,
  listPointEntries,
  PointsError,
  postTransaction,
  programBalance,
  saveCardTerms,
  saveEarnRule,
  setProgramExpiry,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';
/** Long enough ago that a two-year policy has already killed it. */
const LONG_AGO = '2023-05-10';

async function cardWithSpending(occurredOn: string) {
  const { database, ws } = await setupDb();
  const card = await createAccount(database, ws, { name: 'CIMB Octo', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const id = (name: string) => all.find((account) => account.name === name)!.id;

  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 8, creditLimitMinor: null, annualFeeMinor: null });
  const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'Octo Points', unit: 'points', cycleAnchor: 'statement' });
  await saveEarnRule(database, ws, program.id, {
    name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 10_000,
    rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
  });
  await postTransaction(database, ws, {
    occurredOn,
    description: 'Superindo',
    lines: expenseLines({ categoryAccountId: id('Groceries'), paymentAccountId: card.id, amountMinor: 1_000_000, currency: 'IDR' }),
  });
  return { database, ws, program, cycle: statementCycleFor(occurredOn, 20) };
}

describe('setting how points die', () => {
  it('stamps a date on the batches once a policy is set', async () => {
    const { database, ws, program, cycle } = await cardWithSpending(TODAY);
    await deriveCycleEntries(database, ws, program.id, cycle);
    expect((await listPointEntries(database, ws, program.id))[0]!.expiresOn).toBeNull();

    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 24);
    await deriveCycleEntries(database, ws, program.id, cycle);

    expect((await listPointEntries(database, ws, program.id))[0]!.expiresOn).toBe('2028-09-13');
  });

  it('kills a year of points with that year under the annual policy', async () => {
    const { database, ws, program, cycle } = await cardWithSpending(TODAY);
    await setProgramExpiry(database, ws, program.id, 'fixed_annual', null);

    await deriveCycleEntries(database, ws, program.id, cycle);

    expect((await listPointEntries(database, ws, program.id))[0]!.expiresOn).toBe('2026-12-31');
  });

  it('refuses a months policy with no months, which would silently never expire', async () => {
    const { database, ws, program } = await cardWithSpending(TODAY);

    await expect(setProgramExpiry(database, ws, program.id, 'months_from_earn', null)).rejects.toThrow(PointsError);
  });

  it('forgets the month count when the policy no longer counts months', async () => {
    const { database, ws, program, cycle } = await cardWithSpending(TODAY);
    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 24);

    await setProgramExpiry(database, ws, program.id, 'none', null);
    await deriveCycleEntries(database, ws, program.id, cycle);

    expect((await listPointEntries(database, ws, program.id))[0]!.expiresOn).toBeNull();
  });
});

describe('writing off what has died', () => {
  it('takes dead points off the balance, with an entry saying so', async () => {
    const { database, ws, program, cycle } = await cardWithSpending(LONG_AGO);
    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 24);
    await deriveCycleEntries(database, ws, program.id, cycle);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(100);

    const written = await expireDueEntries(database, ws, program.id, TODAY);

    expect(written).toBe(1);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(0);
    const expiries = (await listPointEntries(database, ws, program.id)).filter((entry) => entry.kind === 'expire');
    expect(expiries).toHaveLength(1);
    expect(expiries[0]!.quantity).toBe(-100);
  });

  it('writes nothing off twice, however often it runs', async () => {
    const { database, ws, program, cycle } = await cardWithSpending(LONG_AGO);
    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 24);
    await deriveCycleEntries(database, ws, program.id, cycle);

    await expireDueEntries(database, ws, program.id, TODAY);
    const again = await expireDueEntries(database, ws, program.id, TODAY);

    expect(again).toBe(0);
    expect((await listPointEntries(database, ws, program.id)).filter((entry) => entry.kind === 'expire')).toHaveLength(1);
  });

  it('leaves points alone while the program has no policy', async () => {
    const { database, ws, program, cycle } = await cardWithSpending(LONG_AGO);
    await deriveCycleEntries(database, ws, program.id, cycle);

    expect(await expireDueEntries(database, ws, program.id, TODAY)).toBe(0);
    expect((await programBalance(database, ws, program.id, TODAY)).total).toBe(100);
  });

  it('says what is about to die, before it does', async () => {
    const { database, ws, program, cycle } = await cardWithSpending('2024-10-01');
    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 24);
    await deriveCycleEntries(database, ws, program.id, cycle);

    // Earned 1 October 2024, so it dies 1 October 2026 — inside the sixty-day window.
    const balance = await programBalance(database, ws, program.id, TODAY);
    expect(balance.expiringSoon).toBe(100);
    expect(balance.nextExpiryOn).toBe('2026-10-01');
  });
});

describe('across every card', () => {
  it('names each program with points about to die, and leaves out the rest', async () => {
    const { database, ws, program, cycle } = await cardWithSpending('2024-10-01');
    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 24);
    await deriveCycleEntries(database, ws, program.id, cycle);

    const rows = await expiringSoonAcross(database, ws, TODAY);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ programId: program.id, cardName: 'CIMB Octo', expiringSoon: 100, nextExpiryOn: '2026-10-01' });
  });

  it('says nothing for a program whose points are not near dying', async () => {
    const { database, ws, program, cycle } = await cardWithSpending(TODAY);
    await setProgramExpiry(database, ws, program.id, 'months_from_earn', 24);
    await deriveCycleEntries(database, ws, program.id, cycle);

    expect(await expiringSoonAcross(database, ws, TODAY)).toEqual([]);
  });

  it('says nothing while no program has a policy at all', async () => {
    const { database, ws, program, cycle } = await cardWithSpending('2024-10-01');
    await deriveCycleEntries(database, ws, program.id, cycle);

    expect(await expiringSoonAcross(database, ws, TODAY)).toEqual([]);
  });
});
