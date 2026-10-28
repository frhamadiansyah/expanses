import { expenseLines, statementCycleFor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  cardStatementMonths,
  catchUpAllCycles,
  clearCycleActual,
  createAccount,
  createProgram,
  deriveCycleEntries,
  firstCardPurchaseOn,
  listAccounts,
  postTransaction,
  programBalance,
  recordCycleActual,
  recordPointSnapshot,
  replaceTransaction,
  saveCardTerms,
  saveEarnRule,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-13';

/** A card earning 1 point per Rp 10.000, statement on the 20th, with one purchase in the current cycle. */
async function card() {
  const { database, ws } = await setupDb();
  const account = await createAccount(database, ws, { name: 'CIMB Octo', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const groceries = all.find((a) => a.name === 'Groceries')!.id;
  await saveCardTerms(database, ws, { accountId: account.id, statementDay: 20, dueDay: 8, creditLimitMinor: null, annualFeeMinor: 0 });
  const program = await createProgram(database, ws, { cardAccountId: account.id, name: 'Octo Points', unit: 'points', cycleAnchor: 'statement' });
  await saveEarnRule(database, ws, program.id, {
    name: 'Base',
    priority: 0,
    stackable: false,
    match: {},
    rateNum: 1,
    rateDen: 10_000,
    rounding: 'per_transaction_floor',
    capSpendMinor: null,
    capPoints: null,
    minTransactionMinor: null,
    validFrom: null,
    validTo: null,
  });
  const buy = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, {
      occurredOn,
      description: 'Shop',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: account.id, amountMinor, currency: 'IDR' }),
    });
  return { database, ws, account, program, buy, groceries };
}

const total = async (c: Awaited<ReturnType<typeof card>>) => (await programBalance(c.database, c.ws, c.program.id, TODAY)).total;

describe('catching up to the first purchase', () => {
  it('works out every cycle back to the first purchase, however far, and no further', async () => {
    const c = await card();
    await c.buy('2026-09-01', 1_000_000);
    await c.buy('2024-02-05', 2_000_000);
    expect(await firstCardPurchaseOn(c.database, c.ws, c.account.id)).toBe('2024-02-05');

    const result = await catchUpAllCycles(c.database, c.ws, c.program.id, TODAY);
    expect(result).toMatchObject({ added: 2, firstPurchaseOn: '2024-02-05' });
    expect(await total(c)).toBe(300);

    const { months } = await cardStatementMonths(c.database, c.ws, c.program.id, TODAY);
    expect(months[0]!.end).toBe('2026-09-20');
    // The cycle holding 5 Feb 2024 is the last one listed.
    expect(months[months.length - 1]!.start <= '2024-02-05' && months[months.length - 1]!.end >= '2024-02-05').toBe(true);
    expect(months.find((m) => m.end === '2024-02-20')).toMatchObject({ points: 200, posted: false, typed: null });
  });

  it('has nothing to find on a card with no purchase', async () => {
    const c = await card();
    expect(await catchUpAllCycles(c.database, c.ws, c.program.id, TODAY)).toEqual({ added: 0, walked: 0, firstPurchaseOn: null });
    expect((await cardStatementMonths(c.database, c.ws, c.program.id, TODAY)).months).toEqual([]);
  });

  it('changes nothing when run again', async () => {
    const c = await card();
    await c.buy('2026-09-01', 1_000_000);
    await c.buy('2025-03-05', 2_000_000);
    await catchUpAllCycles(c.database, c.ws, c.program.id, TODAY);
    const first = await total(c);
    expect(await catchUpAllCycles(c.database, c.ws, c.program.id, TODAY)).toMatchObject({ added: 0 });
    expect(await total(c)).toBe(first);
    expect(first).toBe(300);
  });
});

describe('a typed statement figure', () => {
  it('replaces the estimate for that cycle, never adding to it, and clearing it brings the estimate back', async () => {
    const c = await card();
    await c.buy('2025-03-05', 2_000_000);
    await catchUpAllCycles(c.database, c.ws, c.program.id, TODAY);
    const cycle = statementCycleFor('2025-03-05', 20);
    expect(await total(c)).toBe(200);

    await recordCycleActual(c.database, c.ws, { programId: c.program.id, cycleStart: cycle.start, actualPoints: 260 });
    await deriveCycleEntries(c.database, c.ws, c.program.id, cycle);
    expect(await total(c)).toBe(260);
    let month = (await cardStatementMonths(c.database, c.ws, c.program.id, TODAY)).months.find((m) => m.start === cycle.start)!;
    expect(month).toMatchObject({ points: 260, posted: true, typed: 260 });

    await clearCycleActual(c.database, c.ws, { programId: c.program.id, cycleStart: cycle.start });
    await deriveCycleEntries(c.database, c.ws, c.program.id, cycle);
    expect(await total(c)).toBe(200);
    month = (await cardStatementMonths(c.database, c.ws, c.program.id, TODAY)).months.find((m) => m.start === cycle.start)!;
    expect(month).toMatchObject({ points: 200, posted: false, typed: null });
  });
});

describe('saving a purchase after a catch-up', () => {
  it('works out the old cycle on its own when a purchase is added, moved or voided', async () => {
    const c = await card();
    await c.buy('2026-09-01', 1_000_000);
    await c.buy('2025-03-05', 2_000_000);
    await catchUpAllCycles(c.database, c.ws, c.program.id, TODAY);
    expect(await total(c)).toBe(300);

    // Added: the old cycle follows without another catch-up.
    const added = await c.buy('2025-03-10', 1_000_000);
    expect(await total(c)).toBe(400);

    // Moved to another old cycle: both cycles are worked out again.
    const moved = await replaceTransaction(c.database, c.ws, added, {
      occurredOn: '2025-06-10',
      description: 'Shop',
      lines: expenseLines({ categoryAccountId: c.groceries, paymentAccountId: c.account.id, amountMinor: 1_000_000, currency: 'IDR' }),
    });
    expect(await total(c)).toBe(400);
    const months = (await cardStatementMonths(c.database, c.ws, c.program.id, TODAY)).months;
    expect(months.find((m) => m.end === '2025-03-20')!.points).toBe(200);
    expect(months.find((m) => m.end === '2025-06-20')!.points).toBe(100);

    // Voided: its points go.
    await voidTransaction(c.database, c.ws, moved);
    expect(await total(c)).toBe(300);
  });
});

describe('adjusts inside the range', () => {
  it('lists the days of a balance read that fall inside the cycles worked out', async () => {
    const c = await card();
    await c.buy('2026-09-01', 1_000_000);
    await c.buy('2025-03-05', 2_000_000);
    await recordPointSnapshot(c.database, c.ws, { programId: c.program.id, balance: 500, observedOn: '2026-01-15' });
    await catchUpAllCycles(c.database, c.ws, c.program.id, TODAY);
    expect((await cardStatementMonths(c.database, c.ws, c.program.id, TODAY)).adjusts).toEqual(['2026-01-15']);
  });
});
