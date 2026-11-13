import { describe, expect, it } from 'vitest';
import { billsForPurchase, candidateLine, monthWithYear, purchaseCount, refusalText, repeatWords, wheelYears, billTapAction } from './bill-link-view';

describe('the link screens', () => {
  it('names a month with its year', () => {
    expect(monthWithYear('2026-03')).toBe('March 2026');
  });
  it('counts purchases', () => {
    expect([0, 1, 2].map(purchaseCount)).toEqual(['None found', '1 purchase', '2 purchases']);
  });
  it('writes a candidate second line', () => {
    expect(candidateLine('2026-03-09', 'BCA Tahapan')).toBe('9 Mar · BCA Tahapan');
    expect(candidateLine('2026-03-09', null)).toBe('9 Mar');
  });
  it('says how often a bill comes out', () => {
    expect(repeatWords({ repeat: 'monthly', repeatEvery: null })).toBe('Every month');
    expect(repeatWords({ repeat: 'yearly', repeatEvery: null })).toBe('Every year');
    expect(repeatWords({ repeat: 'months', repeatEvery: 3 })).toBe('Every 3 months');
  });
  it('puts the bills of the purchase category first', () => {
    const bills = [{ categoryAccountId: 'a' }, { categoryAccountId: 'b' }, { categoryAccountId: 'a' }];
    const { same, others } = billsForPurchase(bills, ['a']);
    expect(same).toHaveLength(2);
    expect(others).toEqual([{ categoryAccountId: 'b' }]);
  });
  it('offers years from five before the purchase to the year after next month', () => {
    expect(wheelYears('2026-03', '2026-10')).toEqual(['2021', '2022', '2023', '2024', '2025', '2026']);
    expect(wheelYears('2026-03', '2026-12')).toContain('2027');
  });
  it('words the refusals', () => {
    expect(refusalText('ALREADY_SETTLED', '2026-03', 'x')).toBe('March 2026 is already paid');
    expect(refusalText('SKIPPED', '2026-03', 'x')).toBe('March 2026 is skipped. Unskip it first.');
    expect(refusalText('MONTH_AHEAD', '2026-03', 'That month is not out yet')).toBe('That month is not out yet');
  });
});

describe('what a tap on a bill in the receipt’s list does', () => {
  const ready = { settled: true, linked: false, locked: false, hasPurchase: true };
  it('links at once only once the purchase’s current link is known to be none', () => {
    expect(billTapAction(ready)).toBe('link');
    // Still reading whether it is linked (a cold open, a reload, the other phone's link arriving): nothing yet.
    expect(billTapAction({ ...ready, settled: false })).toBe('wait');
    expect(billTapAction({ ...ready, hasPurchase: false })).toBe('wait');
  });
  it('a purchase linked already opens the month page: the link moves only by its ✓', () => {
    expect(billTapAction({ ...ready, linked: true })).toBe('months');
  });
  it('a shared event’s purchase does nothing from here', () => {
    expect(billTapAction({ ...ready, locked: true })).toBe('none');
    expect(billTapAction({ ...ready, locked: true, linked: true })).toBe('none');
  });
});

describe('a paused month under the Month row', () => {
  it('says it is paused, as a skipped month says it is skipped', () => {
    expect(refusalText('PAUSED', '2026-11', 'That month is paused')).toBe('November 2026 is paused. Resume the bill first.');
  });
});
