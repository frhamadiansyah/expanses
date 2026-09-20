import { describe, expect, it } from 'vitest';
import { fitSegments, type Segment } from './segments';

/** The four tabs `/cards/$cardId` carries today as an underline row that wraps at 390px. */
const CARD_TABS: Segment[] = [
  { key: 'statement', label: 'Statement' },
  { key: 'points', label: 'Points' },
  { key: 'rules', label: 'Rewards rules', short: 'Rules' },
  { key: 'card', label: 'Card' },
];

/** The five `/net-worth` carries, which wrap to two lines on a phone today. */
const NET_WORTH: Segment[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'assets', label: 'Assets' },
  { key: 'trades', label: 'Buy & sell', short: 'Trades' },
  { key: 'debts', label: 'Lend & borrow', short: 'Debts' },
  { key: 'loans', label: 'Loans' },
];

describe('fitSegments', () => {
  it('has nothing to place when given nothing', () => {
    expect(fitSegments([])).toEqual({ shown: [], overflow: [], segmentWidth: 0 });
  });

  it('gives every segment the same width', () => {
    const plan = fitSegments(CARD_TABS);
    expect(plan.segmentWidth).toBe(96);
    expect(plan.shown).toHaveLength(4);
  });

  it('shortens “Rewards rules” to “Rules” so the card page keeps all four tabs at phone width', () => {
    const plan = fitSegments(CARD_TABS);
    expect(plan.shown.map((segment) => segment.label)).toEqual(['Statement', 'Points', 'Rules', 'Card']);
    expect(plan.shown.map((segment) => segment.shortened)).toEqual([false, false, true, false]);
    expect(plan.overflow).toEqual([]);
  });

  it('never places a fifth segment on a phone, whatever the labels', () => {
    const plan = fitSegments(NET_WORTH);
    expect(plan.shown).toHaveLength(4);
    expect(plan.overflow.map((segment) => segment.key)).toEqual(['loans']);
  });

  it('keeps the full labels when a wide screen has room for them', () => {
    const plan = fitSegments(NET_WORTH, 900, 5);
    expect(plan.shown.map((segment) => segment.label)).toEqual(['Overview', 'Assets', 'Buy & sell', 'Lend & borrow', 'Loans']);
    expect(plan.overflow).toEqual([]);
  });

  it('drops a segment rather than wrap one, when even the short names will not fit', () => {
    const plan = fitSegments(CARD_TABS, 160);
    expect(plan.shown.length).toBeLessThan(4);
    expect(plan.overflow.length).toBeGreaterThan(0);
  });

  it('shows one clipped segment rather than an empty track when a lone label cannot be shortened', () => {
    const plan = fitSegments([{ key: 'long', label: 'Outstanding statement balance' }], 90);
    expect(plan.shown.map((segment) => segment.key)).toEqual(['long']);
    expect(plan.overflow).toEqual([]);
  });
});
