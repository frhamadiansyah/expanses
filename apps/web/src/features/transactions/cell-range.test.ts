import { describe, expect, it } from 'vitest';
import { type CellTarget, cellsText, changeLine, extendRange, isCellColumn, pasteAssignments, pastedLines, planChange, rangeIds, rangeKey, startRange } from './cell-range';

const IDS = ['a', 'b', 'c', 'd', 'e'];

describe('a range of cells', () => {
  it('runs from the cell clicked to the one ⇧-clicked or dragged to, either way, in the table’s order', () => {
    const range = extendRange(startRange('category', 'b'), 'category', 'd');
    expect(range).toEqual({ column: 'category', anchor: 'b', focus: 'd' });
    expect(rangeIds(range, IDS)).toEqual(['b', 'c', 'd']);
    expect(rangeIds(extendRange(startRange('amount', 'd'), 'amount', 'a'), IDS)).toEqual(['a', 'b', 'c', 'd']);
    expect(rangeIds(startRange('date', 'c'), IDS)).toEqual(['c']);
    expect(rangeIds(null, IDS)).toEqual([]);
  });

  it('starts again in another column rather than reaching across', () => {
    expect(extendRange(extendRange(startRange('category', 'a'), 'category', 'c'), 'paid', 'd')).toEqual({ column: 'paid', anchor: 'd', focus: 'd' });
    expect(extendRange(null, 'paid', 'b')).toEqual({ column: 'paid', anchor: 'b', focus: 'b' });
  });

  it('shrinks to its anchor when the far row has left the table, and goes with its anchor', () => {
    expect(rangeIds({ column: 'date', anchor: 'b', focus: 'gone' }, IDS)).toEqual(['b']);
    expect(rangeIds({ column: 'date', anchor: 'gone', focus: 'c' }, IDS)).toEqual([]);
  });

  it('knows its columns', () => {
    for (const column of ['date', 'description', 'category', 'paid', 'amount']) expect(isCellColumn(column)).toBe(true);
    for (const column of ['counts', '', undefined, null]) expect(isCellColumn(column)).toBe(false);
  });
});

describe('copying and pasting cells', () => {
  it('copies one cell a line, a tab or line break inside one read as a space', () => {
    expect(cellsText(['Groceries', 'Cafe\tand bar', 'Two\nlines '])).toBe('Groceries\nCafe and bar\nTwo lines');
  });

  it('reads a paste as one value a line, the first cell of a line copied with several, the last blank line dropped', () => {
    expect(pastedLines('Groceries\r\nRestaurants\n')).toEqual(['Groceries', 'Restaurants']);
    expect(pastedLines('Groceries\t5521\t12.000\nCafe\t1467')).toEqual(['Groceries', 'Cafe']);
    expect(pastedLines('Groceries')).toEqual(['Groceries']);
    expect(pastedLines('\n\n')).toEqual([]);
    // A blank line among others is a value: it clears its cell.
    expect(pastedLines('Groceries\n\nCafe')).toEqual(['Groceries', '', 'Cafe']);
  });

  it('fills every picked cell with one value, and the picked cells in order with several', () => {
    expect(pasteAssignments(['b', 'c', 'd'], ['Groceries'])).toEqual([
      { id: 'b', text: 'Groceries' },
      { id: 'c', text: 'Groceries' },
      { id: 'd', text: 'Groceries' },
    ]);
    expect(pasteAssignments(['b', 'c', 'd'], ['1', '2'])).toEqual([
      { id: 'b', text: '1' },
      { id: 'c', text: '2' },
    ]);
    expect(pasteAssignments(['b', 'c'], ['1', '2', '3'])).toEqual([
      { id: 'b', text: '1' },
      { id: 'c', text: '2' },
    ]);
    expect(pasteAssignments([], ['1'])).toEqual([]);
  });
});

describe('a change to several cells', () => {
  type V = { categoryId: string };
  const target = (id: string, over: Partial<CellTarget<V>> = {}): CellTarget<V> => ({ id, draft: true, values: { categoryId: '' }, refusal: null, ...over });
  const same = (a: V, b: V) => a.categoryId === b.categoryId;

  it('applies one choice to them all, and leaves a row that already holds it alone', () => {
    const plan = planChange([target('a'), target('b', { values: { categoryId: 'groceries' } }), target('c', { draft: false, values: { categoryId: 'cafe' } })], (v) => ({ ...v, categoryId: 'groceries' }), same);
    expect(plan.changes).toEqual([
      { id: 'a', draft: true, before: { categoryId: '' }, after: { categoryId: 'groceries' } },
      { id: 'c', draft: false, before: { categoryId: 'cafe' }, after: { categoryId: 'groceries' } },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a row that cannot take it, saying why, and one the value does not fit', () => {
    const plan = planChange(
      [target('a'), target('b', { values: null, refusal: 'another workspace' }), target('c', { draft: false, values: null, refusal: 'read only' }), target('d')],
      (v, id) => (id === 'd' ? null : { ...v, categoryId: 'groceries' }),
      same,
    );
    expect(plan.changes.map((c) => c.id)).toEqual(['a']);
    expect(plan.skipped).toEqual([
      { id: 'b', reason: 'another workspace' },
      { id: 'c', reason: 'read only' },
      { id: 'd', reason: 'not read' },
    ]);
  });

  it('clears drafts only: a recorded row keeps its cell', () => {
    const plan = planChange([target('a', { values: { categoryId: 'cafe' } }), target('b', { draft: false, values: { categoryId: 'cafe' } })], (v) => ({ ...v, categoryId: '' }), same, { clearing: true });
    expect(plan.changes.map((c) => c.id)).toEqual(['a']);
    expect(plan.skipped).toEqual([{ id: 'b', reason: 'recorded' }]);
  });

  it('says what changed and what was skipped, and why, in one line', () => {
    expect(changeLine(3, [])).toBe('Changed 3 cells');
    expect(changeLine(1, [])).toBe('Changed 1 cell');
    expect(changeLine(2, [{ reason: 'read only' }, { reason: 'another workspace' }, { reason: 'read only' }])).toBe('Changed 2 cells · 3 skipped: 2 read only, 1 in another workspace');
    expect(changeLine(0, [{ reason: 'recorded' }])).toBe('1 skipped: 1 recorded (Delete clears drafts only)');
  });
});

describe('keys on a range', () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

  it('⌘D fills down, Delete or ⌫ clears, Return picks, Esc lets go', () => {
    expect(rangeKey(key('d', { metaKey: true }), false)).toBe('fill');
    expect(rangeKey(key('D', { ctrlKey: true }), false)).toBe('fill');
    expect(rangeKey(key('Delete'), false)).toBe('clear');
    expect(rangeKey(key('Backspace'), false)).toBe('clear');
    expect(rangeKey(key('Enter'), false)).toBe('pick');
    expect(rangeKey(key('Escape'), false)).toBe('close');
  });

  it('asks for nothing while typing in a field, nor with ⌥ or ⇧⌘', () => {
    expect(rangeKey(key('Backspace'), true)).toBeNull();
    expect(rangeKey(key('d', { metaKey: true }), true)).toBeNull();
    expect(rangeKey(key('d', { metaKey: true, shiftKey: true }), false)).toBeNull();
    expect(rangeKey(key('Enter', { altKey: true }), false)).toBeNull();
    expect(rangeKey(key('c', { metaKey: true }), false)).toBeNull();
    expect(rangeKey(key('a'), false)).toBeNull();
  });
});
