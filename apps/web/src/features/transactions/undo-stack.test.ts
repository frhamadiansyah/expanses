import { describe, expect, it } from 'vitest';
import { dropUndo, EMPTY_UNDO, pushUndo, redoStep, type UndoEntry, undoKey, undoStep } from './undo-stack';

const entry = (id: number, again = true): UndoEntry => ({ id, undo: () => undefined, ...(again ? { redo: () => undefined } : {}) });
const ids = (list: readonly UndoEntry[]) => list.map((one) => one.id);

describe('the table’s Undo and Redo', () => {
  it('⌘Z takes the last change, ⇧⌘Z makes it again, in turn', () => {
    let state = pushUndo(pushUndo(EMPTY_UNDO, entry(1)), entry(2));
    const first = undoStep(state)!;
    expect(first.entry.id).toBe(2);
    state = first.state;
    expect(ids(state.done)).toEqual([1]);
    expect(ids(state.undone)).toEqual([2]);
    const second = undoStep(state)!;
    expect(second.entry.id).toBe(1);
    state = second.state;
    expect(ids(state.undone)).toEqual([2, 1]);
    const again = redoStep(state)!;
    expect(again.entry.id).toBe(1);
    expect(ids(again.state.done)).toEqual([1]);
    expect(ids(again.state.undone)).toEqual([2]);
  });

  it('a new change ends what could be made again', () => {
    const state = undoStep(pushUndo(EMPTY_UNDO, entry(1)))!.state;
    expect(ids(pushUndo(state, entry(2)).undone)).toEqual([]);
  });

  it('a change that cannot be made again is put back and leaves nothing for ⇧⌘Z', () => {
    const state = undoStep(pushUndo(EMPTY_UNDO, entry(1, false)))!.state;
    expect(state).toEqual(EMPTY_UNDO);
    expect(redoStep(state)).toBeNull();
  });

  it('has nothing to undo or redo at first, and keeps only the last changes', () => {
    expect(undoStep(EMPTY_UNDO)).toBeNull();
    expect(redoStep(EMPTY_UNDO)).toBeNull();
    let state = EMPTY_UNDO;
    for (let i = 1; i <= 5; i++) state = pushUndo(state, entry(i), 3);
    expect(ids(state.done)).toEqual([3, 4, 5]);
  });

  it('a change put back by its toast leaves the stack', () => {
    const state = pushUndo(pushUndo(EMPTY_UNDO, entry(1)), entry(2));
    expect(ids(dropUndo(state, 2).done)).toEqual([1]);
  });

  it('reads ⌘Z and ⇧⌘Z (Ctrl off a Mac), nothing else', () => {
    const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
    expect(undoKey(key('z', { metaKey: true }))).toBe('undo');
    expect(undoKey(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(undoKey(key('z', { ctrlKey: true }))).toBe('undo');
    expect(undoKey(key('z'))).toBeNull();
    expect(undoKey(key('z', { metaKey: true, altKey: true }))).toBeNull();
    expect(undoKey(key('y', { metaKey: true }))).toBeNull();
  });
});
