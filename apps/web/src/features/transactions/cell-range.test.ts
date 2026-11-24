import { describe, expect, it } from 'vitest';
import { type CellColumn, type CellTarget, cellsText, changeLine, extendRange, fillReach, isCellColumn, movePick, rowAtHeight, pasteAssignments, pastedLines, planChange, rangeIds, rangeKey, startRange, stretchPick, togglePick } from './cell-range';

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
    // ⌘Return records the picked cells' rows; Return alone types in the cell (or asks for one choice for several).
    expect(rangeKey(key('Enter', { metaKey: true }), false)).toBe('record');
    expect(rangeKey(key('Enter', { ctrlKey: true }), false)).toBe('record');
    expect(rangeKey(key('Enter', { metaKey: true }), true)).toBeNull();
  });

  it('asks for nothing while typing in a field, nor with ⌥ or ⇧⌘', () => {
    expect(rangeKey(key('Backspace'), true)).toBeNull();
    expect(rangeKey(key('d', { metaKey: true }), true)).toBeNull();
    expect(rangeKey(key('d', { metaKey: true, shiftKey: true }), false)).toBeNull();
    expect(rangeKey(key('Enter', { altKey: true }), false)).toBeNull();
    expect(rangeKey(key('c', { metaKey: true }), false)).toBeNull();
    expect(rangeKey(key('a'), true)).toBeNull();
    expect(rangeKey(key('ArrowDown'), true)).toBeNull();
  });

  it('moves the blue with the arrows (Tab and ⇧Tab as → and ←), stretches it with ⇧↑ ⇧↓, and types with a character', () => {
    expect(rangeKey(key('ArrowUp'), false)).toBe('up');
    expect(rangeKey(key('ArrowDown'), false)).toBe('down');
    expect(rangeKey(key('ArrowLeft'), false)).toBe('left');
    expect(rangeKey(key('ArrowRight'), false)).toBe('right');
    expect(rangeKey(key('Tab'), false)).toBe('right');
    expect(rangeKey(key('Tab', { shiftKey: true }), false)).toBe('left');
    expect(rangeKey(key('ArrowUp', { shiftKey: true }), false)).toBe('more up');
    expect(rangeKey(key('ArrowDown', { shiftKey: true }), false)).toBe('more down');
    expect(rangeKey(key('ArrowLeft', { shiftKey: true }), false)).toBeNull();
    for (const typed of ['a', 'G', '4', '-', 'é']) expect(rangeKey(key(typed), false)).toBe('type');
    expect(rangeKey(key('R', { shiftKey: true }), false)).toBe('type');
    for (const other of [' ', 'Dead', 'F5', 'Shift', 'Meta']) expect(rangeKey(key(other), false)).toBeNull();
  });
});

describe('moving and stretching the blue with the keyboard', () => {
  const COLUMNS: CellColumn[] = ['date', 'description', 'category', 'paid', 'amount'];

  it('moves one cell up or down the rows, from the far end of the blue, and stops at the table’s edge', () => {
    expect(movePick(startRange('category', 'b'), IDS, COLUMNS, 'down')).toEqual(startRange('category', 'c'));
    expect(movePick(startRange('category', 'b'), IDS, COLUMNS, 'up')).toEqual(startRange('category', 'a'));
    expect(movePick(startRange('category', 'a'), IDS, COLUMNS, 'up')).toEqual(startRange('category', 'a'));
    expect(movePick(startRange('category', 'e'), IDS, COLUMNS, 'down')).toEqual(startRange('category', 'e'));
    // Several blue cells: the arrow goes on from the cell last reached, and leaves one.
    expect(movePick({ column: 'amount', anchor: 'b', focus: 'd' }, IDS, COLUMNS, 'down')).toEqual(startRange('amount', 'e'));
    expect(movePick({ column: 'amount', anchor: 'b', focus: 'd' }, IDS, COLUMNS, 'up')).toEqual(startRange('amount', 'c'));
  });

  it('moves across the columns the row shows, in its order, and stops at either end', () => {
    expect(movePick(startRange('category', 'b'), IDS, COLUMNS, 'right')).toEqual(startRange('paid', 'b'));
    expect(movePick(startRange('category', 'b'), IDS, COLUMNS, 'left')).toEqual(startRange('description', 'b'));
    expect(movePick(startRange('date', 'b'), IDS, COLUMNS, 'left')).toEqual(startRange('date', 'b'));
    expect(movePick(startRange('amount', 'b'), IDS, COLUMNS, 'right')).toEqual(startRange('amount', 'b'));
    // A row showing no Paid with (Review with the column hidden) goes from Category straight to Amount.
    expect(movePick(startRange('category', 'b'), IDS, ['description', 'category', 'amount'], 'right')).toEqual(startRange('amount', 'b'));
    expect(movePick({ column: 'date', anchor: 'a', focus: 'c' }, IDS, COLUMNS, 'right')).toEqual(startRange('description', 'c'));
  });

  it('stays put when its row has left the table', () => {
    expect(movePick(startRange('date', 'gone'), IDS, COLUMNS, 'down')).toEqual(startRange('date', 'gone'));
  });

  it('stretches down (or up) one column from the cell first picked, and back again, never past the edge', () => {
    const one = startRange('category', 'b');
    const two = stretchPick(one, IDS, 1);
    expect(two).toEqual({ column: 'category', anchor: 'b', focus: 'c' });
    expect(rangeIds(stretchPick(two, IDS, 1), IDS)).toEqual(['b', 'c', 'd']);
    expect(rangeIds(stretchPick(two, IDS, -1), IDS)).toEqual(['b']);
    expect(rangeIds(stretchPick(stretchPick(one, IDS, -1), IDS, -1), IDS)).toEqual(['a', 'b']);
    expect(stretchPick({ column: 'date', anchor: 'c', focus: 'e' }, IDS, 1)).toEqual({ column: 'date', anchor: 'c', focus: 'e' });
    expect(stretchPick(startRange('date', 'gone'), IDS, 1)).toEqual(startRange('date', 'gone'));
  });

  it('pastes into one blue cell as into several: one value, or the first of several lines', () => {
    expect(pasteAssignments(['c'], pastedLines('Groceries'))).toEqual([{ id: 'c', text: 'Groceries' }]);
    expect(pasteAssignments(['c'], pastedLines('Groceries\nCafe\n'))).toEqual([{ id: 'c', text: 'Groceries' }]);
  });
});

describe('the fill square', () => {
  it('reaches from the row under the blue down to the row under the pointer, down only', () => {
    expect(fillReach(IDS, ['b'], 'd')).toEqual(['c', 'd']);
    expect(fillReach(IDS, ['a', 'b'], 'e')).toEqual(['c', 'd', 'e']);
    expect(fillReach(IDS, ['b'], 'c')).toEqual(['c']);
    // On the blue itself, or above it: nothing to fill.
    expect(fillReach(IDS, ['b', 'c'], 'c')).toEqual([]);
    expect(fillReach(IDS, ['b', 'c'], 'b')).toEqual([]);
    expect(fillReach(IDS, ['c'], 'a')).toEqual([]);
    expect(fillReach(IDS, ['c'], null)).toEqual([]);
    // A row gone from the table reaches nothing.
    expect(fillReach(IDS, ['gone'], 'e')).toEqual([]);
    expect(fillReach(IDS, ['b'], 'gone')).toEqual([]);
    expect(fillReach(IDS, [], 'e')).toEqual([]);
  });

  it('reads the row under the pointer from the cells’ top edges, staying on the last past the end', () => {
    const tops = [
      { id: 'a', top: 100 },
      { id: 'b', top: 140 },
      { id: 'c', top: 180 },
    ];
    expect(rowAtHeight(tops, 99)).toBeNull();
    expect(rowAtHeight(tops, 100)).toBe('a');
    expect(rowAtHeight(tops, 139)).toBe('a');
    expect(rowAtHeight(tops, 150)).toBe('b');
    expect(rowAtHeight(tops, 900)).toBe('c');
    expect(rowAtHeight([], 150)).toBeNull();
  });
});

describe('⌘-click on picked cells', () => {
  it('adds a cell anywhere in the column, next to the others or not, and takes one out again', () => {
    const one = startRange('description', 'b');
    const two = togglePick(one, IDS, 'description', 'd')!;
    expect(rangeIds(two, IDS)).toEqual(['b', 'd']);
    const three = togglePick(two, IDS, 'description', 'a')!;
    expect(rangeIds(three, IDS)).toEqual(['a', 'b', 'd']);
    expect(three.focus).toBe('a');
    expect(rangeIds(togglePick(three, IDS, 'description', 'b'), IDS)).toEqual(['a', 'd']);
    // The last one taken out: nothing is picked.
    expect(togglePick(one, IDS, 'description', 'b')).toBeNull();
  });

  it('starts again in another column, and a row gone from the table drops out', () => {
    const two = togglePick(startRange('description', 'b'), IDS, 'description', 'd')!;
    expect(togglePick(two, IDS, 'category', 'c')).toEqual(startRange('category', 'c'));
    expect(rangeIds(two, ['a', 'd', 'e'])).toEqual(['d']);
  });

  it('is one run again once stretched: from the first picked to the far end, moved', () => {
    const apart = togglePick(startRange('amount', 'a'), IDS, 'amount', 'c')!;
    expect(rangeIds(stretchPick(apart, IDS, 1), IDS)).toEqual(['a', 'b', 'c', 'd']);
    expect(rangeIds(extendRange(apart, 'amount', 'e'), IDS)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
