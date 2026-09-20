import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  addRatePeriod,
  categoryIdsByKey,
  createAccount,
  type Database,
  loanFor,
  nativeBalances,
  nextPaymentDue,
  periodFlows,
  recordExtraPayment,
  recordLoanPayment,
  saveLoanTerms,
  scheduledPayments,
  scheduleFor,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let kpr: AccountRow;
let bca: AccountRow;
let categories: Record<string, string>;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 100_000_000, openedOn: '2026-01-01' });
  kpr = await createAccount(database, ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
  await saveLoanTerms(database, ws, {
    accountId: kpr.id,
    lenderName: 'Bank BTN',
    originalMinor: 700_000_000,
    firstPaymentOn: '2026-01-25',
    tenorMonths: 180,
    method: 'annuity',
    paymentDay: 25,
    rateBps: 900,
  });
  categories = await categoryIdsByKey(database, ws);
});

/** What is still owed, as a positive amount: a loan is a liability, so the ledger holds it as a credit. */
const owed = async () => -((await nativeBalances(database, ws, '2041-12-31'))[kpr.id] ?? 0);
const balanceOf = async (accountId: string) => (await nativeBalances(database, ws, '2041-12-31'))[accountId] ?? 0;

const pay = (principalMinor: number, interestMinor: number, occurredOn = '2026-01-25') =>
  recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn, moneyAccountId: bca.id, principalMinor, interestMinor });

describe('recording a payment', () => {
  it('lowers the loan by the principal and charges the interest to Interest', async () => {
    const result = await pay(1_849_866, 5_250_000);

    expect(result.balanceMinor).toBe(698_150_134);
    expect(await owed()).toBe(698_150_134);
    expect(await balanceOf(categories['miscellaneous.interest']!)).toBe(5_250_000);
    expect(await balanceOf(bca.id)).toBe(100_000_000 - 7_099_866);
  });

  it('sends extras on the same payment to their own categories', async () => {
    await recordLoanPayment(database, ws, {
      accountId: kpr.id,
      occurredOn: '2026-01-25',
      moneyAccountId: bca.id,
      principalMinor: 1_849_866,
      interestMinor: 5_250_000,
      extras: [{ categoryId: categories['protection.health_insurance']!, amountMinor: 150_000 }],
    });

    expect(await balanceOf(categories['protection.health_insurance']!)).toBe(150_000);
    expect(await balanceOf(bca.id)).toBe(100_000_000 - 7_249_866);
  });

  it('marks the loan paid off when the last payment clears it', async () => {
    const result = await recordLoanPayment(database, ws, {
      accountId: kpr.id,
      occurredOn: '2026-02-25',
      moneyAccountId: bca.id,
      principalMinor: 700_000_000,
      interestMinor: 0,
    });

    expect(result.status).toBe('paid_off');
    await expect(loanFor(database, ws, kpr.id)).resolves.toMatchObject({ status: 'paid_off', statusOn: '2026-02-25' });
  });

  it('refuses a payment of more principal than is left, and writes nothing', async () => {
    await expect(
      recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-01-25', moneyAccountId: bca.id, principalMinor: 800_000_000, interestMinor: 0 }),
    ).rejects.toThrow(/KPR Bintaro/);

    expect(await owed()).toBe(700_000_000);
    expect(await balanceOf(bca.id)).toBe(100_000_000);
  });

  it('counts as a debt payment once, principal and interest together', async () => {
    await pay(1_849_866, 5_250_000);

    const flows = await periodFlows(database, ws, { from: '2026-01-01', to: '2026-12-31' });
    expect(flows.debtPaymentsMinor).toBe(7_099_866);
    // Principal builds equity, so it is money put away; the interest is spending.
    expect(flows.putAwayMinor).toBe(1_849_866);
  });
});

describe('the schedule beside the ledger', () => {
  it('starts from what is left after a payment', async () => {
    await pay(1_849_866, 5_250_000);

    const rows = await scheduleFor(database, ws, kpr.id, '2026-02-01');
    expect(rows[0]!.onDate).toBe('2026-02-25');
    expect(rows[0]!.principalMinor + rows[0]!.balanceMinor).toBe(698_150_134);
  });

  it('names the next payment, with its split, for the form to fill itself in', async () => {
    const next = await nextPaymentDue(database, ws, kpr.id, '2026-01-01');

    expect(next).toMatchObject({ onDate: '2026-01-25' });
    expect(next!.principalMinor + next!.interestMinor).toBe(next!.paymentMinor);
    expect(next!.interestMinor).toBe(5_250_000);
  });

  it('has nothing due once the loan is paid off', async () => {
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-02-25', moneyAccountId: bca.id, principalMinor: 700_000_000, interestMinor: 0 });

    await expect(nextPaymentDue(database, ws, kpr.id, '2026-03-01')).resolves.toBeUndefined();
  });
});

/**
 * The figure the Loans list prints beside each loan.
 *
 * `periods[].paymentMinor` is *the payment the bank named, when it named one* — the form invites you to leave
 * it blank and 0 is stored, which is correct and asserted in `loans.test.ts`. The list read that stored field
 * and so printed `Rp 0` for the very loan whose detail screen showed ~Rp 7.101.000. This is the reading the
 * list uses now, and it is tested where the fault was: the layer between the repository and the screen.
 */
describe('the instalment each loan is due', () => {
  /** The same terms back with the bank's own figure filled in — it rewrites the opening period in place. */
  const namedPayment = (paymentMinor: number) =>
    saveLoanTerms(database, ws, {
      accountId: kpr.id,
      lenderName: 'Bank BTN',
      originalMinor: 700_000_000,
      firstPaymentOn: '2026-01-25',
      tenorMonths: 180,
      method: 'annuity',
      paymentDay: 25,
      rateBps: 900,
      paymentMinor,
    });

  it('works it out from the balance when the bank named no figure', async () => {
    const loan = await loanFor(database, ws, kpr.id);
    expect(loan!.periods[0]!.paymentMinor).toBe(0);

    const payments = await scheduledPayments(database, ws, '2026-01-01');

    expect(payments[kpr.id]).toBe((await nextPaymentDue(database, ws, kpr.id, '2026-01-01'))!.paymentMinor);
    expect(payments[kpr.id]).toBeGreaterThan(7_000_000);
    expect(payments[kpr.id]).toBeLessThan(7_200_000);
  });

  it('keeps the bank\'s own figure when the bank named one', async () => {
    const avanza = await createAccount(database, ws, { name: 'Avanza credit', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 60_000_000, openedOn: '2026-01-01' });
    await saveLoanTerms(database, ws, {
      accountId: avanza.id,
      lenderName: 'BCA Finance',
      originalMinor: 60_000_000,
      firstPaymentOn: '2026-01-10',
      tenorMonths: 36,
      method: 'annuity',
      paymentDay: 10,
      rateBps: 1200,
      paymentMinor: 1_993_000,
    });

    await expect(scheduledPayments(database, ws, '2026-01-01')).resolves.toMatchObject({ [avanza.id]: 1_993_000 });
  });

  it('falls back to the figure the bank named once nothing is owed', async () => {
    await namedPayment(7_101_000);
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-02-25', moneyAccountId: bca.id, principalMinor: 700_000_000, interestMinor: 0 });

    await expect(scheduledPayments(database, ws, '2026-03-01')).resolves.toMatchObject({ [kpr.id]: 7_101_000 });
  });

  /** A rate change dated three years out is not this year's rate, and must not become this year's instalment. */
  it('reads the period running on the date, not the latest one recorded', async () => {
    await namedPayment(7_101_000);
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-02-25', moneyAccountId: bca.id, principalMinor: 700_000_000, interestMinor: 0 });
    await addRatePeriod(database, ws, { accountId: kpr.id, fromOn: '2029-01-25', rateBps: 1100, kind: 'fixed', paymentMinor: 8_400_000 });

    await expect(scheduledPayments(database, ws, '2026-03-01')).resolves.toMatchObject({ [kpr.id]: 7_101_000 });
    await expect(scheduledPayments(database, ws, '2029-03-01')).resolves.toMatchObject({ [kpr.id]: 8_400_000 });
  });
});

describe('a rate change', () => {
  it('writes a period and posts no transaction', async () => {
    const before = await balanceOf(bca.id);

    await addRatePeriod(database, ws, { accountId: kpr.id, fromOn: '2029-01-25', rateBps: 1100, kind: 'floating' });

    const loan = await loanFor(database, ws, kpr.id);
    expect(loan!.periods).toHaveLength(2);
    expect(loan!.periods[1]).toMatchObject({ fromOn: '2029-01-25', rateBps: 1100, kind: 'floating' });
    expect(await balanceOf(bca.id)).toBe(before);
  });

  it('leaves the months before it alone, and raises the payment after', async () => {
    const before = await scheduleFor(database, ws, kpr.id, '2026-01-01');
    await addRatePeriod(database, ws, { accountId: kpr.id, fromOn: '2029-01-25', rateBps: 1100, kind: 'fixed' });
    const after = await scheduleFor(database, ws, kpr.id, '2026-01-01');

    expect(after[0]).toEqual(before[0]);
    const changed = after.find((row) => row.onDate === '2029-01-25')!;
    const unchanged = before.find((row) => row.onDate === '2029-01-25')!;
    expect(changed.paymentMinor).toBeGreaterThan(unchanged.paymentMinor);
  });

  it('refuses a rate period on a loan with no terms', async () => {
    const other = await createAccount(database, ws, { name: 'Avanza credit', kind: 'liability', subtype: 'loan', currency: 'IDR' });

    await expect(addRatePeriod(database, ws, { accountId: other.id, fromOn: '2026-06-25', rateBps: 800, kind: 'fixed' })).rejects.toThrow(/terms/i);
  });
});

describe('paying extra off the principal', () => {
  it('lowers the balance by the whole amount', async () => {
    const result = await recordExtraPayment(database, ws, {
      accountId: kpr.id,
      occurredOn: '2026-06-25',
      moneyAccountId: bca.id,
      amountMinor: 50_000_000,
      keep: 'payment',
    });

    expect(result.balanceMinor).toBe(650_000_000);
    expect(await balanceOf(bca.id)).toBe(50_000_000);
    expect(result.newPaymentMinor).toBeNull();
  });

  it('charges a penalty as a fee, never as principal', async () => {
    await recordExtraPayment(database, ws, {
      accountId: kpr.id,
      occurredOn: '2026-06-25',
      moneyAccountId: bca.id,
      amountMinor: 50_000_000,
      penaltyMinor: 500_000,
      keep: 'payment',
    });

    expect(await owed()).toBe(650_000_000);
    expect(await balanceOf(categories['miscellaneous.fees_charges']!)).toBe(500_000);
    expect(await balanceOf(bca.id)).toBe(49_500_000);
  });

  it('writes a period carrying the lower payment when the tenor is kept', async () => {
    const result = await recordExtraPayment(database, ws, {
      accountId: kpr.id,
      occurredOn: '2026-06-25',
      moneyAccountId: bca.id,
      amountMinor: 50_000_000,
      keep: 'tenor',
    });

    expect(result.newPaymentMinor).not.toBeNull();
    const loan = await loanFor(database, ws, kpr.id);
    expect(loan!.periods).toHaveLength(2);
    expect(loan!.periods[1]!.paymentMinor).toBe(result.newPaymentMinor);
  });

  it('adds no period when the payment is kept instead', async () => {
    await recordExtraPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-06-25', moneyAccountId: bca.id, amountMinor: 50_000_000, keep: 'payment' });

    const loan = await loanFor(database, ws, kpr.id);
    expect(loan!.periods).toHaveLength(1);
  });

  it('refuses more than is owed', async () => {
    await expect(
      recordExtraPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-06-25', moneyAccountId: bca.id, amountMinor: 800_000_000, keep: 'payment' }),
    ).rejects.toThrow(/KPR Bintaro/);
  });
});
