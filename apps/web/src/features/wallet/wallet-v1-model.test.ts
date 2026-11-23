import { describe, expect, it } from 'vitest';
import { byDue, cardPayment, dueTag, dueTone, shows, showOf, statementLine, walletLine } from './wallet-v1-model';

const terms = { statementDay: 13, dueDay: 28 };

describe('the filter', () => {
  it('puts a credit card in Cards, a bank’s account in Banks and the rest of the money in Cash', () => {
    expect(showOf({ side: 'credit', subtype: 'credit_card' })).toBe('cards');
    expect(showOf({ side: 'money', subtype: 'bank' })).toBe('banks');
    expect(showOf({ side: 'money', subtype: 'savings' })).toBe('banks');
    expect(showOf({ side: 'money', subtype: 'cash' })).toBe('cash');
    expect(showOf({ side: 'money', subtype: 'ewallet' })).toBe('cash');
    expect(showOf({ side: 'money', subtype: 'emoney' })).toBe('cash');
    expect(shows('all', { side: 'credit', subtype: 'credit_card' })).toBe(true);
    expect(shows('banks', { side: 'credit', subtype: 'credit_card' })).toBe(false);
  });
});

describe('the title line', () => {
  it('counts the cards and the accounts, and names the money in banks and cash', () => {
    expect(walletLine(3, 4, 'Rp 412,6 jt')).toBe('3 cards · 4 accounts · Rp 412,6 jt in banks and cash');
    expect(walletLine(1, 1, null)).toBe('1 card · 1 account');
  });
});

describe('a card’s payment', () => {
  const today = '2026-11-21';

  it('is the last statement’s left to pay while any is left, due the due day after it closed', () => {
    const payment = cardPayment({ today, owedNowMinor: 5_000_000, terms, last: { cycleEnd: '2026-11-13', closingMinor: 2_640_000, leftToPayMinor: 2_640_000 } });
    expect(payment).toMatchObject({ state: 'due', amountMinor: 2_640_000, statementOn: '2026-11-13', closed: true, dueOn: '2026-11-28', tone: 'orange' });
    expect(statementLine(payment)).toBe('Statement closed 13 Nov');
    expect(dueTag(payment)).toBe('Due 28 Nov');
  });

  it('is what is owed now on the open statement once the last one is paid', () => {
    const payment = cardPayment({ today, owedNowMinor: 4_820_000, terms, last: { cycleEnd: '2026-11-13', closingMinor: 1_000_000, leftToPayMinor: 0 } });
    expect(payment).toMatchObject({ state: 'open', amountMinor: 4_820_000, statementOn: '2026-12-13', closed: false, dueOn: '2026-12-28', tone: 'grey' });
    expect(statementLine(payment)).toBe('Statement closes 13 Dec');
  });

  it('is the last bill, paid, when nothing is owed', () => {
    const payment = cardPayment({ today, owedNowMinor: 0, terms, last: { cycleEnd: '2026-11-13', closingMinor: 1_000_000, leftToPayMinor: 0 } });
    expect(payment).toMatchObject({ state: 'paid', amountMinor: 1_000_000, dueOn: null, tone: 'green' });
    expect(dueTag(payment)).toBe('Paid');
    expect(statementLine(payment)).toBe('Statement closed 13 Nov · paid');
  });

  it('owes nothing on a card with nothing billed or spent', () => {
    expect(cardPayment({ today, owedNowMinor: 0, terms, last: { cycleEnd: '2026-11-13', closingMinor: 0, leftToPayMinor: 0 } })).toMatchObject({ state: 'clear', amountMinor: 0, dueOn: null });
  });

  it('says only what is owed on a card with no statement or due day', () => {
    const payment = cardPayment({ today, owedNowMinor: 300_000, terms: { statementDay: null, dueDay: null }, last: null });
    expect(payment).toMatchObject({ state: 'no-day', amountMinor: 300_000, dueOn: null });
    expect(statementLine(payment)).toBe('No statement day set');
    expect(dueTag(payment)).toBeNull();
  });

  it('never asks for a card in credit', () => {
    expect(cardPayment({ today, owedNowMinor: -50_000, terms: null, last: null }).amountMinor).toBe(0);
  });

  it('is red once passed, orange within a week, grey later', () => {
    expect(dueTone(today, '2026-11-20')).toBe('red');
    expect(dueTone(today, '2026-11-21')).toBe('orange');
    expect(dueTone(today, '2026-11-28')).toBe('orange');
    expect(dueTone(today, '2026-11-29')).toBe('grey');
  });

  it('lists the soonest due first, those with no date last', () => {
    const row = (name: string, dueOn: string | null) => ({ name, payment: { state: 'open' as const, amountMinor: 1, statementOn: null, closed: false, dueOn, tone: 'grey' as const } });
    expect(byDue([row('C', null), row('B', '2026-12-15'), row('A', '2026-11-28')]).map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
});
