import { beforeEach, describe, expect, it } from 'vitest';
import {
  categoryIdsByKeyTx,
  confirmDepositEvent,
  type Database,
  DEPOSIT_PENALTY_CATEGORY_KEY,
  depositIncomePayments,
  getDepositAutomation,
  incomeInputsFor,
  listAccounts,
  listDueDeposits,
  nativeBalances,
  openCashAccount,
  saveDepositAutomation,
  type SaveDepositAutomationInput,
  voidTransaction,
  withdrawDeposit,
  type WithdrawDepositInput,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bcaId: string;
let depositoId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bcaId = (await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-07-15' })).id;
  depositoId = (
    await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'BCA Deposito',
      currency: 'IDR',
      openingBalanceMinor: 50_000_000,
      openedOn: '2026-07-15',
      maturesOn: '2026-10-15',
      rateBps: 425,
    })
  ).id;
});

const on = (accountId: string, payoutAccountId: string, change: Partial<SaveDepositAutomationInput> = {}): SaveDepositAutomationInput => ({
  accountId,
  enabled: true,
  atMaturity: 'principal',
  interestPaid: 'at_maturity',
  payoutAccountId,
  termMonths: 3,
  keepRate: true,
  taxBps: 2_000,
  taxExempt: false,
  today: '2026-07-15',
  ...change,
});

const out = (change: Partial<WithdrawDepositInput> = {}): WithdrawDepositInput => ({
  accountId: depositoId,
  intoAccountId: bcaId,
  occurredOn: '2026-09-01',
  principalMinor: 50_000_000,
  grossMinor: 0,
  taxMinor: 0,
  penaltyMinor: 0,
  ...change,
});

/** Income is a credit, so it reads negative; the tax and the fee are debits. */
async function categories() {
  const keys = await categoryIdsByKeyTx(database.db, ws);
  const balances = await nativeBalances(database, ws);
  return {
    income: balances[keys['income.investment']!] ?? 0,
    tax: balances[keys['government_taxes.estimated_tax']!] ?? 0,
    fee: balances[keys[DEPOSIT_PENALTY_CATEGORY_KEY]!] ?? 0,
  };
}

describe('breaking a deposit early', () => {
  it('moves the principal, posts the penalty under Fees & charges, and closes the deposit', async () => {
    const result = await withdrawDeposit(database, ws, out({ penaltyMinor: 250_000 }));
    expect(result).toMatchObject({ landedMinor: 49_750_000, archived: true, interestTransactionId: null });
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(50_750_000);
    expect(balances[depositoId] ?? 0).toBe(0);
    expect(await categories()).toEqual({ income: 0, tax: 0, fee: 250_000 });
    expect((await listAccounts(database, ws)).map((a) => a.id)).not.toContain(depositoId);
    // Nothing with no interest reaches the tax report.
    expect(await depositIncomePayments(database, ws)).toEqual([]);
  });

  it('posts interest and tax as a confirmed payout does, and the tax report reads them', async () => {
    await withdrawDeposit(database, ws, out({ grossMinor: 100_000, taxMinor: 20_000, penaltyMinor: 50_000 }));
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000 + 50_000_000 + 80_000 - 50_000);
    expect(await categories()).toEqual({ income: -100_000, tax: 20_000, fee: 50_000 });
    expect(await depositIncomePayments(database, ws)).toEqual([
      expect.objectContaining({ accountId: depositoId, kind: 'income', occurredOn: '2026-09-01', grossMinor: 100_000, taxMinor: 20_000 }),
    ]);
    const report = await incomeInputsFor(database, ws, 2026);
    expect(report.find((row) => row.name === 'BCA Deposito')).toMatchObject({ grossMinor: 100_000, taxMinor: 20_000 });
  });

  it('switches automation off, so nothing is proposed after', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    await withdrawDeposit(database, ws, out());
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(false);
    expect(await listDueDeposits(database, ws, '2026-10-15')).toEqual([]);
  });

  it('keeps the deposit open when money is left in it', async () => {
    const result = await withdrawDeposit(database, ws, out({ principalMinor: 49_000_000 }));
    expect(result.archived).toBe(false);
    expect((await nativeBalances(database, ws))[depositoId]).toBe(1_000_000);
  });

  it('is taken back whole by voiding the principal, as a close is', async () => {
    const result = await withdrawDeposit(database, ws, out({ grossMinor: 100_000, taxMinor: 20_000 }));
    await voidTransaction(database, ws, result.principalTransactionId);
    const balances = await nativeBalances(database, ws);
    expect(balances[depositoId]).toBe(50_000_000);
    expect(balances[bcaId]).toBe(1_000_000);
    expect((await listAccounts(database, ws)).map((a) => a.id)).toContain(depositoId);
    expect(await depositIncomePayments(database, ws)).toEqual([]);
  });
});

describe('withdrawing a matured deposit', () => {
  it('lands principal + interest − tax, and reads as a close to the log', async () => {
    const result = await withdrawDeposit(database, ws, out({ occurredOn: '2026-10-15', grossMinor: 535_616, taxMinor: 107_123 }));
    expect(result).toMatchObject({ landedMinor: 50_428_493, archived: true, penaltyTransactionId: null });
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(51_428_493);
    expect(await categories()).toEqual({ income: -535_616, tax: 107_123, fee: 0 });
  });
});

describe('refusals', () => {
  it('refuses more than the deposit holds, a penalty larger than what lands, and tax over the interest', async () => {
    await expect(withdrawDeposit(database, ws, out({ principalMinor: 50_000_001 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(withdrawDeposit(database, ws, out({ principalMinor: 1_000, penaltyMinor: 2_000 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(withdrawDeposit(database, ws, out({ grossMinor: 1_000, taxMinor: 2_000 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(withdrawDeposit(database, ws, out({ principalMinor: 0 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    // Nothing was written by any of them.
    expect((await nativeBalances(database, ws))[depositoId]).toBe(50_000_000);
  });

  it('refuses an account money cannot land in, and the deposit itself', async () => {
    const usd = await openCashAccount(database, ws, { item: 'bank', name: 'Dollars', currency: 'USD' });
    await expect(withdrawDeposit(database, ws, out({ intoAccountId: usd.id }))).rejects.toMatchObject({ code: 'BAD_PAYOUT' });
    await expect(withdrawDeposit(database, ws, out({ intoAccountId: depositoId }))).rejects.toMatchObject({ code: 'BAD_PAYOUT' });
  });

  it('refuses a day before a payout already logged, and a closed deposit', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const [first] = await listDueDeposits(database, ws, '2026-08-15');
    await confirmDepositEvent(database, ws, {
      accountId: depositoId,
      kind: first!.event.kind,
      dueOn: first!.event.dueOn,
      today: '2026-08-15',
      principalMinor: first!.principalMinor,
      grossMinor: first!.grossMinor,
      taxMinor: first!.taxMinor,
    });
    await expect(withdrawDeposit(database, ws, out({ occurredOn: '2026-08-01' }))).rejects.toMatchObject({ code: 'NOT_LAST' });
    await withdrawDeposit(database, ws, out({ occurredOn: '2026-08-20' }));
    await expect(withdrawDeposit(database, ws, out({ occurredOn: '2026-08-21' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
