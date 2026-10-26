import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { categoryIn, draftIn } from './move-workspace';
import { emptyForm } from './tx-form';

const cat = (id: string, name: string, o: Partial<AccountRow> = {}) => ({ id, name, kind: 'expense', systemKey: null, parentId: null, archivedAt: null, ...o }) as AccountRow;
const accounts = [
  cat('p-food', 'Food'),
  cat('p-rest', 'Restaurants', { systemKey: 'food_beverage.restaurants', parentId: 'p-food' }),
  cat('p-gift', 'Client gifts'),
  cat('p-taxi', 'Taxi', { parentId: 'p-food' }),
  cat('b-food', 'Food'),
  cat('b-rest', 'Eating out', { systemKey: 'food_beverage.restaurants', parentId: 'b-food' }),
  cat('b-trans', 'Transport'),
  cat('b-taxi', 'taxi', { parentId: 'b-trans' }),
];
const books = { 'p-food': 'P', 'p-rest': 'P', 'p-gift': 'P', 'p-taxi': 'P', 'b-food': 'B', 'b-rest': 'B', 'b-trans': 'B', 'b-taxi': 'B' };

describe('a category’s copy in another workspace', () => {
  it('goes by key first, even renamed; then by name, any case', () => {
    expect(categoryIn('p-rest', 'B', accounts, books)).toBe('b-rest');
    expect(categoryIn('p-taxi', 'B', accounts, books)).toBe('b-taxi');
    expect(categoryIn('p-gift', 'B', accounts, books)).toBeNull();
  });

  it('re-files a draft and names what has no copy', () => {
    const draft = { ...emptyForm('P'), categoryId: 'p-gift', splits: [] };
    expect(draftIn(draft, 'B', accounts, books)).toMatchObject({ draft: { categoryId: '' }, missing: ['Client gifts'] });
    const split = { ...emptyForm('P'), splits: [{ categoryId: 'p-rest', amount: '1' }, { categoryId: 'p-taxi', amount: '2' }] };
    expect(draftIn(split, 'B', accounts, books)).toMatchObject({ draft: { splits: [{ categoryId: 'b-rest' }, { categoryId: 'b-taxi' }] }, missing: [] });
    // Each line keeps its own Exclude from report across the move (0096).
    const off = { ...split, splits: [{ categoryId: 'p-rest', amount: '1', excluded: true }, { categoryId: 'p-taxi', amount: '2' }] };
    expect(draftIn(off, 'B', accounts, books).draft.splits).toEqual([
      { categoryId: 'b-rest', amount: '1', excluded: true },
      { categoryId: 'b-taxi', amount: '2' },
    ]);
  });

  it('swaps a transfer’s fee category and a card top-up’s Top-ups for their copies', () => {
    const more = [...accounts, cat('p-fee', 'Fees', { systemKey: 'miscellaneous.fees_charges' }), cat('b-fee', 'Bank charges', { systemKey: 'miscellaneous.fees_charges' }), cat('p-top', 'Top-ups', { systemKey: 'miscellaneous.top_ups' })];
    const moreBooks = { ...books, 'p-fee': 'P', 'b-fee': 'B', 'p-top': 'P' };
    const transfer = { ...emptyForm('P'), mode: 'transfer' as const, feeCategoryId: 'p-fee', topUpCategoryId: 'p-top' };
    const moved = draftIn(transfer, 'B', more, moreBooks);
    expect(moved.draft.feeCategoryId).toBe('b-fee');
    // No Top-ups there yet: not missing, the save makes it in that workspace.
    expect(moved.missing).toEqual([]);
    expect(moved.draft.topUpCategoryId).toBe('');
    expect(draftIn({ ...transfer, feeCategoryId: '' }, 'B', more, moreBooks).draft.feeCategoryId).toBe('');
  });
});
