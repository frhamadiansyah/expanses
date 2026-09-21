import { describe, expect, it } from 'vitest';
import { TAP, tapReach } from './metrics';
import { fitSegments, SEGMENT_HEIGHT, SEGMENT_MORE, type Segment } from './segments';

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

/**
 * The control is drawn as iOS draws it and reached as the kit demands. Both halves are asserted, because
 * satisfying either one alone is the failure: 44 drawn is not native, and 28 reached is not tappable.
 */
describe('the segmented control against the tap floor', () => {
  it('keeps iOS’s own 28px segment — it never grows to meet the floor', () => {
    expect(SEGMENT_HEIGHT).toBeLessThan(TAP);
    expect(SEGMENT_HEIGHT).toBe(28);
  });

  it('gives a segment a 44pt target anyway, by reaching past what it draws', () => {
    expect(SEGMENT_HEIGHT + tapReach(SEGMENT_HEIGHT) * 2).toBeGreaterThanOrEqual(TAP);
  });

  it('reaches the … in both directions, since 32 square is under the floor on both', () => {
    expect(SEGMENT_MORE).toBeLessThan(TAP);
    expect(SEGMENT_MORE + tapReach(SEGMENT_MORE) * 2).toBeGreaterThanOrEqual(TAP);
  });
});
