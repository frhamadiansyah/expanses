import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { buildRowOptions } from './QuickRowEditor';
import { foldName, parsePastedRows, pastedCells } from './quick-row';

// A pasted Category cell is matched in any case, with accents left out and "&" read as "and" — nothing looser
// (owner 2026-11-18). The names are invented.
const account = (id: string, name: string, extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind: 'expense', subtype: 'category', name, icon: null, currency: null, valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});
const accounts = [
  account('food', 'Food & Drink'),
  account('cafe', 'Café Kecil', { parentId: 'food' }),
  account('dessert', 'Dessert', { parentId: 'food' }),
  account('kids', 'Kids and Family'),
];

describe('a pasted category’s name', () => {
  const resolve = buildRowOptions(accounts, []).resolvePastedCategory;

  it('folds case, accents and “&”/“and”', () => {
    expect(foldName('  Café   &  Co ')).toBe('cafe and co');
    expect(foldName('Crème Brûlée&Tea')).toBe('creme brulee and tea');
    expect(resolve('cafe kecil')).toBe('cafe');
    expect(resolve('CAFÉ KECIL')).toBe('cafe');
    expect(resolve('Food and Drink')).toBe('food');
    expect(resolve('food & drink')).toBe('food');
    expect(resolve('Kids & Family')).toBe('kids');
  });

  it('is no looser than that: a misspelt name stays unmatched', () => {
    expect(resolve('Desert')).toBeNull();
    expect(resolve('Dessert')).toBe('dessert');
  });

  it('the typing row’s own match is unchanged', () => {
    expect(buildRowOptions(accounts, []).resolveCategory('Cafe Kecil')).toBeNull();
  });

  it('a header row’s names fold the same way', () => {
    expect(pastedCells(parsePastedRows('DATE\tNOTE\tCatégory\tAmount\n1 Oct\tKopi\tCafe\t9.000'), 'desk')).toEqual([{ date: '1 Oct', description: 'Kopi', category: 'Cafe', paid: '', amount: '9.000' }]);
  });
});
