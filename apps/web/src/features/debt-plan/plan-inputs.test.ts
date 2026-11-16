import { convertMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { account, card, personRow, readings, TODAY } from './plan-fixtures';
import { planDebts } from './plan-inputs';
import { cardPay, loanPay, personPay } from './pay-target';

const find = (key: string, r = readings()) => planDebts(r, TODAY).find((d) => d.key === key);

describe('planDebts', () => {
  it('a late paylater is late, and its next payment is the late instalment', () => {
    expect(find('L1')).toMatchObject({ kind: 'loan', late: true, daysLate: 3, ratePer: 'month', rateBps: 3_540, instalmentOf: 6, next: { title: 'Kredit · 4/6', status: 'late', daysLate: 3, pay: loanPay('L1') } });
    expect(find('L1')!.payoff).toMatchObject({ key: 'L1', late: true, daysLate: 3, interest: { kind: 'balance' } });
  });

  it('a loan with no terms has no rate, no next payment, and an unknown rate in the engine', () => {
    const debt = find('L2')!;
    expect(debt).toMatchObject({ rateBps: null, hasTerms: false, next: null });
    expect(debt.payoff!.ratesBps).toBeNull();
  });

  it('a card’s statement is due whole and charges nothing', () => {
    const debt = find('C1')!;
    expect(debt).toMatchObject({ kind: 'card', repaidMinor: 0, borrowedMinor: 6_214_300, rateBps: 0, next: { detail: 'Statement · 18 Nov', minor: 6_214_300, pay: cardPay('C1') } });
    expect(debt.payoff!.minimumsMinor[0]).toBe(6_214_300);
    expect(debt.payoff!.ratesBps).toEqual([0]);
  });

  it('a card paid part of its statement counts that as repaid', () => {
    const debt = find('C1', readings({ balances: { ...readings().balances, C1: -4_214_300 }, cards: { C1: card({ billedMinor: 6_214_300, leftToPayMinor: 4_214_300, dueOn: '2026-11-18' }) } }))!;
    expect(debt).toMatchObject({ leftMinor: 4_214_300, repaidMinor: 2_000_000, borrowedMinor: 6_214_300 });
  });

  it('a card owing nothing is left out', () => {
    const r = readings({ accounts: [...readings().accounts, account({ id: 'C2', name: 'Mandiri', subtype: 'credit_card' })], cards: { ...readings().cards, C2: card() } });
    expect(planDebts(r, TODAY).some((d) => d.key === 'C2')).toBe(false);
  });

  it('a card’s instalment plans are billed month by month', () => {
    const plan = { id: 'i1', cardAccountId: 'C1', transactionId: null, description: 'Phone', createdAt: '2026-10-01', totalMinor: 1_200_000, months: 6, monthlyMinor: 200_000, firstBilledMonth: '2026-10', rateBps: 0, conversionFeeMinor: 0, earnsPoints: true, countMode: 'at_purchase' as const, categoryAccountId: null };
    const debt = find('C1', readings({ cardPlans: [plan] }))!;
    // Oct and Nov billed; Dec–Mar still to bill.
    expect(debt.payoff!.minimumsMinor).toEqual([6_214_300 - 800_000, 200_000, 200_000, 200_000, 200_000]);
    expect(debt.payoff!.regularMinor).toBe(200_000);
  });

  it('a person owed is due whole in the month of the due date', () => {
    expect(find('person:Dewi:IDR')).toMatchObject({ kind: 'person', borrowedMinor: 1_000_000, repaidMinor: 150_000, leftMinor: 850_000, next: { detail: 'Lend & borrow · 3 Dec', pay: personPay('pay-Dewi') } });
    expect(find('person:Dewi:IDR')!.payoff!.minimumsMinor).toEqual([0, 850_000]);
  });

  it('a person with no due date has no minimum', () => {
    const r = readings({ people: { ...readings().people, youOwe: [personRow({ personName: 'Dewi', totalMinor: 850_000 }, { accountId: 'pay-Dewi' })] } });
    expect(find('person:Dewi:IDR', r)).toMatchObject({ next: null });
    expect(find('person:Dewi:IDR', r)!.payoff!.minimumsMinor).toEqual([]);
  });

  it('a foreign loan converts at the held rate, or stays out of the engine with no rate', () => {
    expect(find('L2')!.leftBase).toBe(convertMinor(100_000, 'USD', 'IDR', 16_250));
    expect(find('L2', readings({ ratesToBase: {} }))).toMatchObject({ leftBase: null, missing: 'USD', payoff: null });
  });

  it('a paid-off loan is in with all of it repaid', () => {
    expect(find('L3')).toMatchObject({ paidOff: true, leftMinor: 0, borrowedMinor: 2_000_000, repaidMinor: 2_000_000, paidOffMonth: '2026-09', payoff: null });
  });

  it('a settled person debt is paid off', () => {
    const settled = personRow({ personName: 'Rina', totalMinor: 0 }, { accountId: 'pay-Rina', originalMinor: 300_000, balanceMinor: 0, status: 'settled' as never });
    const r = readings({ people: { ...readings().people, settled: [settled] }, movements: [{ transactionId: 'x', accountId: 'pay-Rina', occurredOn: '2026-10-09', amountMinor: 300_000, chargesMinor: 0, interestMinor: 0, fromMessage: false }] });
    expect(find('person:Rina:IDR', r)).toMatchObject({ paidOff: true, borrowedMinor: 300_000, paidOffMonth: '2026-10' });
  });

  it('money lent to others is never a debt', () => {
    expect(planDebts(readings(), TODAY).some((d) => d.name === 'Andi')).toBe(false);
  });

  it('active first, then paid off; borrowed is always left plus repaid', () => {
    const debts = planDebts(readings(), TODAY);
    expect(debts.map((d) => d.key)).toEqual(['L1', 'L2', 'C1', 'person:Dewi:IDR', 'L3']);
    for (const d of debts) expect(d.borrowedMinor).toBe(d.leftMinor + d.repaidMinor);
  });
});
