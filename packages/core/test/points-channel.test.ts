import { describe, expect, it } from 'vitest';
import { matchesSpend, type SpendLine } from '../src/index';

const line = (over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId: 't', entryId: 'e', occurredOn: '2026-09-17', categoryId: 'shopping', description: 'Tokopedia',
  amountMinor: 1_000_000, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, cardFee: false, ...over,
});

describe('a rule that earns only online', () => {
  it('takes a purchase marked online', () => {
    expect(matchesSpend({ channel: 'online' }, line({ channel: 'online' }), {})).toBe(true);
  });

  it('refuses one marked offline', () => {
    expect(matchesSpend({ channel: 'online' }, line({ channel: 'offline' }), {})).toBe(false);
  });

  it('falls back to the merchant keywords when nothing was said', () => {
    expect(matchesSpend({ channel: 'online', merchantPatterns: ['tokopedia'] }, line(), {})).toBe(true);
    expect(matchesSpend({ channel: 'online', merchantPatterns: ['tokopedia'] }, line({ description: 'Warung Steak' }), {})).toBe(false);
  });

  it('leaves every rule that names no channel exactly as it was', () => {
    expect(matchesSpend({}, line({ channel: 'offline' }), {})).toBe(true);
  });
});
