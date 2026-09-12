import { describe, expect, it } from 'vitest';
import { averagePriceMicro, positionAfter, sellBasisMinor, type TradeRecord, TradeError } from '../src/index';

let seq = 0;
function trade(partial: Partial<TradeRecord> & Pick<TradeRecord, 'kind' | 'occurredOn'>): TradeRecord {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'gold',
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    unitsMicro: 0,
    grossMinor: 0,
    feeMinor: 0,
    taxMinor: 0,
    ...partial,
  };
}
const buy = (occurredOn: string, units: number, grossMinor: number, extra: Partial<TradeRecord> = {}) =>
  trade({ kind: 'buy', occurredOn, unitsMicro: units * 1_000_000, grossMinor, ...extra });
const sell = (occurredOn: string, units: number, grossMinor: number, extra: Partial<TradeRecord> = {}) =>
  trade({ kind: 'sell', occurredOn, unitsMicro: units * 1_000_000, grossMinor, ...extra });

describe('positionAfter', () => {
  it('gives the weighted average cost of two buys', () => {
    const p = positionAfter([buy('2024-02-03', 10, 10_000_000), buy('2026-03-09', 10, 15_000_000)]);
    expect(p.unitsMicro).toBe(20_000_000);
    expect(p.costMinor).toBe(25_000_000);
    expect(averagePriceMicro(p)).toBe(1_250_000_000_000);
  });

  it('includes fees and tax on a buy in cost', () => {
    const p = positionAfter([buy('2026-02-16', 10, 10_000_000, { feeMinor: 15_000, taxMinor: 5_000 })]);
    expect(p.costMinor).toBe(10_020_000);
  });

  it('removes cost in proportion on a partial sell and leaves the average unchanged', () => {
    const p = positionAfter([buy('2024-02-03', 10, 10_000_000), buy('2026-03-09', 10, 15_000_000), sell('2026-06-14', 5, 8_000_000)]);
    expect(p.unitsMicro).toBe(15_000_000);
    expect(p.costMinor).toBe(18_750_000);
    expect(averagePriceMicro(p)).toBe(1_250_000_000_000);
    expect(p.realizedMinor).toBe(8_000_000 - 6_250_000);
  });

  it('books fees and withheld tax against the realized gain', () => {
    const p = positionAfter([buy('2024-02-03', 10, 10_000_000), sell('2026-06-14', 10, 12_000_000, { feeMinor: 18_000, taxMinor: 12_000 })]);
    expect(p.realizedMinor).toBe(12_000_000 - 18_000 - 12_000 - 10_000_000);
  });

  it('leaves nothing behind when everything is sold', () => {
    const p = positionAfter([buy('2024-02-03', 10, 10_000_001), sell('2026-06-14', 10, 9_000_000)]);
    expect(p.unitsMicro).toBe(0);
    expect(p.costMinor).toBe(0);
    expect(averagePriceMicro(p)).toBeNull();
  });

  it('counts income net of tax and leaves units and cost alone', () => {
    const p = positionAfter([buy('2025-05-19', 10, 10_000_000), trade({ kind: 'income', occurredOn: '2026-04-22', grossMinor: 540_000, taxMinor: 54_000 })]);
    expect(p.incomeMinor).toBe(486_000);
    expect(p.unitsMicro).toBe(10_000_000);
    expect(p.costMinor).toBe(10_000_000);
  });

  it('scales units on a unit change without touching cost', () => {
    const p = positionAfter([
      buy('2025-05-19', 2000, 18_200_000),
      trade({ kind: 'unit_change', occurredOn: '2026-05-02', unitsMicro: 8000 * 1_000_000 }),
    ]);
    expect(p.unitsMicro).toBe(10_000_000_000);
    expect(p.costMinor).toBe(18_200_000);
    expect(p.byYear['2025']!.unitsMicro).toBe(10_000_000_000);
  });

  it('walks trades by date then creation time, not input order', () => {
    const first = buy('2024-02-03', 10, 10_000_000);
    const second = buy('2026-03-09', 10, 15_000_000);
    const later = sell('2026-06-14', 5, 8_000_000);
    expect(positionAfter([later, second, first]).costMinor).toBe(18_750_000);
  });

  it('stops at upTo', () => {
    const trades = [buy('2024-02-03', 10, 10_000_000), buy('2026-03-09', 10, 15_000_000)];
    expect(positionAfter(trades, '2025-12-31').unitsMicro).toBe(10_000_000);
  });

  it('splits cost by purchase year and a sell reduces every year in proportion', () => {
    const p = positionAfter([buy('2024-02-03', 10, 10_000_000), buy('2026-03-09', 10, 15_000_000), sell('2026-06-14', 10, 20_000_000)]);
    expect(p.byYear['2024']!.unitsMicro).toBe(5_000_000);
    expect(p.byYear['2026']!.unitsMicro).toBe(5_000_000);
    expect(p.byYear['2024']!.costMinor).toBe(5_000_000);
    expect(p.byYear['2026']!.costMinor).toBe(7_500_000);
    expect(p.byYear['2024']!.costMinor + p.byYear['2026']!.costMinor).toBe(p.costMinor);
  });

  it('refuses to sell more than is held', () => {
    const trades = [buy('2024-02-03', 10, 10_000_000), sell('2026-06-14', 11, 20_000_000)];
    expect(() => positionAfter(trades)).toThrow(TradeError);
    expect(() => positionAfter(trades)).toThrow(/10/);
  });
});

describe('sellBasisMinor', () => {
  it('takes cost in proportion to the units sold', () => {
    const p = positionAfter([buy('2024-02-03', 10, 10_000_000), buy('2026-03-09', 10, 15_000_000)]);
    expect(sellBasisMinor(p, 5_000_000)).toBe(6_250_000);
  });

  it('takes all remaining cost when everything is sold', () => {
    const p = positionAfter([buy('2024-02-03', 3, 10_000_001)]);
    expect(sellBasisMinor(p, 3_000_000)).toBe(10_000_001);
  });

  it('rounds half away from zero', () => {
    const p = positionAfter([buy('2024-02-03', 2, 5)]);
    expect(sellBasisMinor(p, 1_000_000)).toBe(3);
  });

  it('refuses more units than the position holds', () => {
    const p = positionAfter([buy('2024-02-03', 10, 10_000_000)]);
    expect(() => sellBasisMinor(p, 10_000_001)).toThrow(TradeError);
  });
});
