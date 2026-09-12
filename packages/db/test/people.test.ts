import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  debtHistory,
  forgiveRemainder,
  peopleDebts,
  recordLoan,
  recordRepayment,
  saveDebtProfile,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-12';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 100_000_000, openedOn: '2026-01-01' });
});

const lend = (name: string, amountMinor: number, occurredOn = '2026-08-05', extra: { reason?: string; dueOn?: string } = {}) =>
  recordLoan(database, ws, {
    person: { name, direction: 'lent', currency: 'IDR', reason: extra.reason ?? null, dueOn: extra.dueOn ?? null },
    occurredOn,
    amountMinor,
    moneyAccountId: bca.id,
  });

const borrow = (name: string, amountMinor: number, occurredOn = '2026-08-05') =>
  recordLoan(database, ws, { person: { name, direction: 'borrowed', currency: 'IDR' }, occurredOn, amountMinor, moneyAccountId: bca.id });

const repay = (debtAccountId: string, amountMinor: number, occurredOn = '2026-09-01') =>
  recordRepayment(database, ws, { debtAccountId, occurredOn, amountMinor, moneyAccountId: bca.id });

const people = () => peopleDebts(database, ws, TODAY);

describe('peopleDebts', () => {
  it('gathers three loans to one person onto one card', async () => {
    const first = await lend('Andi', 5_000_000, '2026-07-01');
    await recordLoan(database, ws, { debtAccountId: first.debtAccountId, occurredOn: '2026-08-01', amountMinor: 3_000_000, moneyAccountId: bca.id });
    await recordLoan(database, ws, { debtAccountId: first.debtAccountId, occurredOn: '2026-09-01', amountMinor: 2_000_000, moneyAccountId: bca.id });

    const { owedToYou } = await people();
    expect(owedToYou).toHaveLength(1);
    expect(owedToYou[0]).toMatchObject({ personName: 'Andi', direction: 'lent', totalMinor: 10_000_000 });
    expect(owedToYou[0]!.loans).toHaveLength(1);
    expect(owedToYou[0]!.loans[0]).toMatchObject({ originalMinor: 10_000_000, balanceMinor: 10_000_000, repaidMinor: 0 });
  });

  it('keeps money lent and money borrowed on their own sides', async () => {
    await lend('Andi', 5_000_000);
    await borrow('Budi', 3_000_000);

    const { owedToYou, youOwe } = await people();
    expect(owedToYou.map((person) => person.personName)).toEqual(['Andi']);
    expect(youOwe.map((person) => person.personName)).toEqual(['Budi']);
    expect(youOwe[0]!.totalMinor).toBe(3_000_000);
  });

  it('reports what came back and what is left', async () => {
    const { debtAccountId } = await lend('Andi', 10_000_000);
    await repay(debtAccountId, 4_000_000);

    const { owedToYou } = await people();
    expect(owedToYou[0]!.totalMinor).toBe(6_000_000);
    expect(owedToYou[0]!.loans[0]).toMatchObject({ originalMinor: 10_000_000, balanceMinor: 6_000_000, repaidMinor: 4_000_000 });
  });

  it('moves a person who paid everything back to the settled list', async () => {
    const { debtAccountId } = await lend('Andi', 10_000_000);
    await repay(debtAccountId, 10_000_000);

    const { owedToYou, settled } = await people();
    expect(owedToYou).toEqual([]);
    expect(settled.map((person) => person.personName)).toEqual(['Andi']);
    expect(settled[0]!.loans[0]).toMatchObject({ status: 'settled', balanceMinor: 0 });
  });

  it('lists a forgiven debt as settled, not as money still owed', async () => {
    const { debtAccountId } = await lend('Andi', 10_000_000);
    await forgiveRemainder(database, ws, { debtAccountId, occurredOn: '2026-09-02' });

    const { owedToYou, settled } = await people();
    expect(owedToYou).toEqual([]);
    expect(settled[0]!.loans[0]!.status).toBe('forgiven');
  });

  it('carries the due date and the state it implies', async () => {
    const { debtAccountId } = await lend('Andi', 10_000_000, '2026-08-05', { dueOn: '2026-09-18', reason: 'Motorcycle repair' });

    const { owedToYou } = await people();
    expect(owedToYou[0]!.dueState).toBe('due_soon');
    expect(owedToYou[0]!.loans[0]).toMatchObject({ dueOn: '2026-09-18', dueState: 'due_soon', reason: 'Motorcycle repair' });
    expect(debtAccountId).toBeTruthy();
  });

  it('takes the worst due state across a person loans', async () => {
    const overdue = await createAccount(database, ws, { name: 'Andi overdue', kind: 'asset', subtype: 'receivable', currency: 'IDR' });
    await saveDebtProfile(database, ws, { accountId: overdue.id, personName: 'Andi', dueOn: '2026-08-01' });
    await recordLoan(database, ws, { debtAccountId: overdue.id, occurredOn: '2026-07-01', amountMinor: 1_000_000, moneyAccountId: bca.id });
    const soon = await createAccount(database, ws, { name: 'Andi soon', kind: 'asset', subtype: 'receivable', currency: 'IDR' });
    await saveDebtProfile(database, ws, { accountId: soon.id, personName: 'Andi', dueOn: '2026-09-18' });
    await recordLoan(database, ws, { debtAccountId: soon.id, occurredOn: '2026-07-01', amountMinor: 2_000_000, moneyAccountId: bca.id });

    const { owedToYou } = await people();
    expect(owedToYou).toHaveLength(1);
    expect(owedToYou[0]!.loans).toHaveLength(2);
    expect(owedToYou[0]!.dueState).toBe('overdue');
    expect(owedToYou[0]!.totalMinor).toBe(3_000_000);
  });

  it('says nothing for a workspace where nobody owes anybody', async () => {
    await expect(people()).resolves.toEqual({ owedToYou: [], youOwe: [], settled: [] });
  });
});

describe('debtHistory', () => {
  it('lists the loan, its repayments and a forgiveness in date order', async () => {
    const { debtAccountId } = await lend('Andi', 10_000_000, '2026-07-01');
    await repay(debtAccountId, 3_000_000, '2026-08-01');
    await forgiveRemainder(database, ws, { debtAccountId, occurredOn: '2026-09-01' });

    const history = await debtHistory(database, ws, debtAccountId);
    expect(history.map((row) => [row.occurredOn, row.kind, row.amountMinor])).toEqual([
      ['2026-07-01', 'lend', 10_000_000],
      ['2026-08-01', 'repayment', 3_000_000],
      ['2026-09-01', 'forgive', 7_000_000],
    ]);
  });

  it('keeps interest beside the principal it came with', async () => {
    const { debtAccountId } = await lend('Andi', 10_000_000, '2026-07-01');
    await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-08-01', amountMinor: 3_000_000, interestMinor: 200_000, moneyAccountId: bca.id });

    const history = await debtHistory(database, ws, debtAccountId);
    expect(history[1]).toMatchObject({ kind: 'repayment', amountMinor: 3_000_000, interestMinor: 200_000 });
  });

  it('leaves a voided repayment out, and the balance as it was', async () => {
    const { debtAccountId } = await lend('Andi', 10_000_000, '2026-07-01');
    const repayment = await repay(debtAccountId, 3_000_000, '2026-08-01');

    await voidTransaction(database, ws, repayment.transactionId);

    const history = await debtHistory(database, ws, debtAccountId);
    expect(history.map((row) => row.kind)).toEqual(['lend']);
    const { owedToYou } = await people();
    expect(owedToYou[0]!.totalMinor).toBe(10_000_000);
  });
});
