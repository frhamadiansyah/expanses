// packages/db/test/bill-months-figures.test.ts
import { expenseLines } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import {
  budgetSheetFor,
  categoryTotalsBetween,
  createAccount,
  listAccounts,
  listTransactions,
  nativeBalances,
  postTransaction,
  recordBillPayments,
  saveExpenseTemplate,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** August's internet (out on the 28th, pay by the 5th) paid on 3 September, and a meal on the 4th. */
async function augustInternetPaidInSeptember() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const internet = all.find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const restaurants = all.find((a) => a.systemKey === 'food_beverage.restaurants')!.id;
  const bill = await saveExpenseTemplate(database, ws, {
    name: 'Biznet Home', categoryAccountId: internet, moneyAccountId: bank.id, amountMinor: 450_000, dayOfMonth: 28, payByDay: 5, startsMonth: '2026-08',
  });
  const [payment] = await recordBillPayments(database, ws, { paidOn: '2026-09-03', payments: [{ templateId: bill, billMonth: '2026-08', amountMinor: 450_000 }] });
  await postTransaction(database, ws, {
    occurredOn: '2026-09-04',
    description: 'Warung',
    lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: bank.id, amountMinor: 100_000, currency: 'IDR' }),
  });
  return { database, ws, bank, bill, internet, restaurants, payment: payment! };
}

const ids = (rows: { accountId: string }[]) => rows.map((r) => r.accountId).sort();

it('category totals asked for by bill month count the bill in August', async () => {
  const { database, ws, internet, restaurants } = await augustInternetPaidInSeptember();

  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-08-01', '2026-08-31', { billMonths: true })).toEqual([
    { accountId: internet, amountBaseMinor: 450_000, transactions: 1 },
  ]);
  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-09-01', '2026-09-30', { billMonths: true })).toEqual([
    { accountId: restaurants, amountBaseMinor: 100_000, transactions: 1 },
  ]);
  // A week holds it on the bill's out day, not on the first of the month.
  expect(ids(await categoryTotalsBetween(database, ws, 'expense', '2026-08-24', '2026-08-30', { billMonths: true }))).toEqual([internet]);
  // Asked without the option, nothing moves: the day paid decides, as before.
  expect(ids(await categoryTotalsBetween(database, ws, 'expense', '2026-09-01', '2026-09-30'))).toEqual([internet, restaurants].sort());
  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-08-01', '2026-08-31')).toEqual([]);
});

it('a bill paid inside its own month counts on the day it was paid', async () => {
  const { database, ws, bill, internet } = await augustInternetPaidInSeptember();
  await recordBillPayments(database, ws, { paidOn: '2026-09-30', payments: [{ templateId: bill, billMonth: '2026-09', amountMinor: 450_000 }] });
  expect(await categoryTotalsBetween(database, ws, 'expense', '2026-09-29', '2026-09-30', { billMonths: true })).toEqual([
    { accountId: internet, amountBaseMinor: 450_000, transactions: 1 },
  ]);
});

it('the budget sheet counts the bill in the month it came out', async () => {
  const { database, ws } = await augustInternetPaidInSeptember();
  expect((await budgetSheetFor(database, ws, '2026-08')).spendingActualMinor).toBe(450_000);
  expect((await budgetSheetFor(database, ws, '2026-09')).spendingActualMinor).toBe(100_000);
});

it('history and balances keep the payment on the day it was paid', async () => {
  const { database, ws, bank, payment } = await augustInternetPaidInSeptember();
  expect((await listTransactions(database, ws, { from: '2026-09-01', to: '2026-09-30' })).map((t) => t.id)).toContain(payment);
  expect(await listTransactions(database, ws, { from: '2026-08-01', to: '2026-08-31' })).toEqual([]);
  expect((await nativeBalances(database, ws, '2026-08-31'))[bank.id] ?? 0).toBe(0);
  expect((await nativeBalances(database, ws, '2026-09-30'))[bank.id]).toBe(-550_000);
});
