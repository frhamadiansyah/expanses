import { describe, expect, it } from 'vitest';
import { startingBalanceQuestion, startingBalanceText } from './starting-balance';

const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('the starting balance confirm', () => {
  it('says the day, the difference with its sign, and the balance today after it', () => {
    const text = startingBalanceQuestion({ on: '2026-11-01', fromMinor: 1_000_000, toMinor: 1_200_000, todayMinor: 1_250_000, currency: 'IDR' });
    expect(nbsp(text)).toBe('Change the starting balance?\n\nEvery balance from 1 Nov 2026 moves by +Rp 200.000. Balance today becomes Rp 1.450.000.');
  });

  it('uses a minus sign when the new figure is lower', () => {
    const text = startingBalanceQuestion({ on: '2026-03-09', fromMinor: 500_000, toMinor: 350_000, todayMinor: 420_000, currency: 'IDR' });
    expect(nbsp(text)).toBe('Change the starting balance?\n\nEvery balance from 9 Mar 2026 moves by −Rp 150.000. Balance today becomes Rp 270.000.');
  });

  it('reads a foreign currency in its own units', () => {
    const text = startingBalanceQuestion({ on: '2026-09-01', fromMinor: 10_000, toMinor: 12_550, todayMinor: 9_000, currency: 'USD' });
    expect(nbsp(text)).toContain('moves by +US$25,50. Balance today becomes US$115,50.');
  });

  it('has no "you" in it', () => {
    const text = startingBalanceQuestion({ on: '2026-11-01', fromMinor: 0, toMinor: 1, todayMinor: 0, currency: 'IDR' });
    expect(text).not.toMatch(/\byou(r)?\b/i);
  });
});

describe('the starting balance field', () => {
  it('shows a stored figure grouped, below zero with a minus', () => {
    expect(startingBalanceText(1_450_000, 'IDR')).toBe('1.450.000');
    expect(startingBalanceText(-100_000, 'IDR')).toBe('-100.000');
    expect(startingBalanceText(0, 'IDR')).toBe('0');
    expect(startingBalanceText(123_456, 'USD')).toBe('1.234,56');
  });
});
