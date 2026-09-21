import { describe, expect, it } from 'vitest';
import { TAP, tapReach } from './metrics';
import { activeSegment, fitSegments, SEGMENT_HEIGHT, SEGMENT_MORE, type Segment, segmentRoute } from './segments';

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
 * The five `/net-worth` sections as they are actually declared: each names the route it goes to, so each is
 * drawn as a link and keeps middle click and open-in-new-tab.
 */
const SECTIONS: Segment[] = [
  { key: '/net-worth', label: 'Overview', to: '/net-worth' },
  { key: '/net-worth/assets', label: 'Assets', to: '/net-worth/assets' },
  { key: '/net-worth/trades', label: 'Buy & sell', short: 'Trades', to: '/net-worth/trades' },
  { key: '/net-worth/debts', label: 'Lend & borrow', short: 'Debts', to: '/net-worth/debts' },
  { key: '/net-worth/loans', label: 'Loans', to: '/net-worth/loans' },
];

describe('a segment that names a route', () => {
  it('has no route when it only changes something on the page', () => {
    expect(segmentRoute({ key: 'ttm', label: 'Last 12 months' })).toBeNull();
    expect(segmentRoute(CARD_TABS[0]!)).toBeNull();
  });

  it('carries the route it was given, parameters and search included', () => {
    expect(segmentRoute({ key: 'loans', label: 'Loans', to: '/net-worth/loans' })).toEqual({
      to: '/net-worth/loans',
      params: undefined,
      search: undefined,
    });
  });

  it('keeps the full label as the name a screen reader hears when the drawn one is shortened', () => {
    const plan = fitSegments(CARD_TABS);
    const rules = plan.shown.find((segment) => segment.key === 'rules');
    expect(rules?.label).toBe('Rules');
    expect(rules?.name).toBe('Rewards rules');
    // A segment drawn whole is named by what is drawn.
    expect(plan.shown.find((segment) => segment.key === 'points')?.name).toBe('Points');
  });

  it('keeps a segment’s route when its label is shortened to fit', () => {
    const [debts] = fitSegments([{ key: 'debts', label: 'Lend & borrow', short: 'Debts', to: '/net-worth/debts' }], 90).shown;
    expect(debts?.label).toBe('Debts');
    expect(debts?.shortened).toBe(true);
    // The shorter name is the same section: a renamed segment must still open in a new tab.
    expect(debts?.route).toEqual({ to: '/net-worth/debts', params: undefined, search: undefined });
  });

  it('keeps the route of the segment that a phone pushes behind the …', () => {
    const plan = fitSegments(SECTIONS);
    expect(plan.shown.every((segment) => segment.route !== null)).toBe(true);
    // Loans is the fifth, and behind the … it is still a link rather than a button that navigates.
    expect(plan.overflow.map((segment) => segmentRoute(segment)?.to)).toEqual(['/net-worth/loans']);
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

/**
 * Which segment an address lights. The whole point is the case a `find` gets wrong: `/net-worth` is a prefix of
 * every other net-worth route, so the first match would leave **Overview** lit while the reader is on Debts —
 * the tab navigates and the control denies it.
 */
describe('activeSegment', () => {
  const KEYS = ['/net-worth', '/net-worth/assets', '/net-worth/trades', '/net-worth/debts', '/net-worth/loans'];

  it('lights the section being read, not the section that contains it', () => {
    expect(activeSegment(KEYS, '/net-worth/debts', '/net-worth')).toBe('/net-worth/debts');
    expect(activeSegment(KEYS, '/net-worth/loans', '/net-worth')).toBe('/net-worth/loans');
  });

  it('lights the overview only when the overview is the address', () => {
    expect(activeSegment(KEYS, '/net-worth', '/net-worth')).toBe('/net-worth');
  });

  it('gives a page under a section that section, however deep it sits', () => {
    expect(activeSegment(KEYS, '/net-worth/assets/abc-123', '/net-worth')).toBe('/net-worth/assets');
  });

  it('takes a key as a parent only on a whole segment, never on a shared prefix', () => {
    expect(activeSegment(KEYS, '/net-worthish', '/net-worth')).toBe('/net-worth');
  });

  it('falls back when the address belongs to no segment at all', () => {
    expect(activeSegment(KEYS, '/cards', '/net-worth')).toBe('/net-worth');
  });

  it('does not depend on the order the keys arrive in', () => {
    expect(activeSegment([...KEYS].reverse(), '/net-worth/assets', '/net-worth')).toBe('/net-worth/assets');
  });
});

