import { calculatorLoan, calculatorSchedule, type LoanCalcInput } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { createAccount, getLoanCalculatorDraft, LoanDbError, loanFor, saveLoanCalculatorDraft, saveLoanTerms, scheduleFor } from '../src/index';
import { setupDb } from './helpers';

/** Invented figures: 720.000.000 over 20 years, 5,5% fixed for 3 years then 11% floating, first paid next month. */
const home: LoanCalcInput = {
  principalMinor: 720_000_000,
  method: 'annuity',
  stages: [
    { months: 36, rateBps: 550, kind: 'fixed' },
    { months: 204, rateBps: 1100, kind: 'floating' },
  ],
  firstPaymentOn: '2026-12-11',
  paymentDay: 11,
};

describe('a loan saved from the calculator', () => {
  it('shows on its own page exactly the schedule the calculator worked out, to the unit', async () => {
    const { database, ws } = await setupDb();
    // What Add debt does with the calculator's figures: the account at what is owed, the terms on the first stage,
    // and one rate change for each later stage.
    const account = await createAccount(database, ws, { name: 'Home loan', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 720_000_000, openedOn: '2026-11-11' });
    const { terms, periods } = calculatorLoan(home);
    await saveLoanTerms(database, ws, {
      accountId: account.id,
      lenderName: 'Lender',
      ...terms,
      rateBps: periods[0]!.rateBps,
      rateKind: periods[0]!.kind,
      laterPeriods: periods.slice(1).map((period) => ({ fromOn: period.fromOn, rateBps: period.rateBps, kind: period.kind })),
    });

    const saved = await scheduleFor(database, ws, account.id, '2026-11-11');
    expect(saved).toEqual(calculatorSchedule(home));
    expect(saved).toHaveLength(240);
    expect(saved.at(-1)!.balanceMinor).toBe(0);
  });

  it('writes the terms and every later stage together, or none of them', async () => {
    const { database, ws } = await setupDb();
    const account = await createAccount(database, ws, { name: 'Home loan', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 720_000_000, openedOn: '2026-11-11' });
    const { terms } = calculatorLoan(home);
    await expect(
      saveLoanTerms(database, ws, {
        accountId: account.id,
        lenderName: 'Lender',
        ...terms,
        rateBps: 550,
        laterPeriods: [{ fromOn: '2029-12-11', rateBps: 1100, kind: 'odd' as never }],
      }),
    ).rejects.toThrow();
    expect(await loanFor(database, ws, account.id)).toBeUndefined();
  });

  it('takes later stages only with a loan’s first terms, never over periods already recorded', async () => {
    const { database, ws } = await setupDb();
    const account = await createAccount(database, ws, { name: 'Home loan', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 720_000_000, openedOn: '2026-11-11' });
    const { terms } = calculatorLoan(home);
    await saveLoanTerms(database, ws, { accountId: account.id, lenderName: 'Lender', ...terms, rateBps: 550 });
    await expect(
      saveLoanTerms(database, ws, { accountId: account.id, lenderName: 'Lender', ...terms, rateBps: 550, laterPeriods: [{ fromOn: '2029-12-11', rateBps: 1100, kind: 'floating' }] }),
    ).rejects.toThrow(LoanDbError);
    expect((await loanFor(database, ws, account.id))!.periods).toHaveLength(1);
  });

  it('is the same flat loan too', async () => {
    const { database, ws } = await setupDb();
    const flat: LoanCalcInput = { principalMinor: 262_500_000, method: 'flat', stages: [{ months: 48, rateBps: 450, kind: 'fixed' }], firstPaymentOn: '2026-12-11', paymentDay: 11 };
    const account = await createAccount(database, ws, { name: 'Car', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 262_500_000, openedOn: '2026-11-11' });
    const { terms, periods } = calculatorLoan(flat);
    await saveLoanTerms(database, ws, { accountId: account.id, lenderName: 'Lender', ...terms, rateBps: periods[0]!.rateBps, rateKind: periods[0]!.kind });
    expect(await scheduleFor(database, ws, account.id, '2026-11-11')).toEqual(calculatorSchedule(flat));
  });
});

describe('the loan calculator’s boxes', () => {
  it('are kept per workspace and handed back as they were typed', async () => {
    const { database, ws } = await setupDb();
    expect(await getLoanCalculatorDraft(database, ws)).toBeNull();
    await saveLoanCalculatorDraft(database, ws, { kind: 'home', home: { price: '900.000.000' } });
    await saveLoanCalculatorDraft(database, ws, { kind: 'vehicle', home: { price: '800.000.000' } });
    expect(await getLoanCalculatorDraft(database, ws)).toEqual({ kind: 'vehicle', home: { price: '800.000.000' } });
  });
});
