import { describe, expect, it } from 'vitest';
import { brokerMatches, INDONESIAN_BROKERS } from '../src/index';

describe('the brokers offered while one is typed', () => {
  it('finds a broker by the short name people call it, short names first', () => {
    expect(brokerMatches('Mi').map((b) => b.name)).toEqual(['Mirae Asset Sekuritas']);
    expect(brokerMatches('ipot').map((b) => b.name)).toEqual(['Indo Premier Sekuritas']);
    expect(brokerMatches('bibit').map((b) => b.name)).toEqual(['Stockbit Sekuritas']);
  });

  it('finds one by a word of its full name, at most three', () => {
    expect(brokerMatches('sek')).toHaveLength(3);
    expect(brokerMatches('Danareksa').map((b) => b.name)).toEqual(['BRI Danareksa Sekuritas']);
  });

  it('offers nothing before a letter, and nothing once the field holds a broker’s name', () => {
    expect(brokerMatches('')).toEqual([]);
    expect(brokerMatches('Stockbit Sekuritas')).toEqual([]);
  });

  it('stores each broker once', () => {
    const names = INDONESIAN_BROKERS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
