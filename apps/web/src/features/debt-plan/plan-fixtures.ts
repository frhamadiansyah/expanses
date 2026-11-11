import { type InstalmentPayment, instalmentDates, instalmentStanding, type LoanTerms, loanSchedule } from '@expanses/core';
import type { LoanPlanFact, LoanTermsRow, PersonDebtRow } from '@expanses/db';
import type { CardFacts, DebtAccount } from '../networth/debt-rows';
import type { PlanReadings } from './plan-inputs';

/**
 * Invented readings for the plan's unit tests (no database): a paylater four instalments in and three days late, a
 * dollar loan with no terms, a card with a statement due, a person owed with a due date, and a loan paid off.
 */

export const TODAY = '2026-11-04';

export const account = (partial: Partial<DebtAccount> & Pick<DebtAccount, 'id' | 'name' | 'subtype'>): DebtAccount => ({ kind: 'liability', currency: 'IDR', archivedAt: null, ...partial });

export const loanRow = (partial: Partial<LoanTermsRow> & Pick<LoanTermsRow, 'accountId'>): LoanTermsRow => ({
  workspaceId: 'ws',
  lenderName: 'Kredit',
  lenderNpwp: null,
  purpose: null,
  originalMinor: 6_000_000,
  firstPaymentOn: '2026-08-01',
  tenorMonths: 6,
  method: 'annuity',
  paymentDay: 1,
  assetAccountId: null,
  coretaxCode: '101',
  status: 'open',
  statusOn: null,
  isHomeLoan: false,
  periods: [{ id: 'p1', accountId: partial.accountId, fromOn: '2026-08-01', rateBps: 3_540, kind: 'fixed', paymentMinor: 0 }],
  ...partial,
});

export const card = (partial: Partial<CardFacts> = {}): CardFacts => ({ last4: null, hasTerms: true, dueOn: null, billedMinor: 0, leftToPayMinor: 0, ...partial });

export const personRow = (partial: Partial<PersonDebtRow> & Pick<PersonDebtRow, 'personName' | 'totalMinor'>, loan: Partial<PersonDebtRow['loans'][number]> = {}): PersonDebtRow => ({
  direction: 'borrowed',
  currency: 'IDR',
  dueState: 'none',
  loans: [
    {
      accountId: `pay-${partial.personName}`,
      reason: null,
      openedOn: '2026-09-02',
      originalMinor: partial.totalMinor,
      balanceMinor: partial.totalMinor,
      repaidMinor: 0,
      dueOn: null,
      dueState: 'none',
      dueLabel: '',
      status: 'open',
      currency: partial.currency ?? 'IDR',
      ...loan,
    },
  ],
  ...partial,
});

const KREDIT_OWED = 3_120_400;

/** The paylater's own reading: instalments 1–3 paid, 4 three days late, the schedule from today. */
export function kreditFact(today = TODAY): LoanPlanFact {
  const terms: LoanTerms = { originalMinor: 6_000_000, firstPaymentOn: '2026-08-01', tenorMonths: 6, method: 'annuity', paymentDay: 1 };
  const payments: InstalmentPayment[] = [
    { id: 't1', occurredOn: '2026-08-01', totalMinor: 1_110_000, fromMessage: false },
    { id: 't2', occurredOn: '2026-09-01', totalMinor: 1_110_000, fromMessage: true },
    { id: 't3', occurredOn: '2026-10-02', totalMinor: 1_110_000, fromMessage: false },
  ];
  return {
    accountId: 'L1',
    owedMinor: KREDIT_OWED,
    trackFrom: '2026-08-01',
    instalments: instalmentStanding(instalmentDates(terms, '2026-08-01', '2026-11-30'), payments, today),
    scheduleFrom: today,
    schedule: loanSchedule(KREDIT_OWED, terms, [{ fromOn: '2026-08-01', rateBps: 3_540, kind: 'fixed', paymentMinor: 0 }], today),
  };
}

export function readings(overrides: Partial<PlanReadings> = {}): PlanReadings {
  return {
    accounts: [
      account({ id: 'L1', name: 'Kredit', subtype: 'loan' }),
      account({ id: 'L2', name: 'Dollar car loan', subtype: 'loan', currency: 'USD' }),
      account({ id: 'C1', name: 'BCA Visa', subtype: 'credit_card' }),
      account({ id: 'L3', name: 'Bank', subtype: 'loan' }),
      account({ id: 'pay-Dewi', name: 'Dewi', subtype: 'payable' }),
      account({ id: 'rec-Andi', name: 'Andi', subtype: 'receivable', kind: 'asset' }),
    ],
    balances: { L1: -KREDIT_OWED, L2: -100_000, C1: -6_214_300, L3: 0, 'pay-Dewi': -850_000, 'rec-Andi': 400_000 },
    loans: [loanRow({ accountId: 'L1' }), loanRow({ accountId: 'L3', lenderName: 'Bank', originalMinor: 2_000_000, status: 'paid_off', statusOn: '2026-09-15' })],
    items: { L1: 'online_loan' },
    loanFacts: [kreditFact()],
    cards: { C1: card({ billedMinor: 6_214_300, leftToPayMinor: 6_214_300, dueOn: '2026-11-18' }) },
    cardPlans: [],
    people: {
      youOwe: [personRow({ personName: 'Dewi', totalMinor: 850_000 }, { accountId: 'pay-Dewi', originalMinor: 1_000_000, balanceMinor: 850_000, repaidMinor: 150_000, dueOn: '2026-12-03' })],
      owedToYou: [personRow({ personName: 'Andi', totalMinor: 400_000, direction: 'lent' }, { accountId: 'rec-Andi' })],
      settled: [],
    },
    movements: [],
    baseCurrency: 'IDR',
    ratesToBase: { USD: 16_250 },
    ...overrides,
  };
}
