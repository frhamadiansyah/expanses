import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  createWorkspace,
  type Database,
  DebtPlanError,
  debtMovements,
  getDebtPlanSettings,
  loanPlanFacts,
  nextPaymentDue,
  payOffLoan,
  postTransaction,
  recordLoanPayment,
  saveDebtPlanSettings,
  saveLoanTerms,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let kredit: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-08-01' });
  kredit = await createAccount(database, ws, { name: 'Kredit', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 6_000_000, openedOn: '2026-08-01' });
  await saveLoanTerms(database, ws, {
    accountId: kredit.id,
    lenderName: 'Kredit',
    originalMinor: 6_000_000,
    firstPaymentOn: '2026-09-01',
    tenorMonths: 6,
    method: 'annuity',
    paymentDay: 1,
    rateBps: 2_400,
  });
  await recordLoanPayment(database, ws, { accountId: kredit.id, occurredOn: '2026-09-01', moneyAccountId: bca.id, principalMinor: 951_155, interestMinor: 120_000 });
  const due = (await nextPaymentDue(database, ws, kredit.id, '2026-10-03'))!;
  await recordLoanPayment(database, ws, { accountId: kredit.id, occurredOn: '2026-10-03', moneyAccountId: bca.id, principalMinor: due.principalMinor, interestMinor: due.interestMinor });
});

describe('debtMovements', () => {
  it('reads every posted movement on the debt accounts, with the lines riding on it', async () => {
    const rows = await debtMovements(database, ws, [kredit.id]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ accountId: kredit.id, occurredOn: '2026-08-01', amountMinor: -6_000_000, chargesMinor: 0, interestMinor: 0 });
    expect(rows[1]).toMatchObject({ occurredOn: '2026-09-01', amountMinor: 951_155, interestMinor: 120_000, chargesMinor: 120_000, fromMessage: false });
  });

  it('keeps to a range', async () => {
    const rows = await debtMovements(database, ws, [kredit.id], { from: '2026-10-01' });
    expect(rows.map((r) => r.occurredOn)).toEqual(['2026-10-03']);
  });

  it('no accounts, no rows', async () => {
    expect(await debtMovements(database, ws, [])).toEqual([]);
  });

  it('a payment recorded from a bank message says so', async () => {
    await postTransaction(database, ws, {
      occurredOn: '2026-11-01',
      description: 'Kredit',
      source: 'email',
      lines: [
        { accountId: kredit.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: bca.id, amountMinor: -1_000_000, currency: 'IDR' },
      ],
    });
    const rows = await debtMovements(database, ws, [kredit.id], { from: '2026-11-01' });
    expect(rows).toEqual([expect.objectContaining({ amountMinor: 1_000_000, fromMessage: true, chargesMinor: 0 })]);
  });
});

describe('loanPlanFacts', () => {
  it('tracks the instalments from the first payment and calls the missed one late', async () => {
    const facts = await loanPlanFacts(database, ws, '2026-11-04');
    expect(facts).toHaveLength(1);
    const [fact] = facts;
    expect(fact).toMatchObject({ accountId: kredit.id, trackFrom: '2026-09-01', scheduleFrom: '2026-11-04' });
    const repaid = (await debtMovements(database, ws, [kredit.id])).filter((m) => m.amountMinor > 0).reduce((s, m) => s + m.amountMinor, 0);
    expect(fact!.owedMinor).toBe(6_000_000 - repaid);
    expect(fact!.instalments[1]!.paidMinor).toBe((await movementOn('2026-10-03')).amountMinor + (await movementOn('2026-10-03')).chargesMinor);
    expect(fact!.instalments.map((i) => [i.number, i.status])).toEqual([
      [1, 'paid'],
      [2, 'paid'],
      [3, 'late'],
    ]);
    expect(fact!.instalments[1]!.daysLate).toBe(2);
    expect(fact!.instalments[2]!.daysLate).toBe(3);
    expect(fact!.schedule[0]!.onDate).toBe('2026-11-01');
  });

  it('a month already paid starts the schedule next month', async () => {
    const due = (await nextPaymentDue(database, ws, kredit.id, '2026-11-04'))!;
    await recordLoanPayment(database, ws, { accountId: kredit.id, occurredOn: '2026-11-04', moneyAccountId: bca.id, principalMinor: due.principalMinor, interestMinor: due.interestMinor });
    const [fact] = await loanPlanFacts(database, ws, '2026-11-05');
    expect(fact!.instalments[2]).toMatchObject({ number: 3, status: 'paid', daysLate: 3 });
    expect(fact!.scheduleFrom).toBe('2026-12-01');
    expect(fact!.schedule[0]!.onDate).toBe('2026-12-01');
  });

  it('a loan with no terms and a paid-off loan are not there', async () => {
    await createAccount(database, ws, { name: 'Family loan', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-08-01' });
    const small = await createAccount(database, ws, { name: 'Bank', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-08-01' });
    await saveLoanTerms(database, ws, { accountId: small.id, lenderName: 'Bank', originalMinor: 1_000_000, firstPaymentOn: '2026-09-01', tenorMonths: 2, method: 'zero', paymentDay: 1, rateBps: 0 });
    await payOffLoan(database, ws, { accountId: small.id, occurredOn: '2026-09-01', moneyAccountId: bca.id });
    expect((await loanPlanFacts(database, ws, '2026-11-04')).map((f) => f.accountId)).toEqual([kredit.id]);
  });
});

/** The movement on the loan that day. */
async function movementOn(day: string) {
  const [row] = await debtMovements(database, ws, [kredit.id], { from: day, to: day });
  return row!;
}

describe('plan settings', () => {
  const settings = { method: 'avalanche' as const, order: ['a', 'b'], extraMinor: 500_000, extraCurrency: 'IDR' };

  it('nothing saved reads as null; a save reads back and a second one replaces it', async () => {
    expect(await getDebtPlanSettings(database, ws)).toBeNull();
    await saveDebtPlanSettings(database, ws, settings);
    expect(await getDebtPlanSettings(database, ws)).toEqual(settings);
    await saveDebtPlanSettings(database, ws, { ...settings, method: 'byHand', order: ['b', 'a'] });
    expect(await getDebtPlanSettings(database, ws)).toEqual({ ...settings, method: 'byHand', order: ['b', 'a'] });
  });

  it('refuses a bad extra, a repeated key or an unknown method', async () => {
    await expect(saveDebtPlanSettings(database, ws, { ...settings, extraMinor: -1 })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveDebtPlanSettings(database, ws, { ...settings, extraMinor: 1.5 })).rejects.toBeInstanceOf(DebtPlanError);
    await expect(saveDebtPlanSettings(database, ws, { ...settings, order: ['a', 'a'] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(saveDebtPlanSettings(database, ws, { ...settings, method: 'random' as never })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('is kept per workspace', async () => {
    await saveDebtPlanSettings(database, ws, settings);
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    expect(await getDebtPlanSettings(database, other)).toBeNull();
  });
});
