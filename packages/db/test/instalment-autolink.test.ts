import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autoLinkInstalmentPlans,
  categoryTotalsIn,
  createAccount,
  inBook,
  instalmentAutoLinkKey,
  listAccounts,
  listInstallments,
  periodFlows,
  personalBook,
  postTransaction,
  saveCardTerms,
  saveInstallment,
  setInstallmentCountMode,
  updateInstallment,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * Plans saved before a plan could name its purchase (owner, 16 Nov 2026: "I don't want to pick manually"). Invented
 * figures: a card the app has kept since 1 Oct 2025 (its opening balance), statement day the 18th.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function card(openedOn = '2025-10-01') {
  current = await setupDb();
  const { database } = current;
  const book = await personalBook(database, current.ws);
  const ws = inBook(current.ws, book.id);
  const visa = await createAccount(database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 3_000_000, openedOn });
  await saveCardTerms(database, ws, { accountId: visa.id, statementDay: 18, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const all = await listAccounts(database, ws);
  const electronics = all.find((a) => a.systemKey === 'shopping.electronics')!.id;
  const buy = (occurredOn: string, amountMinor: number, description = 'Purchase') =>
    postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  // As the old sheet saved them: no purchase, At purchase (0120 left them so).
  const plan = async (description: string, totalMinor: number, months: number, firstBilledMonth: string) => {
    const id = await saveInstallment(database, ws, { cardAccountId: visa.id, description, totalMinor, months, firstBilledMonth, countMode: 'at_purchase' });
    return id;
  };
  const planOf = async (id: string) => (await listInstallments(database, ws)).find((p) => p.id === id)!;
  const spent = async (from: string, to: string) => (await categoryTotalsIn(database, ws, 'expense', from, to, { billMonths: true })).rows.reduce((s, r) => s + r.amountBaseMinor, 0);
  return { database, ws, visa: visa.id, electronics, buy, plan, planOf, spent };
}

describe('auto-linking the plans saved before a plan named its purchase', () => {
  it('ties a plan to the one purchase of its total in its window, counts it Each month, and runs once', async () => {
    const c = await card();
    const laptop = await c.buy('2026-11-10', 12_000_000, 'Laptop');
    await c.buy('2026-11-12', 50_000);
    const id = await c.plan('Laptop', 12_000_000, 12, '2026-12');
    expect(await autoLinkInstalmentPlans(c.database, c.ws)).toEqual({ linked: 1, left: 0 });
    expect(await c.planOf(id)).toMatchObject({ transactionId: laptop, countMode: 'each_month' });
    const [key] = await c.database.db.values<[string]>(sql`SELECT key FROM settings WHERE key = ${instalmentAutoLinkKey(c.ws.workspaceId)}`);
    expect(key).toBeDefined();
    // Set back to None by the owner: never tied again.
    const plan = await c.planOf(id);
    await updateInstallment(c.database, c.ws, { id, description: plan.description, totalMinor: plan.totalMinor, months: plan.months, firstBilledMonth: plan.firstBilledMonth, earnsPoints: plan.earnsPoints, transactionId: null, countMode: 'at_purchase' });
    expect(await autoLinkInstalmentPlans(c.database, c.ws)).toBeNull();
    expect((await c.planOf(id)).transactionId).toBeNull();
  });

  it('ties an 18-of-24 plan whose purchase is in the app, by its first billed month, not today', async () => {
    const c = await card('2025-01-01');
    const sofa = await c.buy('2025-05-20', 24_000_000, 'Sofa');
    const id = await c.plan('Sofa', 24_000_000, 24, '2025-06');
    expect(await autoLinkInstalmentPlans(c.database, c.ws)).toMatchObject({ linked: 1 });
    expect(await c.planOf(id)).toMatchObject({ transactionId: sofa, countMode: 'each_month' });
    // The purchase counts nothing in May 2025; each month counts Rp 1.000.000.
    expect(await c.spent('2025-05-01', '2025-05-31')).toBe(0);
    expect(await c.spent('2026-11-01', '2026-11-30')).toBe(1_000_000);
  });

  it('leaves a plan whose purchase is not in the app as it is; Each month, it counts from the card’s start only', async () => {
    // Kept since 1 Oct 2025; a 24-month plan first billed May 2024: instalments 18–24 (Oct 2025 – Apr 2026) are the app's.
    const c = await card('2025-10-01');
    const id = await c.plan('Phone', 24_000_000, 24, '2024-05');
    expect(await autoLinkInstalmentPlans(c.database, c.ws)).toEqual({ linked: 0, left: 1 });
    expect(await c.planOf(id)).toMatchObject({ transactionId: null, countMode: 'at_purchase' });
    await setInstallmentCountMode(c.database, c.ws, id, 'each_month');
    expect(await c.spent('2024-05-01', '2025-09-30')).toBe(0);
    expect(await c.spent('2025-10-01', '2025-10-31')).toBe(1_000_000);
    expect(await c.spent('2025-10-01', '2026-12-31')).toBe(7_000_000);
    // Under Uncategorised, which is made for it.
    const unfiled = (await listAccounts(c.database, c.ws)).find((a) => a.systemKey === 'uncategorised')!;
    expect((await categoryTotalsIn(c.database, c.ws, 'expense', '2025-10-01', '2025-10-31')).rows).toEqual([{ accountId: unfiled.id, amountBaseMinor: 1_000_000, transactions: 1 }]);
    const flows = await periodFlows(c.database, c.ws, { from: '2024-05-01', to: '2026-04-30' });
    expect(flows.debtPaymentsMinor).toBe(0);
    expect(flows.byMonth.filter((m) => m.month < '2025-10').every((m) => m.spendingMinor === 0)).toBe(true);
  });

  it('leaves a plan with two purchases of its total, or none, inside the records', async () => {
    const c = await card('2025-01-01');
    await c.buy('2026-11-10', 12_000_000, 'Laptop A');
    await c.buy('2026-11-11', 12_000_000, 'Laptop B');
    const twice = await c.plan('Laptop', 12_000_000, 12, '2026-12');
    const none = await c.plan('Bike', 6_000_000, 6, '2026-12');
    expect(await autoLinkInstalmentPlans(c.database, c.ws)).toEqual({ linked: 0, left: 2 });
    for (const id of [twice, none]) expect(await c.planOf(id)).toMatchObject({ transactionId: null, countMode: 'at_purchase' });
  });

  it('leaves two plans that would both take the same purchase', async () => {
    const c = await card('2025-01-01');
    await c.buy('2026-11-10', 12_000_000, 'Laptop');
    const a = await c.plan('Laptop', 12_000_000, 12, '2026-12');
    const b = await c.plan('Laptop again', 12_000_000, 6, '2026-12');
    expect(await autoLinkInstalmentPlans(c.database, c.ws)).toEqual({ linked: 0, left: 2 });
    for (const id of [a, b]) expect((await c.planOf(id)).transactionId).toBeNull();
  });
});

describe('a plan with no purchase in a category of its own (0122)', () => {
  it('counts Each month in that category', async () => {
    const c = await card('2025-10-01');
    const id = await saveInstallment(c.database, c.ws, { cardAccountId: c.visa, description: 'Phone', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2025-11', categoryAccountId: c.electronics });
    expect((await c.planOf(id)).categoryAccountId).toBe(c.electronics);
    expect((await categoryTotalsIn(c.database, c.ws, 'expense', '2025-11-01', '2025-11-30')).rows).toEqual([{ accountId: c.electronics, amountBaseMinor: 1_000_000, transactions: 1 }]);
  });

  it('refuses a category that is not spending', async () => {
    const c = await card();
    await expect(saveInstallment(c.database, c.ws, { cardAccountId: c.visa, description: 'x', totalMinor: 1_000_000, months: 2, firstBilledMonth: '2025-11', categoryAccountId: c.visa })).rejects.toThrow('spending category');
  });
});

describe('instalments before the card’s records start count nowhere', () => {
  it('an investment plan with no purchase is put away only from the card’s start', async () => {
    const c = await card('2025-10-01');
    await c.plan('Phone', 24_000_000, 24, '2024-05');
    const flows = await periodFlows(c.database, c.ws, { from: '2024-05-01', to: '2026-04-30' });
    // Only instalments 18–24, billed from 18 Oct 2025; saving, never a debt payment.
    expect(flows.putAwayMinor).toBe(7_000_000);
    expect(flows.debtPaymentsMinor).toBe(0);
    expect((await periodFlows(c.database, c.ws, { from: '2024-05-01', to: '2025-09-30' })).putAwayMinor).toBe(0);
  });
});

describe('the app decides how a plan counts (TF 139)', () => {
  it('moves a plan tied to a spending purchase to Each month once; one with no purchase keeps At purchase, an investment', async () => {
    const { repairInstalmentCounting } = await import('../src/index');
    const c = await card('2025-01-01');
    const laptop = await c.buy('2026-11-10', 12_000_000, 'Laptop');
    const tied = await saveInstallment(c.database, c.ws, { cardAccountId: c.visa, description: 'Laptop', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-12', transactionId: laptop, countMode: 'at_purchase' });
    const bond = await c.plan('Bond', 24_000_000, 24, '2025-03');
    expect(await repairInstalmentCounting(c.database, c.ws)).toEqual({ moved: 1 });
    expect((await c.planOf(tied)).countMode).toBe('each_month');
    expect((await c.planOf(bond)).countMode).toBe('at_purchase');
    expect(await repairInstalmentCounting(c.database, c.ws)).toBeNull();
  });
});
