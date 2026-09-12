import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  categoryIdsByKey,
  createAccount,
  createWorkspace,
  type Database,
  periodFlows,
  postTransaction,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let card: AccountRow;
let kpr: AccountRow;
let categories: Record<string, string>;

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  kpr = await createAccount(database, ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
  categories = await categoryIdsByKey(database, ws);
});

const post = (occurredOn: string, description: string, lines: { accountId: string; amountMinor: number }[]) =>
  postTransaction(database, ws, { occurredOn, description, lines: lines.map((line) => ({ ...line, currency: 'IDR' })) });

const salary = (occurredOn: string, amountMinor: number) =>
  post(occurredOn, 'Salary', [
    { accountId: bca.id, amountMinor },
    { accountId: categories['income.salary']!, amountMinor: -amountMinor },
  ]);

const groceries = (occurredOn: string, amountMinor: number) =>
  post(occurredOn, 'Superindo', [
    { accountId: categories['food.groceries']!, amountMinor },
    { accountId: bca.id, amountMinor: -amountMinor },
  ]);

/** A loan payment the way the Loans slice will post it: principal off the loan, interest as an expense. */
const loanPayment = (occurredOn: string, principalMinor: number, interestMinor: number) =>
  post(occurredOn, 'KPR installment', [
    { accountId: kpr.id, amountMinor: principalMinor },
    { accountId: categories['fees.interest']!, amountMinor: interestMinor },
    { accountId: bca.id, amountMinor: -(principalMinor + interestMinor) },
  ]);

describe('periodFlows income and spending', () => {
  it('adds every income category into take-home pay', async () => {
    await salary('2026-01-28', 20_000_000);
    await post('2026-02-10', 'THR', [
      { accountId: bca.id, amountMinor: 5_000_000 },
      { accountId: categories['income.bonus']!, amountMinor: -5_000_000 },
    ]);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.incomeMinor).toBe(25_000_000);
  });

  it('leaves realized gains out of take-home pay', async () => {
    await salary('2026-01-28', 20_000_000);
    await post('2026-03-05', 'Sold shares', [
      { accountId: bca.id, amountMinor: 3_000_000 },
      { accountId: categories['income.realized_gains']!, amountMinor: -3_000_000 },
    ]);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.incomeMinor).toBe(20_000_000);
  });

  it('adds expenses into spending and leaves final tax out', async () => {
    await groceries('2026-01-15', 4_000_000);
    await post('2026-01-16', 'Final tax on a dividend', [
      { accountId: categories['government.final_tax']!, amountMinor: 500_000 },
      { accountId: bca.id, amountMinor: -500_000 },
    ]);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.spendingMinor).toBe(4_000_000);
  });

  it('ignores transfers between your own accounts and opening balances', async () => {
    const cash = await createAccount(database, ws, { name: 'Wallet cash', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await post('2026-01-20', 'Cash withdrawal', [
      { accountId: cash.id, amountMinor: 1_000_000 },
      { accountId: bca.id, amountMinor: -1_000_000 },
    ]);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.incomeMinor).toBe(0);
    expect(flows.spendingMinor).toBe(0);
  });

  it('counts only what falls inside the range', async () => {
    await salary('2025-12-28', 20_000_000);
    await salary('2026-01-28', 30_000_000);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.incomeMinor).toBe(30_000_000);
  });
});

describe('periodFlows debt payments', () => {
  it('counts the principal and the interest of a loan payment', async () => {
    await loanPayment('2026-01-25', 2_000_000, 6_000_000);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.debtPaymentsMinor).toBe(8_000_000);
    expect(flows.spendingMinor).toBe(6_000_000);
  });

  it('does not count a credit card bill paid in full', async () => {
    await post('2026-02-12', 'Card bill', [
      { accountId: card.id, amountMinor: 3_000_000 },
      { accountId: bca.id, amountMinor: -3_000_000 },
    ]);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.debtPaymentsMinor).toBe(0);
  });

  it('leaves a home loan out of consumer debt payments, interest and all', async () => {
    await loanPayment('2026-01-25', 2_000_000, 6_000_000);
    const kkb = await createAccount(database, ws, { name: 'Car loan', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 84_000_000, openedOn: '2026-01-01' });
    await post('2026-01-05', 'Car installment', [
      { accountId: kkb.id, amountMinor: 4_000_000 },
      { accountId: categories['fees.interest']!, amountMinor: 900_000 },
      { accountId: bca.id, amountMinor: -4_900_000 },
    ]);

    const flows = await periodFlows(database, ws, YEAR, { homeLoanAccountIds: [kpr.id] });
    expect(flows.debtPaymentsMinor).toBe(8_000_000 + 4_900_000);
    expect(flows.nonMortgageDebtPaymentsMinor).toBe(4_900_000);
  });

  it('counts every loan when no home loan is named', async () => {
    await loanPayment('2026-01-25', 2_000_000, 6_000_000);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.nonMortgageDebtPaymentsMinor).toBe(8_000_000);
  });

  it('ignores money borrowed, which grows the loan instead of paying it', async () => {
    await post('2026-04-01', 'Top-up borrowed', [
      { accountId: bca.id, amountMinor: 10_000_000 },
      { accountId: kpr.id, amountMinor: -10_000_000 },
    ]);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.debtPaymentsMinor).toBe(0);
  });
});

describe('periodFlows months', () => {
  it('counts only the months that have transactions', async () => {
    await salary('2026-01-28', 20_000_000);
    await groceries('2026-03-15', 4_000_000);

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.months).toBe(2);
  });

  it('never counts more than twelve months', async () => {
    for (const month of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']) await salary(`2026-${month}-05`, 1_000_000);
    await salary('2025-06-05', 1_000_000);

    const flows = await periodFlows(database, ws, { from: '2025-01-01', to: '2026-12-31' });
    expect(flows.months).toBe(12);
  });

  it('gives one row per month of the range, oldest first, empty months included', async () => {
    await salary('2026-02-28', 20_000_000);

    const flows = await periodFlows(database, ws, { from: '2026-01-01', to: '2026-03-31' });
    expect(flows.byMonth.map((row) => row.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(flows.byMonth[0]).toMatchObject({ incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0 });
    expect(flows.byMonth[1]!.incomeMinor).toBe(20_000_000);
  });

  it('keeps another workspace out', async () => {
    await salary('2026-01-28', 20_000_000);
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });

    const flows = await periodFlows(database, other, YEAR);
    expect(flows).toMatchObject({ incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0, months: 0 });
  });
});
