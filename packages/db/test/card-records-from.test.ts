import { expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardRecordsFrom,
  cardStatementLines,
  planInstalmentStatuses,
  createAccount,
  createBook,
  inBook,
  listAccounts,
  personalBook,
  postTransaction,
  saveCardTerms,
  saveInstallment,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * The day a card's records start in the app (TF 138): what its balance is known from — its opening balance, else the
 * day it is counted from, else its first real transaction — read owner-wide, whatever workspace is open. Lines that set
 * no balance never move it earlier: a purchase recorded as already paid off before the app (and its balancing
 * settlement, posted against Opening Balances on the purchase's own day), a past purchase. Invented figures: the
 * owner's plan, 24 months from March 2025, statement day the 13th, the card kept from October 2026.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function owner(opening: { openingBalanceMinor: number; openedOn: string } | null) {
  current = await setupDb();
  const { database } = current;
  const personal = await personalBook(database, current.ws);
  const family = await createBook(database, current.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
  const ws = inBook(current.ws, personal.id);
  const card = await createAccount(database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', ...(opening ?? {}) });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 13, dueDay: 2, creditLimitMinor: null, annualFeeMinor: null });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const buy = (occurredOn: string, amountMinor: number, extra: { settledBeforeApp?: boolean; pastPurchase?: boolean } = {}) =>
    postTransaction(database, ws, { occurredOn, description: 'Purchase', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor, currency: 'IDR' }), ...extra });
  const plan = () => saveInstallment(database, ws, { cardAccountId: card.id, description: 'Bond', totalMinor: 24_000_000, months: 24, firstBilledMonth: '2025-03', countMode: 'at_purchase', addedAt: '2026-11-16T05:00:00.000Z' });
  const familyWs = inBook(current.ws, family);
  return { database, ws, familyWs, card: card.id, buy, plan };
}

describe('the day a card’s records start', () => {
  it('is its opening balance, not an older purchase marked paid off before the app', async () => {
    const o = await owner({ openingBalanceMinor: 6_000_000, openedOn: '2026-10-01' });
    await o.buy('2024-12-05', 450_000, { settledBeforeApp: true });
    expect(await cardRecordsFrom(o.database.db, o.ws, o.card)).toBe('2026-10-01');
  });

  it('is its first real transaction when it has no opening balance: a paid-off or past purchase sets no balance', async () => {
    const o = await owner(null);
    await o.buy('2024-12-05', 450_000, { settledBeforeApp: true });
    await o.buy('2025-01-20', 300_000, { pastPurchase: true });
    await o.buy('2026-10-03', 120_000);
    expect(await cardRecordsFrom(o.database.db, o.ws, o.card)).toBe('2026-10-03');
  });

  it('reads the same whichever workspace is open', async () => {
    const o = await owner({ openingBalanceMinor: 6_000_000, openedOn: '2026-10-01' });
    await o.buy('2024-12-05', 450_000, { settledBeforeApp: true });
    expect(await cardRecordsFrom(o.database.db, o.familyWs, o.card)).toBe('2026-10-01');
  });

  // A plan with no purchase never reads the records start (0124): every instalment is on its statement, those paid by
  // the day it was added marked paid.
  it('leaves the owner’s plan from before the records on every statement, paid by the day it was added', async () => {
    const o = await owner({ openingBalanceMinor: 6_000_000, openedOn: '2026-10-01' });
    await o.buy('2024-12-05', 450_000, { settledBeforeApp: true });
    const planId = await o.plan();
    const rows = (await cardStatementLines(o.database, o.ws, o.card)).filter((line) => line.instalment);
    expect(rows.map((line) => line.instalment!.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(rows.filter((line) => line.paidOff).map((line) => line.instalment!.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const statuses = await planInstalmentStatuses(o.database, o.ws, planId, '2026-11-16');
    expect(statuses.filter((s) => s.status === 'paid')).toHaveLength(20);
    void inBook;
  });

  // TF 139, owner's phone: the card holds nothing but the plan. Its owed line is no record of the card's own.
  it('is none for a card holding only a plan’s owed line', async () => {
    const o = await owner(null);
    await o.plan();
    expect(await cardRecordsFrom(o.database.db, o.ws, o.card)).toBeNull();
  });
});
