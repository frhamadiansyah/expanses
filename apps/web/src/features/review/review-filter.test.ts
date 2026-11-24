import { describe, expect, it } from 'vitest';
import { anyFilter, type FilterRow, matchesFilters, monthBounds, NO_FILTERS, NONE, shownLine, whenFilterText } from './review-desk-model';

// Invented rows.
const row = (over: Partial<FilterRow> = {}): FilterRow => ({ occurredOn: '2026-09-14', note: 'Grab', line: 'Cashflow', categoryId: null, accountId: 'acct-1', ...over });

describe('Review’s header filters', () => {
  it('narrow nothing while empty', () => {
    expect(anyFilter(NO_FILTERS)).toBe(false);
    expect(anyFilter({ ...NO_FILTERS, note: '  ' })).toBe(false);
    expect(matchesFilters(row(), NO_FILTERS)).toBe(true);
  });

  it('match the note and the line under it in any case, accents left out', () => {
    const grab = { ...NO_FILTERS, note: 'GRAB' };
    expect(anyFilter(grab)).toBe(true);
    expect(matchesFilters(row({ note: 'grabfood kemang' }), grab)).toBe(true);
    expect(matchesFilters(row({ note: 'Toko Contoh', line: 'Grab · merged' }), grab)).toBe(true);
    expect(matchesFilters(row({ note: 'Toko Contoh' }), grab)).toBe(false);
    expect(matchesFilters(row({ note: 'Café Contoh' }), { ...NO_FILTERS, note: 'cafe' })).toBe(true);
    expect(matchesFilters(row({ note: 'Cafe Contoh' }), { ...NO_FILTERS, note: 'Café' })).toBe(true);
    expect(matchesFilters(row({ note: 'Kopi   Contoh' }), { ...NO_FILTERS, note: ' kopi contoh ' })).toBe(true);
  });

  it('keep both days a When filter names', () => {
    const sept = { ...NO_FILTERS, from: '2026-09-01', to: '2026-09-30' };
    expect(matchesFilters(row({ occurredOn: '2026-09-01' }), sept)).toBe(true);
    expect(matchesFilters(row({ occurredOn: '2026-09-30' }), sept)).toBe(true);
    expect(matchesFilters(row({ occurredOn: '2026-08-31' }), sept)).toBe(false);
    expect(matchesFilters(row({ occurredOn: '2026-10-01' }), sept)).toBe(false);
    expect(matchesFilters(row({ occurredOn: '2026-01-05' }), { ...NO_FILTERS, to: '2026-01-05' })).toBe(true);
    expect(matchesFilters(row({ occurredOn: '2026-01-04' }), { ...NO_FILTERS, from: '2026-01-05' })).toBe(false);
  });

  it('match one category or account, or none', () => {
    expect(matchesFilters(row({ categoryId: 'cat-rides' }), { ...NO_FILTERS, category: 'cat-rides' })).toBe(true);
    expect(matchesFilters(row({ categoryId: 'cat-food' }), { ...NO_FILTERS, category: 'cat-rides' })).toBe(false);
    expect(matchesFilters(row({ categoryId: null }), { ...NO_FILTERS, category: NONE })).toBe(true);
    expect(matchesFilters(row({ categoryId: 'cat-food' }), { ...NO_FILTERS, category: NONE })).toBe(false);
    expect(matchesFilters(row({ accountId: null }), { ...NO_FILTERS, paid: NONE })).toBe(true);
    expect(matchesFilters(row({ accountId: 'acct-2' }), { ...NO_FILTERS, paid: 'acct-1' })).toBe(false);
  });

  it('take every filter at once', () => {
    const filters = { ...NO_FILTERS, note: 'grab', from: '2026-09-01', to: '2026-09-30' };
    expect(matchesFilters(row({ occurredOn: '2026-09-03' }), filters)).toBe(true);
    expect(matchesFilters(row({ occurredOn: '2026-10-02' }), filters)).toBe(false);
    expect(matchesFilters(row({ note: 'Toko Contoh', occurredOn: '2026-09-03' }), filters)).toBe(false);
  });

  it('say This month and Last month as their first and last days, across a year’s end', () => {
    expect(monthBounds('2026-10-20', 0)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthBounds('2026-10-20', 1)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthBounds('2027-01-05', 1)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthBounds('2028-03-01', 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('say what a When filter holds, and how many rows show', () => {
    expect(whenFilterText('2026-09-01', '2026-09-30')).toBe('1–30 Sep');
    expect(whenFilterText('2026-08-28', '2026-09-03')).toBe('28 Aug – 3 Sep');
    expect(whenFilterText('2026-09-14', '2026-09-14')).toBe('14 Sep');
    expect(whenFilterText('2026-09-01', null)).toBe('from 1 Sep');
    expect(whenFilterText(null, '2026-09-30')).toBe('to 30 Sep');
    expect(whenFilterText(null, null)).toBe('');
    expect(shownLine(6, 24)).toBe('6 of 24 shown');
  });
});
