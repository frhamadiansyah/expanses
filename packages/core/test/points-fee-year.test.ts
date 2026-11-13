import { describe, expect, it } from 'vitest';
import { type FeeWaiver, feeProgressWindow, feeWaiverRowText, feeYearLines, feeYearState } from '../src/index';

/*
 * The Fee waiver page's fee year (owner, 13 Nov 2026): which lines a fee year shows, how it stands, the window Progress
 * counts over and what Settings' Fee waiver row reads. Invented figures.
 */

const automatic: FeeWaiver = { kind: 'automatic', amountMinor: 50_000_000, countedFrom: null, spendBy: null, categoryIds: [] };
const challenge: FeeWaiver = { kind: 'challenge', amountMinor: 12_000_000, countedFrom: '2026-10-21', spendBy: '2027-01-19', categoryIds: [] };
const lifetime: FeeWaiver = { kind: 'lifetime', amountMinor: 0, countedFrom: null, spendBy: null, categoryIds: [] };
const none = { charged: false, beforeApp: false, reversed: false, marked: false };

describe('fee year lines', () => {
  it('reads Pending while nothing is recorded', () => {
    expect(feeYearLines(none)).toEqual(['pending']);
    expect(feeYearState(none)).toBe('pending');
  });
  it('reads Charged once the charge is on the card', () => {
    expect(feeYearLines({ ...none, charged: true })).toEqual(['charged']);
    expect(feeYearState({ ...none, charged: true })).toBe('charged');
  });
  it('puts the reversal under the charge, and the year reads waived', () => {
    expect(feeYearLines({ ...none, charged: true, reversed: true })).toEqual(['charged', 'reversal']);
    expect(feeYearState({ ...none, charged: true, reversed: true })).toBe('waived');
  });
  it('reads a charge before the app as charged only once a reversal is there', () => {
    expect(feeYearLines({ ...none, beforeApp: true, reversed: true })).toEqual(['charged-before-app', 'reversal']);
    expect(feeYearState({ ...none, beforeApp: true, reversed: true })).toBe('waived');
    // With no reversal nothing says it was charged: still pending.
    expect(feeYearLines({ ...none, beforeApp: true })).toEqual(['pending']);
    expect(feeYearState({ ...none, beforeApp: true })).toBe('pending');
  });
  it('reads Waived for a year marked waived with no charge', () => {
    expect(feeYearLines({ ...none, marked: true })).toEqual(['waived']);
    expect(feeYearState({ ...none, marked: true })).toBe('waived');
  });
  it('keeps a recorded charge on show under an older mark, and the year stays waived', () => {
    expect(feeYearLines({ ...none, charged: true, marked: true })).toEqual(['charged']);
    expect(feeYearState({ ...none, charged: true, marked: true })).toBe('waived');
  });
});

describe('fee progress window', () => {
  // The fee is charged on 15 Oct; today is 13 Nov, so the 2026 fee has passed.
  const TODAY = '2026-11-13';
  it('counts a yearly amount over the 12 months up to the fee year it covers while that is open', () => {
    expect(feeProgressWindow(automatic, '2025-10-15', TODAY, false)).toEqual({ from: '2025-10-16', to: '2026-10-15', feeYear: 2026 });
  });
  it('counts toward the next fee once the covered one is settled', () => {
    expect(feeProgressWindow(automatic, '2025-10-15', TODAY, true)).toEqual({ from: '2026-10-16', to: '2027-10-15', feeYear: 2027 });
  });
  it('counts toward a coming fee within 30 days, and the one after once that is settled', () => {
    expect(feeProgressWindow(automatic, '2025-12-01', TODAY, false)).toEqual({ from: '2025-12-02', to: '2026-12-01', feeYear: 2026 });
    expect(feeProgressWindow(automatic, '2025-12-01', TODAY, true)).toEqual({ from: '2026-12-02', to: '2027-12-01', feeYear: 2027 });
  });
  it('keeps 29 Feb on 28 Feb in a year without one', () => {
    expect(feeProgressWindow(automatic, '2024-02-29', '2027-03-10', false)).toEqual({ from: '2026-03-01', to: '2027-02-28', feeYear: 2027 });
  });
  it('counts a challenge over its own days, settled or not', () => {
    expect(feeProgressWindow(challenge, '2025-10-15', TODAY, false)).toEqual({ from: '2026-10-21', to: '2027-01-19', feeYear: null });
    expect(feeProgressWindow(challenge, '2025-10-15', TODAY, true)).toEqual({ from: '2026-10-21', to: '2027-01-19', feeYear: null });
  });
  it('counts a yearly amount over the last 12 months on a card with no fee date', () => {
    expect(feeProgressWindow(automatic, null, TODAY, false)).toEqual({ from: '2025-11-14', to: '2026-11-13', feeYear: null });
  });
});

describe('fee waiver row', () => {
  const T = '2026-11-13';
  it('names the settled year first', () => {
    expect(feeWaiverRowText({ year: 2026, state: 'waived' }, automatic, 'Rp 18 jt', T, 2026)).toBe('2026 waived');
    expect(feeWaiverRowText({ year: 2026, state: 'waived' }, challenge, 'Rp 8,6 jt', T, 2026)).toBe('2026 waived');
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, null, null, T, 2026)).toBe('2026 charged');
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, automatic, 'Rp 18 jt', T, 2026)).toBe('2026 charged');
  });
  it('reads None without a program, and what is left to spend with one', () => {
    expect(feeWaiverRowText({ year: 2026, state: 'pending' }, null, null, T, 2026)).toBe('None');
    expect(feeWaiverRowText(null, null, null, T, 2026)).toBe('None');
    expect(feeWaiverRowText({ year: 2026, state: 'pending' }, automatic, 'Rp 18 jt', T, 2026)).toBe('Rp 18 jt to go');
    expect(feeWaiverRowText({ year: 2026, state: 'pending' }, challenge, 'Rp 8,6 jt', T, 2026)).toBe('Rp 8,6 jt to go');
  });
  it('says Reached with nothing left to spend, and Free for life for a fee that is always waived', () => {
    expect(feeWaiverRowText({ year: 2026, state: 'pending' }, automatic, null, T, 2026)).toBe('Reached');
    expect(feeWaiverRowText({ year: 2026, state: 'pending' }, lifetime, null, T, 2026)).toBe('Free for life');
  });
  // Mockup section 5: the fee is charged, then the bank's challenge runs; Settings follows the challenge, not the charge.
  it('follows a running challenge on a charged year, and reads charged once it ended short', () => {
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, challenge, 'Rp 8,6 jt', T, 2026)).toBe('Rp 8,6 jt to go');
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, challenge, null, T, 2026)).toBe('Reached');
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, challenge, 'Rp 8,6 jt', '2027-01-20', 2026)).toBe('2026 charged');
    // Ended but reached: still waiting for the bank's reversal.
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, challenge, null, '2027-01-20', 2026)).toBe('Reached');
  });
  // Review round 2: last year's met challenge, still on the card, says nothing about the 2026 fee.
  it('reads charged when the challenge is another fee year’s', () => {
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, challenge, null, T, 2025)).toBe('2026 charged');
    expect(feeWaiverRowText({ year: 2026, state: 'charged' }, challenge, 'Rp 8,6 jt', T, null)).toBe('2026 charged');
  });
});
