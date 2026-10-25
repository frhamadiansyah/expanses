import { CATALOG } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { categoryNameForKey, debitEntries, rewardsLabel, searchCatalog } from './catalog-picker';

describe('debitEntries', () => {
  it('keeps only debit cards', () => {
    const debit = debitEntries(CATALOG);
    expect(debit.length).toBeGreaterThan(0);
    expect(debit.every((entry) => entry.cardType === 'debit')).toBe(true);
    expect(debit.length).toBeLessThan(CATALOG.length);
  });
});

describe('rewardsLabel', () => {
  const entry = debitEntries(CATALOG)[0]!;
  it('says Not set up without a programme', () => {
    expect(rewardsLabel(undefined, CATALOG)).toBe('Not set up');
  });
  it('names the linked catalogue programme, else the programme, else Earning', () => {
    expect(rewardsLabel({ name: 'Old name', catalogEntryId: entry.id }, CATALOG)).toBe(entry.program.name);
    expect(rewardsLabel({ name: 'Own', catalogEntryId: null }, CATALOG)).toBe('Own');
    expect(rewardsLabel({ name: '', catalogEntryId: null }, CATALOG)).toBe('Earning');
  });
});

describe('searchCatalog', () => {
  it('matches every query word against bank and card name, in any order and case', () => {
    expect(searchCatalog(CATALOG, 'krisflyer BCA').map((e) => e.id)).toEqual(['bca-sq-krisflyer-visa-infinite', 'bca-sq-krisflyer-visa-signature']);
    expect(searchCatalog(CATALOG, 'mandiri').map((e) => e.id).sort()).toEqual(['mandiri-marriott-bonvoy', 'mandiri-world-prioritas']);
    expect(searchCatalog(CATALOG, 'amex')).toEqual([]);
  });

  it('lists every entry for a blank query, sorted by bank then name', () => {
    const all = searchCatalog(CATALOG, '   ');
    expect(all).toHaveLength(CATALOG.length);
    const order = all.map((e) => `${e.bank}|${e.name}`);
    expect(order).toEqual([...order].sort((a, b) => a.localeCompare(b)));
  });
});

describe('categoryNameForKey', () => {
  it('names default category keys and passes unknown keys through', () => {
    expect(categoryNameForKey('government_taxes')).toBe('Government & taxes');
    expect(categoryNameForKey('utilities.gas_energy')).toBe('Gas & energy');
    expect(categoryNameForKey('unknown.key')).toBe('unknown.key');
  });
});
