import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  deleteLoanAccount,
  listAccounts,
  loanFor,
  nativeBalances,
  recordLoanPayment,
  saveGoal,
  saveLoanTerms,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let loan: AccountRow;

const terms = (accountId: string) => ({
  accountId,
  lenderName: 'Kredivo',
  originalMinor: 10_000_000,
  firstPaymentOn: '2026-02-25',
  tenorMonths: 10,
  method: 'flat' as const,
  paymentDay: 25,
  rateBps: 1200,
});
const balance = async (id: string) => (await nativeBalances(database, ws, '2041-12-31'))[id] ?? 0;
const rows = async (table: string) => database.db.values(sql.raw(`SELECT * FROM ${table}`));

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  loan = await createAccount(database, ws, { name: 'Test loan', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-25' });
  await saveLoanTerms(database, ws, terms(loan.id));
});

describe('deleteLoanAccount', () => {
  it('removes a fresh loan and every row of its own', async () => {
    await deleteLoanAccount(database, ws, loan.id);

    expect(await loanFor(database, ws, loan.id)).toBeUndefined();
    expect((await listAccounts(database, ws)).some((a) => a.id === loan.id && !a.archivedAt)).toBe(false);
    expect(await balance(loan.id)).toBe(0);
    for (const t of ['loan_terms', 'loan_rate_periods', 'loan_items']) expect(await rows(t)).toHaveLength(0);
  });

  it('gives the bank back what recorded payments took', async () => {
    const before = await balance(bca.id);
    await recordLoanPayment(database, ws, { accountId: loan.id, occurredOn: '2026-02-25', moneyAccountId: bca.id, principalMinor: 1_000_000, interestMinor: 100_000 });
    await recordLoanPayment(database, ws, { accountId: loan.id, occurredOn: '2026-03-25', moneyAccountId: bca.id, principalMinor: 1_000_000, interestMinor: 100_000 });
    expect(await balance(bca.id)).toBe(before - 2_200_000);

    await deleteLoanAccount(database, ws, loan.id);

    expect(await balance(bca.id)).toBe(before);
    expect(await balance(loan.id)).toBe(0);
    expect(await loanFor(database, ws, loan.id)).toBeUndefined();
  });

  it('refuses a loan a goal has money on, and changes nothing', async () => {
    const goalId = await saveGoal(database, ws, { name: 'Holiday', kind: 'holiday', growthBps: 0, returnBps: 0, stages: [{ name: 'Trip', targetMinor: 1_000_000, dueOn: '2027-01-01' }] } as never);
    await database.db.run(sql.raw(`INSERT INTO goal_earmarks (goal_id, account_id, workspace_id, amount_minor) VALUES ('${goalId}', '${loan.id}', '${ws.workspaceId}', 1)`));

    await expect(deleteLoanAccount(database, ws, loan.id)).rejects.toThrow(/Test loan is used by the goal Holiday/);
    expect(await loanFor(database, ws, loan.id)).toBeDefined();
    expect(await balance(loan.id)).toBe(-10_000_000);
  });
});
