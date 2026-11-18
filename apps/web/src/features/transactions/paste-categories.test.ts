import { describe, expect, it } from 'vitest';
import { forgetMark, guessHint, keepMarks, learnFromRecorded, nameKey, type NameStore, pastedCategories, readMarks, rememberedCategory } from './paste-categories';
import type { PastedCells, QuickValues } from './quick-row';

const memory = (): NameStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};

const cells = (over: Partial<PastedCells> = {}): PastedCells => ({ date: '3 Oct', description: 'Warung Bu Tini', amount: '18,500', paid: '5521', category: '', ...over });
const values = (over: Partial<QuickValues> = {}): QuickValues => ({ date: '3 Oct', description: 'Warung Bu Tini', amount: '18,500', accountId: 'bca', cardId: '', categoryId: '', ...over });

describe('a paste’s categories', () => {
  const offered = (id: string) => ['groceries', 'restaurants', 'cafe'].includes(id);

  it('keeps a category the names matched, with nothing to mark', async () => {
    const [row] = await pastedCategories([{ cells: cells({ category: 'Groceries' }), values: values({ categoryId: 'groceries' }) }], { remembered: () => 'cafe', history: async () => 'cafe', offered });
    expect(row).toEqual({ values: values({ categoryId: 'groceries' }), mark: {} });
  });

  it('fills an empty cell from the last purchase at that place, marked as guessed', async () => {
    const asked: string[] = [];
    const history = async (description: string) => {
      asked.push(description);
      return description === 'Warung Bu Tini' ? 'restaurants' : null;
    };
    const rows = await pastedCategories(
      [
        { cells: cells(), values: values() },
        { cells: cells({ description: 'Toko baru' }), values: values({ description: 'Toko baru' }) },
      ],
      { remembered: () => null, history, offered },
    );
    expect(rows[0]).toEqual({ values: values({ categoryId: 'restaurants' }), mark: { guessed: { categoryId: 'restaurants', how: 'history' } } });
    // No history for that place: the cell stays empty (orange), never guessed from anything else.
    expect(rows[1]).toEqual({ values: values({ description: 'Toko baru' }), mark: {} });
    expect(asked).toEqual(['Warung Bu Tini', 'Toko baru']);
  });

  it('leaves a name no category has empty, keeping it to learn from — and never asks the place’s history for it', async () => {
    let asked = false;
    const [row] = await pastedCategories([{ cells: cells({ category: 'Makan' }), values: values() }], {
      remembered: () => null,
      history: async () => {
        asked = true;
        return 'restaurants';
      },
      offered,
    });
    expect(row).toEqual({ values: values(), mark: { text: 'Makan' } });
    expect(asked).toBe(false);
  });

  it('fills a remembered name, marked as guessed, but not one that is no longer offered', async () => {
    const [known] = await pastedCategories([{ cells: cells({ category: 'Makan' }), values: values() }], { remembered: () => 'restaurants', history: async () => null, offered });
    expect(known).toEqual({ values: values({ categoryId: 'restaurants' }), mark: { text: 'Makan', guessed: { categoryId: 'restaurants', how: 'remembered' } } });
    const [gone] = await pastedCategories([{ cells: cells({ category: 'Makan' }), values: values() }], { remembered: () => 'archived', history: async () => null, offered });
    expect(gone).toEqual({ values: values(), mark: { text: 'Makan' } });
  });

  it('a history that fails reads as no guess', async () => {
    const [row] = await pastedCategories([{ cells: cells(), values: values() }], { remembered: () => null, history: () => Promise.reject(new Error('locked')), offered });
    expect(row).toEqual({ values: values(), mark: {} });
  });
});

describe('names remembered on this device', () => {
  it('learns an unmatched name when its row is recorded, in any case and spacing, and forgets the row', () => {
    const store = memory();
    keepMarks({ d1: { text: '  Makan ' }, d2: {} }, new Set(), store);
    expect(readMarks(store)).toEqual({ d1: { text: '  Makan ' } });
    expect(rememberedCategory('makan', store)).toBeNull();

    expect(learnFromRecorded('d1', 'restaurants', store)).toEqual({});
    expect(rememberedCategory('MAKAN', store)).toBe('restaurants');
    expect(rememberedCategory(' makan  ', store)).toBe('restaurants');
    expect(nameKey('  Makan   Siang ')).toBe('makan siang');
  });

  it('a recorded row that had no unmatched name teaches nothing; a later recording of the name replaces what it taught', () => {
    const store = memory();
    keepMarks({ d1: { guessed: { categoryId: 'cafe', how: 'history' } } }, new Set(), store);
    learnFromRecorded('d1', 'cafe', store);
    expect(store.data.get('paste-category-names')).toBeUndefined();

    keepMarks({ d2: { text: 'Makan' } }, new Set(), store);
    learnFromRecorded('d2', 'restaurants', store);
    keepMarks({ d3: { text: 'makan', guessed: { categoryId: 'restaurants', how: 'remembered' } } }, new Set(), store);
    learnFromRecorded('d3', 'groceries', store);
    expect(rememberedCategory('Makan', store)).toBe('groceries');
  });

  it('a discarded row is forgotten without teaching, and marks of rows no longer waiting are let go', () => {
    const store = memory();
    keepMarks({ d1: { text: 'Makan' }, d2: { text: 'Jajan' } }, new Set(), store);
    forgetMark('d1', store);
    expect(rememberedCategory('Makan', store)).toBeNull();
    expect(Object.keys(readMarks(store))).toEqual(['d2']);
    // d2 has since gone from the table (recorded elsewhere, discarded on another page).
    keepMarks({ d3: { text: 'Kopi' } }, new Set(['d3']), store);
    expect(Object.keys(readMarks(store))).toEqual(['d3']);
  });

  it('reads nothing from storage it cannot use', () => {
    const broken: NameStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(rememberedCategory('Makan', broken)).toBeNull();
    expect(keepMarks({ d1: { text: 'Makan' } }, new Set(), broken)).toEqual({ d1: { text: 'Makan' } });
    expect(rememberedCategory('Makan', null)).toBeNull();
  });

  it('says why a cell was guessed', () => {
    expect(guessHint({ guessed: { categoryId: 'cafe', how: 'history' } })).toBe('Category guessed from the last time this was bought here');
    expect(guessHint({ text: 'Makan', guessed: { categoryId: 'restaurants', how: 'remembered' } })).toBe('Category guessed from an earlier paste of “Makan”');
    expect(guessHint({ text: 'Makan' })).toBeNull();
    expect(guessHint(undefined)).toBeNull();
  });
});
