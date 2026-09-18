import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  addRatePeriod,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  homeLoanAccountIds,
  listLoans,
  loanFor,
  LoanDbError,
  migrate,
  MIGRATIONS,
  saveLoanTerms,
  setLoanCode,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let kpr: AccountRow;
let carLoan: AccountRow;
let house: AccountRow;
let car: AccountRow;
let bca: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  house = await createAccount(database, ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR' });
  car = await createAccount(database, ws, { name: 'Avanza', kind: 'asset', subtype: 'vehicle', currency: 'IDR' });
  kpr = await createAccount(database, ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
  carLoan = await createAccount(database, ws, { name: 'Avanza credit', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 60_000_000, openedOn: '2026-01-01' });
});

const terms = (accountId: string, overrides: Record<string, unknown> = {}) => ({
  accountId,
  lenderName: 'Bank BTN',
  originalMinor: 700_000_000,
  firstPaymentOn: '2026-01-25',
  tenorMonths: 180,
  method: 'annuity' as const,
  paymentDay: 25,
  rateBps: 900,
  ...overrides,
});

describe('migration 0011', () => {
  it('applies on a database already populated through version 10', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 10));
    const olderWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    // No opening balance: the ORM always describes the newest columns, and a v10 database has none of 0011's.
    const loan = await createAccount(older, olderWs, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR' });

    await migrate(older);

    await saveLoanTerms(older, olderWs, terms(loan.id));
    await expect(loanFor(older, olderWs, loan.id)).resolves.toMatchObject({ lenderName: 'Bank BTN' });
  });
});

describe('loan terms', () => {
  it('keeps the lender, the tenor and how interest is worked out', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id, { purpose: 'House in Bintaro', lenderNpwp: '011234567890000' }));

    await expect(loanFor(database, ws, kpr.id)).resolves.toMatchObject({
      lenderName: 'Bank BTN',
      purpose: 'House in Bintaro',
      lenderNpwp: '011234567890000',
      tenorMonths: 180,
      method: 'annuity',
      paymentDay: 25,
      status: 'open',
      coretaxCode: '101',
    });
  });

  it('writes the rate it starts on as its first period', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id));

    const loan = await loanFor(database, ws, kpr.id);
    expect(loan!.periods).toHaveLength(1);
    expect(loan!.periods[0]).toMatchObject({ fromOn: '2026-01-25', rateBps: 900, kind: 'fixed', paymentMinor: 0 });
  });

  it('keeps the payment the bank asks for, when one is given', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id, { paymentMinor: 7_100_000, rateKind: 'floating' }));

    const loan = await loanFor(database, ws, kpr.id);
    expect(loan!.periods[0]).toMatchObject({ paymentMinor: 7_100_000, kind: 'floating' });
  });

  it('saves again in place, without adding a second loan or losing the periods', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id));
    await saveLoanTerms(database, ws, terms(kpr.id, { lenderName: 'Bank BTN Syariah', tenorMonths: 168 }));

    const loans = await listLoans(database, ws);
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ lenderName: 'Bank BTN Syariah', tenorMonths: 168 });
    expect(loans[0]!.periods).toHaveLength(1);
  });

  /**
   * Changing what a loan files as must change the code and nothing else. Rewriting the whole terms to do it
   * drags the opening period along, and a period that started before the first instalment — a grace period, a
   * rate agreed at signing — would silently move to the first payment date.
   */
  it('changes the code on its own, leaving every rate period where it was', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id));
    await addRatePeriod(database, ws, { accountId: kpr.id, fromOn: '2025-12-01', rateBps: 750, kind: 'fixed' });
    const before = (await loanFor(database, ws, kpr.id))!.periods;

    await setLoanCode(database, ws, kpr.id, '103');

    const after = await loanFor(database, ws, kpr.id);
    expect(after!.coretaxCode).toBe('103');
    expect(after!.periods).toEqual(before);
    expect(after!.periods.map((period) => period.fromOn)).toEqual(['2025-12-01', '2026-01-25']);
    // Nothing else about the loan moves either.
    expect(after).toMatchObject({ lenderName: 'Bank BTN', tenorMonths: 180, firstPaymentOn: '2026-01-25' });
  });

  it('refuses to file a loan under a code, or an account, it has no business with', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id));
    await expect(setLoanCode(database, ws, bca.id, '103')).rejects.toThrow(LoanDbError);
    await expect(setLoanCode(database, ws, carLoan.id, '103')).rejects.toThrow(/terms first/i);
  });

  it('refuses an account that is not a loan', async () => {
    await expect(saveLoanTerms(database, ws, terms(bca.id))).rejects.toThrow(LoanDbError);
    await expect(saveLoanTerms(database, ws, terms(bca.id))).rejects.toThrow(/only a loan account/i);
  });

  it('refuses a tenor of nothing and a payment day outside the month', async () => {
    await expect(saveLoanTerms(database, ws, terms(kpr.id, { tenorMonths: 0 }))).rejects.toThrow(/at least one month/);
    await expect(saveLoanTerms(database, ws, terms(kpr.id, { paymentDay: 29 }))).rejects.toThrow(/between 1 and 28/);
  });

  it('refuses a lender with no name', async () => {
    await expect(saveLoanTerms(database, ws, terms(kpr.id, { lenderName: '  ' }))).rejects.toThrow(/who lent/i);
  });
});

describe('which loans are home loans', () => {
  it('counts a loan against a property', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id, { assetAccountId: house.id }));

    await expect(loanFor(database, ws, kpr.id)).resolves.toMatchObject({ isHomeLoan: true });
    await expect(homeLoanAccountIds(database, ws)).resolves.toEqual([kpr.id]);
  });

  it('does not count a loan against a vehicle', async () => {
    await saveLoanTerms(database, ws, terms(carLoan.id, { assetAccountId: car.id, originalMinor: 60_000_000, tenorMonths: 36 }));

    await expect(loanFor(database, ws, carLoan.id)).resolves.toMatchObject({ isHomeLoan: false });
    await expect(homeLoanAccountIds(database, ws)).resolves.toEqual([]);
  });

  it('does not count a loan with no asset behind it', async () => {
    await saveLoanTerms(database, ws, terms(kpr.id));

    await expect(homeLoanAccountIds(database, ws)).resolves.toEqual([]);
  });

  it('lists nothing for a workspace with no loans', async () => {
    await expect(listLoans(database, ws)).resolves.toEqual([]);
    await expect(homeLoanAccountIds(database, ws)).resolves.toEqual([]);
  });
});
