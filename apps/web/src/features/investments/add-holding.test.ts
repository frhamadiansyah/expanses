import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { asHeld, brokerChoices, brokerlessNames, brokerlessNote, emptyHoldingDraft, landsOnNote, NEW_BROKER, NO_BROKER_CHOICE, namedSecurity, OPENING, planAddHolding, totalOf, unitsOf } from './add-holding';

const bbca = { ticker: 'BBCA', name: 'BBCA name', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' as const };
const aapl = { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share' as const };

describe('unitsOf', () => {
  it('reads lots on a lot-sized security and shares otherwise', () => {
    expect(unitsOf('15', 100)).toBe(1_500_000_000);
    expect(unitsOf('2,5', null)).toBe(2_500_000);
  });
  it('refuses part of a lot, and nothing', () => {
    expect(() => unitsOf('1,5', 100)).toThrow(/whole lots/);
    expect(() => unitsOf('0', null)).toThrow();
    expect(() => unitsOf('', null)).toThrow();
  });
});

describe('totalOf', () => {
  it('is shares × price, exact, through parsePriceMicro', () => {
    expect(totalOf({ quantity: '10', price: '182,50' }, null, 'USD')).toBe(182_500);
    expect(totalOf({ quantity: '7', price: '9.775' }, null, 'IDR')).toBe(68_425); // "9.775" is nine thousand rupiah
    // 1.562,5: half away from zero gives 1.563, half to even 1.562 — 3 × 312,5 = 937,5 could not tell them apart.
    expect(totalOf({ quantity: '5', price: '312,5' }, null, 'IDR')).toBe(1_563);
    expect(totalOf({ quantity: '15', price: '8.750' }, 100, 'IDR')).toBe(13_125_000);
    expect(totalOf({ quantity: 'x', price: '1' }, null, 'IDR')).toBeNull();
  });
});

describe('namedSecurity', () => {
  it('is what the owner typed, tidied, and a share only when it has a ticker', () => {
    expect(namedSecurity({ ticker: ' aapl ', name: 'Apple', market: 'nasdaq', currency: 'USD', lotSize: '' })).toEqual({ ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share', source: 'owner' });
    expect(namedSecurity({ ticker: '', name: 'Private fund', market: '', currency: 'IDR', lotSize: '' })).toMatchObject({ ticker: null, kind: 'other' });
    expect(() => namedSecurity({ ticker: 'X', name: ' ', market: '', currency: 'IDR', lotSize: '' })).toThrow(/name/);
  });
  it('reads a lot size with parseUnits, so "1.000" is a thousand shares, and refuses part of a share', () => {
    expect(namedSecurity({ ticker: 'X', name: 'X', market: '', currency: 'IDR', lotSize: '1.000' }).lotSize).toBe(1_000);
    expect(namedSecurity({ ticker: 'X', name: 'X', market: '', currency: 'IDR', lotSize: '1' }).lotSize).toBeNull(); // a lot of one is no lots
    expect(() => namedSecurity({ ticker: 'X', name: 'X', market: '', currency: 'IDR', lotSize: '2,5' })).toThrow(/whole/);
  });
});

describe('brokerChoices', () => {
  const acc = (id: string, subtype: string, parentId: string | null = null, archivedAt: string | null = null) =>
    ({ id, name: id, kind: 'asset', subtype, parentId, archivedAt, currency: 'IDR' }) as AccountRow;
  it('offers fund accounts that are not pockets — a parent holding pockets is a broker — and nothing else', () => {
    const accounts = [acc('stockbit', 'fund'), acc('ibkr', 'fund'), acc('ibkr-usd', 'fund', 'ibkr'), acc('bca', 'bank'), acc('old', 'fund', null, '2026-01-01')];
    expect(brokerChoices(accounts).map((a) => a.id)).toEqual(['stockbit', 'ibkr']);
  });
});

describe('planAddHolding', () => {
  it('builds the security, the new broker and an opening buy', () => {
    const draft = { ...emptyHoldingDraft('2026-09-21', 'IDR'), brokerChoice: NEW_BROKER, brokerName: 'Stockbit', quantity: '10', price: '8.750', fee: '13.125', paidFrom: OPENING };
    expect(planAddHolding({ kind: 'listed', security: bbca }, draft, '2026-09-21', 'IDR')).toEqual({
      security: { ...bbca, source: 'catalogue' },
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: { occurredOn: '2026-09-21', unitsMicro: 1_000_000_000, grossMinor: 8_750_000, feeMinor: 13_125, taxMinor: 0, cashAccountId: null, goalId: null },
    });
  });
  it('carries what left a rupiah account for a dollar buy, and the goal it is for', () => {
    const draft = { ...emptyHoldingDraft('2026-09-21', 'USD'), quantity: '10', price: '123,457', paidFrom: 'bca', charged: '20.000.001', goalId: 'pension' };
    const plan = planAddHolding({ kind: 'listed', security: aapl }, draft, '2026-09-21', 'IDR');
    expect(plan.buy).toMatchObject({ grossMinor: 123_457, cashAccountId: 'bca', cashMinor: 20_000_001, goalId: 'pension' });
    expect(() => planAddHolding({ kind: 'listed', security: aapl }, { ...draft, charged: '' }, '2026-09-21', 'IDR')).toThrow(/Charged in IDR/);
  });
  it('asks no charged amount for a foreign stock owned before this app, whatever the cash currency reads (m5)', () => {
    // "Owned before this app" moves no money, so nothing was charged in rupiah: the buy is its own currency throughout.
    const draft = { ...emptyHoldingDraft('2026-09-21', 'USD'), quantity: '10', price: '123,457', paidFrom: OPENING, charged: '' };
    const plan = planAddHolding({ kind: 'listed', security: aapl }, draft, '2026-09-21', 'IDR');
    expect(plan.buy).toMatchObject({ grossMinor: 123_457, cashAccountId: null });
    expect(plan.buy.cashMinor).toBeUndefined();
  });
  it('refuses a date after today and a nameless new broker', () => {
    const draft = { ...emptyHoldingDraft('2026-09-21', 'IDR'), quantity: '1', price: '1', paidFrom: OPENING };
    expect(() => planAddHolding({ kind: 'listed', security: bbca }, { ...draft, occurredOn: '2026-09-22' }, '2026-09-21', 'IDR')).toThrow(/after today/);
    expect(() => planAddHolding({ kind: 'listed', security: bbca }, { ...draft, brokerChoice: NEW_BROKER, brokerName: ' ' }, '2026-09-21', 'IDR')).toThrow(/broker/);
  });
});

describe('brokerlessNote', () => {
  it('names the one holding a buy with no broker adds to', () => {
    expect(brokerlessNote(['BBCA old'], 'BBCA')).toBe('This adds to BBCA old, your BBCA with no broker named.');
  });
  it('names the one it adds to when there are several, and how to reach the others — never a silent pick', () => {
    expect(brokerlessNote(['BBCA old', 'BBCA 2019'], 'BBCA')).toBe(
      'You hold BBCA twice with no broker named. This adds to BBCA old, the first recorded; to add to BBCA 2019 instead, record the buy on Buy & sell.',
    );
    expect(brokerlessNote(['A', 'B', 'C'], 'BBCA')).toBe(
      'You hold BBCA 3 times with no broker named. This adds to A, the first recorded; to add to B or C instead, record the buy on Buy & sell.',
    );
  });
  it('says nothing when there is none: a new holding opens', () => {
    expect(brokerlessNote([], 'BBCA')).toBeNull();
  });
});

describe('asHeld (m7)', () => {
  const held = [{ id: 'sec-bbca', ...bbca, source: 'catalogue' as const }];
  it('treats a stock named by hand that is already held as that security', () => {
    const named = { kind: 'named' as const, security: { ...bbca, ticker: ' bbca ', market: 'idx', name: 'Typed name', lotSize: null, source: 'owner' as const } };
    expect(asHeld(named, held)).toEqual({ kind: 'held', security: held[0] });
  });
  it('treats a listed stock already held as that security', () => {
    expect(asHeld({ kind: 'listed', security: bbca }, held)).toEqual({ kind: 'held', security: held[0] });
  });
  it('leaves the same ticker on another market, and anything with no ticker, as new', () => {
    const otc = { kind: 'named' as const, security: { ...bbca, market: 'OTC', source: 'owner' as const } };
    expect(asHeld(otc, held)).toBe(otc);
    const unnamed = { kind: 'named' as const, security: { ...bbca, ticker: null, name: 'BBCA', source: 'owner' as const } };
    expect(asHeld(unnamed, [{ ...held[0]!, ticker: null, name: 'BBCA' }])).toBe(unnamed);
  });
});

describe('brokerlessNames (m8)', () => {
  const accounts = [
    { id: 'a', name: 'BBCA', createdAt: '2019-03-04T01:00:00.000Z' },
    { id: 'b', name: 'BBCA', createdAt: '2021-07-15T01:00:00.000Z' },
    { id: 'c', name: 'BBCA old', createdAt: '2018-01-01T01:00:00.000Z' },
  ];
  it('keeps distinct names as they are', () => {
    expect(brokerlessNames(['c', 'a'], accounts, { a: 300_000_000, c: 100_000_000 })).toEqual(['BBCA old', 'BBCA']);
  });
  it('tells two holdings with one name apart by the shares each holds', () => {
    expect(brokerlessNames(['a', 'b'], accounts, { a: 300_000_000, b: 1_500_000_000 })).toEqual(['BBCA (300 shares)', 'BBCA (1.500 shares)']);
  });
  it('adds the day each was recorded when the shares match too', () => {
    expect(brokerlessNames(['a', 'b'], accounts, { a: 300_000_000, b: 300_000_000 })).toEqual([
      'BBCA (300 shares, recorded 4 Mar 2019)',
      'BBCA (300 shares, recorded 15 Jul 2021)',
    ]);
  });
  it('makes a note whose two names differ', () => {
    const note = brokerlessNote(brokerlessNames(['a', 'b'], accounts, { a: 300_000_000, b: 1_500_000_000 }), 'BBCA')!;
    expect(note).toBe('You hold BBCA twice with no broker named. This adds to BBCA (300 shares), the first recorded; to add to BBCA (1.500 shares) instead, record the buy on Buy & sell.');
  });
});

describe('landsOnNote (m6, m8)', () => {
  const accounts = [
    { id: 'a', name: 'BBCA', createdAt: '2019-03-04T01:00:00.000Z' },
    { id: 'b', name: 'BBCA', createdAt: '2021-07-15T01:00:00.000Z' },
  ];
  const positions = { a: { unitsMicro: 300_000_000 }, b: { unitsMicro: 1_500_000_000 } };
  it('names the holdings, told apart by the shares each holds, for a buy with no broker', () => {
    expect(landsOnNote(NO_BROKER_CHOICE, ['a', 'b'], accounts, positions, 'BBCA')).toBe(
      'You hold BBCA twice with no broker named. This adds to BBCA (300 shares), the first recorded; to add to BBCA (1.500 shares) instead, record the buy on Buy & sell.',
    );
  });
  it('says nothing for a buy kept at a broker, or a new one', () => {
    expect(landsOnNote('stockbit-id', ['a', 'b'], accounts, positions, 'BBCA')).toBeNull();
    expect(landsOnNote(NEW_BROKER, ['a'], accounts, positions, 'BBCA')).toBeNull();
  });
});
