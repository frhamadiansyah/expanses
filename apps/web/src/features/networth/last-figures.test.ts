import { describe, expect, it } from 'vitest';
import { forgetLastFigures, keepLastFigures, lastFigures } from './last-figures';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const PERSONAL = { household: false, currency: 'IDR', netWorthMinor: 1_870_224_572, assetsMinor: 2_793_604_640, liabilitiesMinor: 923_380_068 };

describe('the figures Net worth last showed', () => {
  it('are offered back to the same workspace, for a page of the same kind in the same currency', () => {
    const storage = memoryStorage();
    keepLastFigures('ws-1', PERSONAL, storage);
    expect(lastFigures('ws-1', { household: false, currency: 'IDR' }, storage)).toEqual(PERSONAL);
    expect(lastFigures('ws-2', { household: false, currency: 'IDR' }, storage)).toBeNull();
    // A personal total never stands where the household's belongs, nor the other way round.
    expect(lastFigures('ws-1', { household: true, currency: 'IDR' }, storage)).toBeNull();
    expect(lastFigures('ws-1', { household: false, currency: 'USD' }, storage)).toBeNull();
  });

  it('are forgotten when the database is replaced, and read nothing from storage that is broken or absent', () => {
    const storage = memoryStorage();
    keepLastFigures('ws-1', PERSONAL, storage);
    forgetLastFigures(storage);
    expect(lastFigures('ws-1', { household: false, currency: 'IDR' }, storage)).toBeNull();
    storage.setItem('cicis.net-worth.last-figures', '{not json');
    expect(lastFigures('ws-1', { household: false, currency: 'IDR' }, storage)).toBeNull();
    storage.setItem('cicis.net-worth.last-figures', JSON.stringify({ 'ws-1': { ...PERSONAL, netWorthMinor: '12' } }));
    expect(lastFigures('ws-1', { household: false, currency: 'IDR' }, storage)).toBeNull();
    expect(lastFigures('ws-1', { household: false, currency: 'IDR' }, undefined)).toBeNull();
  });
});
