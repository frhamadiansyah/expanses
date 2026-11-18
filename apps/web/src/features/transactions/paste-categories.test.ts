import { describe, expect, it } from 'vitest';
import { forgetMark, guessHint, keepMarks, learnFromRecorded, learnFromSaved, nameKey, type NameStore, paidHint, pastedCategories, readMarks, rememberedCategory, rememberedPaid, unknownLinks, unknownLinksLine } from './paste-categories';
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

describe('Notion links remembered on this device', () => {
  // Invented page ids: a "Food" category relation, a "Card" account relation, a second category.
  const FOOD = 'notion:0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  const CARD = 'notion:11112222333344445555666677778888';
  const BOTH = 'notion:0f1e2d3c4b5a69788796a5b4c3d2e1f0,aaaabbbbccccddddeeeeffff00001111';
  const offered = (id: string) => ['groceries', 'restaurants', 'cafe'].includes(id);
  const offeredPaid = (key: string) => ['bca', 'bonvoy:c2'].includes(key);
  const linked = (category?: string, paid?: string, over: Partial<PastedCells> = {}) => cells({ category: '', paid: '', links: { ...(category ? { category } : {}), ...(paid ? { paid } : {}) }, ...over });
  const blank = (over: Partial<QuickValues> = {}) => values({ accountId: '', ...over });
  const ctxOf = (store: NameStore, history: (d: string) => Promise<string | null> = async () => null) => ({
    remembered: (text: string) => rememberedCategory(text, store),
    history,
    offered,
    rememberedPaid: (text: string) => rememberedPaid(text, store),
    offeredPaid,
  });

  it('two rows sharing a category link: one pick fills the other, and the next paste fills both', async () => {
    const store = memory();
    const rows = await pastedCategories(
      [
        { cells: linked(FOOD), values: blank() },
        { cells: linked(FOOD, undefined, { description: 'Pasar' }), values: blank({ description: 'Pasar' }) },
      ],
      ctxOf(store),
    );
    expect(rows.map((row) => row.mark)).toEqual([{ text: FOOD }, { text: FOOD }]);
    keepMarks({ d1: rows[0]!.mark, d2: rows[1]!.mark }, new Set(), store);
    expect(unknownLinks(readMarks(store), new Set(['d1', 'd2']), store)).toBe(1);

    // The owner picks Groceries on the first row, which is kept as not recorded.
    const learnt = learnFromSaved('d1', blank({ categoryId: 'groceries' }), false, [{ id: 'd2', values: rows[1]!.values }], store);
    expect(rememberedCategory(FOOD, store)).toBe('groceries');
    expect(learnt.fills).toEqual([{ id: 'd2', values: blank({ description: 'Pasar', categoryId: 'groceries' }) }]);
    expect(learnt.marks.d2).toEqual({ text: FOOD, guessed: { categoryId: 'groceries', how: 'remembered' } });
    expect(learnt.marks.d1).toEqual({ text: FOOD });
    expect(guessHint(learnt.marks.d2)).toBe('Category remembered for this Notion link');
    expect(unknownLinks(learnt.marks, new Set(['d1', 'd2']), store)).toBe(0);

    // A later paste: both rows fill in on their own.
    const next = await pastedCategories([{ cells: linked(FOOD), values: blank() }, { cells: linked(FOOD), values: blank() }], ctxOf(store));
    expect(next.map((row) => row.values.categoryId)).toEqual(['groceries', 'groceries']);
    expect(next[0]!.mark).toEqual({ text: FOOD, guessed: { categoryId: 'groceries', how: 'remembered' } });
  });

  it('an account link works the same way, in its own map', async () => {
    const store = memory();
    const [a, b] = await pastedCategories([{ cells: linked(undefined, CARD), values: blank({ categoryId: 'cafe' }) }, { cells: linked(undefined, CARD), values: blank({ categoryId: 'cafe' }) }], ctxOf(store));
    expect(a!.mark).toEqual({ paid: CARD });
    keepMarks({ p1: a!.mark, p2: b!.mark }, new Set(), store);
    const learnt = learnFromSaved('p1', blank({ categoryId: 'cafe', accountId: 'bonvoy', cardId: 'c2' }), true, [{ id: 'p2', values: b!.values }], store);
    expect(rememberedPaid(CARD, store)).toBe('bonvoy:c2');
    expect(rememberedCategory(CARD, store)).toBeNull();
    expect(learnt.fills).toEqual([{ id: 'p2', values: blank({ categoryId: 'cafe', accountId: 'bonvoy', cardId: 'c2' }) }]);
    expect(learnt.marks).toEqual({ p2: { paid: CARD, paidGuessed: 'bonvoy:c2' } });
    expect(paidHint(learnt.marks.p2)).toBe('Paid with remembered for this Notion link');
    const [later] = await pastedCategories([{ cells: linked(undefined, CARD), values: blank({ categoryId: 'cafe' }) }], ctxOf(store));
    expect(later!.values).toEqual(blank({ categoryId: 'cafe', accountId: 'bonvoy', cardId: 'c2' }));
    // A way to pay no longer offered is not filled in.
    const gone = memory();
    gone.setItem('paste-paid-names', JSON.stringify({ [CARD]: 'closed' }));
    const [stale] = await pastedCategories([{ cells: linked(undefined, CARD), values: blank() }], ctxOf(gone));
    expect(stale!.values.accountId).toBe('');
  });

  it('a comma-separated cell is its own key, apart from either link alone', async () => {
    const store = memory();
    keepMarks({ c1: { text: BOTH } }, new Set(), store);
    learnFromSaved('c1', blank({ categoryId: 'restaurants' }), false, [], store);
    expect(rememberedCategory(BOTH, store)).toBe('restaurants');
    expect(rememberedCategory(FOOD, store)).toBeNull();
  });

  it('the line’s count goes down as links become known', () => {
    const store = memory();
    keepMarks({ r1: { text: FOOD, paid: CARD }, r2: { text: BOTH }, r3: { text: FOOD }, r4: { text: 'Makan' } }, new Set(), store);
    const waiting = new Set(['r1', 'r2', 'r3', 'r4']);
    // Plain names are not links; one link named twice is one.
    expect(unknownLinks(readMarks(store), waiting, store)).toBe(3);
    expect(unknownLinksLine(3)).toBe('3 Notion links to pick');
    learnFromSaved('r1', blank({ categoryId: 'groceries' }), false, [], store);
    expect(unknownLinks(readMarks(store), waiting, store)).toBe(2);
    learnFromSaved('r1', blank({ categoryId: 'groceries', accountId: 'bca' }), false, [], store);
    expect(unknownLinks(readMarks(store), waiting, store)).toBe(1);
    expect(unknownLinksLine(1)).toBe('1 Notion link to pick');
    // A row no longer waiting is not counted.
    expect(unknownLinks(readMarks(store), new Set(['r1', 'r3']), store)).toBe(0);
  });

  it('a link not known yet still takes the place’s history, which teaches nothing until the owner picks', async () => {
    const store = memory();
    const [row] = await pastedCategories([{ cells: linked(FOOD), values: blank() }], ctxOf(store, async () => 'restaurants'));
    expect(row).toEqual({ values: blank({ categoryId: 'restaurants' }), mark: { text: FOOD, guessed: { categoryId: 'restaurants', how: 'history' } } });
    keepMarks({ h1: row!.mark }, new Set(), store);
    // Recorded with the guess as it was: nothing learnt.
    learnFromSaved('h1', row!.values, true, [], store);
    expect(rememberedCategory(FOOD, store)).toBeNull();
    // A remembered link wins over the history.
    store.setItem('paste-category-names', JSON.stringify({ [FOOD]: 'cafe' }));
    const [known] = await pastedCategories([{ cells: linked(FOOD), values: blank() }], ctxOf(store, async () => 'restaurants'));
    expect(known!.values.categoryId).toBe('cafe');
  });

  it('a later pick replaces what was remembered, and moves the rows still holding the old guess — not one the owner set', () => {
    const store = memory();
    store.setItem('paste-category-names', JSON.stringify({ [FOOD]: 'groceries' }));
    keepMarks({ a: { text: FOOD, guessed: { categoryId: 'groceries', how: 'remembered' } }, b: { text: FOOD, guessed: { categoryId: 'groceries', how: 'remembered' } }, c: { text: FOOD } }, new Set(), store);
    const learnt = learnFromSaved('a', blank({ categoryId: 'cafe' }), false, [{ id: 'b', values: blank({ categoryId: 'groceries' }) }, { id: 'c', values: blank({ categoryId: 'restaurants' }) }], store);
    expect(rememberedCategory(FOOD, store)).toBe('cafe');
    expect(learnt.fills).toEqual([{ id: 'b', values: blank({ categoryId: 'cafe' }) }]);
    // Saving a row that still holds the remembered value teaches nothing new and fills nothing.
    expect(learnFromSaved('b', blank({ categoryId: 'cafe' }), false, [], store).fills).toEqual([]);
  });

  it('a Paid with name no way to pay has is remembered after a pick too', async () => {
    const store = memory();
    const [row] = await pastedCategories([{ cells: cells({ paid: 'Kartu Biru' }), values: blank({ categoryId: 'cafe' }) }], ctxOf(store));
    expect(row!.mark).toEqual({ paid: 'Kartu Biru' });
    keepMarks({ n1: row!.mark }, new Set(), store);
    learnFromSaved('n1', blank({ categoryId: 'cafe', accountId: 'bca' }), true, [], store);
    expect(rememberedPaid('kartu biru', store)).toBe('bca');
    expect(paidHint({ paid: 'Kartu Biru', paidGuessed: 'bca' })).toBe('Paid with guessed from an earlier paste of “Kartu Biru”');
  });

  it('a name kept before accents and “&” were folded is still known', () => {
    const store = memory();
    store.setItem('paste-category-names', JSON.stringify({ 'makan & minum': 'restaurants' }));
    expect(rememberedCategory('Makan & Minum', store)).toBe('restaurants');
    store.setItem('paste-category-names', JSON.stringify({ 'makan and minum': 'cafe' }));
    expect(rememberedCategory('Makan & Minum', store)).toBe('cafe');
    expect(rememberedCategory('Makán and Minum', store)).toBe('cafe');
  });
});
