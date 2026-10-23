import { describe, expect, it } from 'vitest';
import {
  assetValueAt,
  byMoneyInputs,
  goalMoneyOf,
  moneyBuyCost,
  moneyPositionAfter,
  positionInBase,
  switchAnchors,
  switchPlan,
  TradeError,
  type TradeRecord,
  type ValuationRow,
} from '../src/index';

const trade = (id: string, accountId: string, kind: TradeRecord['kind'], occurredOn: string, grossMinor: number, extra: Partial<TradeRecord> = {}): TradeRecord => ({
  id,
  accountId,
  kind,
  occurredOn,
  createdAt: `${occurredOn}T10:00:00Z`,
  unitsMicro: 0,
  grossMinor,
  feeMinor: 0,
  taxMinor: 0,
  ...extra,
});

const valueOf = (trades: TradeRecord[], valuations: ValuationRow[], date: string) =>
  assetValueAt({ accountId: 'x', mode: 'amount', currency: 'IDR', ledgerBalanceMinor: 0, ...byMoneyInputs(trades, [], valuations, date) }, date);

/** Invented figures: 8.000.000 into a money market fund, worth 10.000.000 when 5.000.000 of it is switched out. */
const sourceBuys = [trade('b1', 'mm', 'buy', '2026-02-01', 8_000_000)];
const sourceValue: ValuationRow[] = [{ asOf: '2026-09-30', valueMinor: 10_000_000, basis: 'estimate', createdAt: '2026-09-30T08:00:00Z' }];

describe('a switch between two funds tracked by money', () => {
  it('takes the same share of the money in as of the value, and carries all of it across', () => {
    expect(switchPlan({ costMinor: 8_000_000, valueBeforeMinor: 10_000_000, amountMinor: 5_000_000, feeMinor: 0 })).toEqual({ basisMinor: 4_000_000, intoMinor: 5_000_000 });
    expect(switchPlan({ costMinor: 8_000_000, valueBeforeMinor: 10_000_000, amountMinor: 5_000_000, feeMinor: 25_000 })).toEqual({ basisMinor: 4_000_000, intoMinor: 4_975_000 });
  });

  it('takes all the money in when it switches all of the value', () => {
    expect(switchPlan({ costMinor: 8_000_000, valueBeforeMinor: 10_000_000, amountMinor: 10_000_000, feeMinor: 0 }).basisMinor).toBe(8_000_000);
  });

  it('refuses more than the fund is worth, nothing at all, and a fee that takes everything', () => {
    expect(() => switchPlan({ costMinor: 8_000_000, valueBeforeMinor: 10_000_000, amountMinor: 10_000_001, feeMinor: 0 })).toThrow(TradeError);
    expect(() => switchPlan({ costMinor: 8_000_000, valueBeforeMinor: 10_000_000, amountMinor: 0, feeMinor: 0 })).toThrow(TradeError);
    expect(() => switchPlan({ costMinor: 8_000_000, valueBeforeMinor: 10_000_000, amountMinor: 50_000, feeMinor: 50_000 })).toThrow(TradeError);
    expect(() => switchPlan({ costMinor: 8_000_000, valueBeforeMinor: 10_000_000, amountMinor: 50_000, feeMinor: -1 })).toThrow(TradeError);
  });

  it('leaves the source with the rest of its money and no profit booked', () => {
    const out = trade('s', 'mm', 'sell', '2026-10-23', 5_000_000, { basisMinor: 4_000_000, switchId: 'sw' });
    const after = [...sourceBuys, out];
    expect(moneyPositionAfter(after)).toMatchObject({ costMinor: 4_000_000, realizedMinor: 0 });
    expect(valueOf(after, sourceValue, '2026-10-23')).toMatchObject({ valueMinor: 5_000_000, costMinor: 4_000_000 });
  });

  it('gives the target the cost that left, and its value the money that arrived', () => {
    const into = trade('i', 'bond', 'buy', '2026-10-23', 4_975_000, { feeMinor: 25_000, basisMinor: 4_000_000, switchId: 'sw' });
    expect(moneyBuyCost(into)).toBe(4_000_000);
    expect(moneyPositionAfter([into])).toMatchObject({ costMinor: 4_000_000, realizedMinor: 0, byYear: { '2026': { costMinor: 4_000_000 } } });
    // No value typed on the target: the switch stands as one, so it is worth what arrived, not the cost carried.
    expect(valueOf([into], [], '2026-10-23')).toMatchObject({ valueMinor: 4_975_000, costMinor: 4_000_000 });
    expect(valueOf([into], [], '2026-10-22')).toMatchObject({ valueMinor: 0 });
  });

  it('adds what arrives to a target that already had money in and no value typed', () => {
    const before = trade('t1', 'bond', 'buy', '2026-03-01', 3_000_000);
    const into = trade('i', 'bond', 'buy', '2026-10-23', 5_000_000, { basisMinor: 4_000_000, switchId: 'sw' });
    const later = trade('t2', 'bond', 'buy', '2026-10-25', 1_000_000);
    expect(valueOf([before, into], [], '2026-10-23')).toMatchObject({ valueMinor: 8_000_000, costMinor: 7_000_000 });
    expect(valueOf([before, into, later], [], '2026-10-25')).toMatchObject({ valueMinor: 9_000_000, costMinor: 8_000_000 });
  });

  it('moves a target with a value typed by what arrived, and stands aside for a value typed later', () => {
    const before = trade('t1', 'bond', 'buy', '2026-03-01', 3_000_000);
    const into = trade('i', 'bond', 'buy', '2026-10-23', 5_000_000, { basisMinor: 4_000_000, switchId: 'sw' });
    const typed: ValuationRow[] = [{ asOf: '2026-06-30', valueMinor: 3_100_000, basis: 'estimate', createdAt: '2026-06-30T08:00:00Z' }];
    expect(switchAnchors([before, into], typed)).toEqual([]);
    expect(valueOf([before, into], typed, '2026-10-23').valueMinor).toBe(8_100_000);
    const newer: ValuationRow[] = [{ asOf: '2026-10-30', valueMinor: 8_300_000, basis: 'estimate', createdAt: '2026-10-30T08:00:00Z' }];
    expect(valueOf([before, into], newer, '2026-10-30').valueMinor).toBe(8_300_000);
  });

  it('changes the two funds together only by the fee', () => {
    const out = trade('s', 'mm', 'sell', '2026-10-23', 5_000_000, { basisMinor: 4_000_000, switchId: 'sw' });
    const into = trade('i', 'bond', 'buy', '2026-10-23', 4_975_000, { feeMinor: 25_000, basisMinor: 4_000_000, switchId: 'sw' });
    const before = valueOf(sourceBuys, sourceValue, '2026-10-23').valueMinor;
    const after = valueOf([...sourceBuys, out], sourceValue, '2026-10-23').valueMinor + valueOf([into], [], '2026-10-23').valueMinor;
    expect(before - after).toBe(25_000);
    // The money in moves whole: 8.000.000 before, 4.000.000 + 4.000.000 after.
    expect(moneyPositionAfter([...sourceBuys, out]).costMinor + moneyPositionAfter([into]).costMinor).toBe(8_000_000);
  });

  it('counts what came with a switch as put in, for the goals a fund is shared between', () => {
    const into = trade('i', 'bond', 'buy', '2026-10-23', 5_000_000, { basisMinor: 4_000_000, switchId: 'sw', goalId: 'home' });
    expect(goalMoneyOf([into])).toEqual({ byGoal: { home: 4_000_000 }, costMinor: 4_000_000 });
  });

  it('costs, in base, what its holding line pinned, as every foreign buy does', () => {
    const into = trade('i', 'usd', 'buy', '2026-10-23', 500_00, { basisMinor: 400_00, switchId: 'sw' });
    expect(positionInBase([into], { i: 6_400_000 }).costMinor).toBe(6_400_000);
  });
});
