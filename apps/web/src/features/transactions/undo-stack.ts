import { useEffect, useRef, useState } from 'react';

/*
 * The Mac tables' Undo and Redo (owner 2026-11-25): ⌘Z puts back the last change made in the table — cells changed (a
 * paste, a fill, a choice for several, Delete, a find and replace), a waiting row's cell typed in, waiting rows
 * discarded or recorded — and ⇧⌘Z does it again. One stack per table, holding the changes the table already knew how
 * to undo (the Undo on the line under its header, the toasts' Undo), so there is one way back, not two. A change that
 * cannot be done again (recording) is put back by ⌘Z and leaves nothing for ⇧⌘Z.
 */

/** One change: how to put it back, and — when it can be — how to make it again. */
export interface UndoEntry {
  id: number;
  /** The change being saved, put on the stack as it starts: ⌘Z waits for it to land before putting it back. */
  ready?: Promise<unknown>;
  undo: () => Promise<unknown> | unknown;
  redo?: () => Promise<unknown> | unknown;
}

export interface UndoState {
  /** The changes made, oldest first: ⌘Z takes the last. */
  done: readonly UndoEntry[];
  /** The changes put back, oldest first: ⇧⌘Z takes the last. */
  undone: readonly UndoEntry[];
}

export const EMPTY_UNDO: UndoState = { done: [], undone: [] };

/** How many changes the stack keeps: older ones fall off. */
export const UNDO_LIMIT = 50;

/** A new change: on top of the stack; what was put back can no longer be made again. */
export function pushUndo(state: UndoState, entry: UndoEntry, limit = UNDO_LIMIT): UndoState {
  return { done: [...state.done, entry].slice(-limit), undone: [] };
}

/** ⌘Z: the last change, and the stack without it (kept for ⇧⌘Z when it can be made again). Null with nothing to undo. */
export function undoStep(state: UndoState): { entry: UndoEntry; state: UndoState } | null {
  const entry = state.done[state.done.length - 1];
  if (!entry) return null;
  return { entry, state: { done: state.done.slice(0, -1), undone: entry.redo ? [...state.undone, entry] : state.undone } };
}

/** ⇧⌘Z: the last change put back, made again, and on top of the stack once more. Null with nothing to redo. */
export function redoStep(state: UndoState): { entry: UndoEntry; state: UndoState } | null {
  const entry = state.undone[state.undone.length - 1];
  if (!entry) return null;
  return { entry, state: { done: [...state.done, entry], undone: state.undone.slice(0, -1) } };
}

/** A change put back some other way (a toast's own Undo): out of the stack, so ⌘Z does not put it back twice. */
export function dropUndo(state: UndoState, id: number): UndoState {
  return { done: state.done.filter((entry) => entry.id !== id), undone: state.undone.filter((entry) => entry.id !== id) };
}

/** ⌘Z or ⇧⌘Z (Ctrl off a Mac), or neither. */
export function undoKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z') return null;
  return event.shiftKey ? 'redo' : 'undo';
}

/** A table's stack: push a change, ⌘Z, ⇧⌘Z, each in turn. */
export function useUndoStack() {
  const state = useRef<UndoState>(EMPTY_UNDO);
  const next = useRef(1);
  // Presses one after another, each when the one before has landed: ⌘Z ⌘Z puts back two changes, in turn.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [, setVersion] = useState(0);
  const set = (now: UndoState) => {
    state.current = now;
    setVersion((v) => v + 1);
  };
  const run = (step: typeof undoStep, pick: (entry: UndoEntry) => UndoEntry['undo'] | undefined) => {
    const turn = queue.current.then(async () => {
      const taken = step(state.current);
      if (!taken) return false;
      set(taken.state);
      await taken.entry.ready;
      await pick(taken.entry)?.();
      return true;
    });
    queue.current = turn.catch(() => undefined);
    return turn;
  };
  return {
    /** Puts a change on the stack; its id, for the line or toast that offers its own Undo. */
    push: (entry: Omit<UndoEntry, 'id'>): number => {
      const id = next.current++;
      set(pushUndo(state.current, { ...entry, id }));
      return id;
    },
    undo: () => run(undoStep, (entry) => entry.undo),
    redo: () => run(redoStep, (entry) => entry.redo),
    drop: (id: number) => set(dropUndo(state.current, id)),
    /** The id of the change ⌘Z would put back, if any. */
    top: (): number | null => state.current.done[state.current.done.length - 1]?.id ?? null,
  };
}

export type UndoStack = ReturnType<typeof useUndoStack>;

/**
 * ⌘Z and ⇧⌘Z on a table's page: its stack, unless a field is being typed in (the field's own Undo) or a sheet is over
 * the page. The blue cells' hidden box is no field. In the Mac app the Edit menu's Undo reaches the page as the hidden
 * box's own undo rather than as a key, so that is heard too.
 */
export function useUndoKeys(stack: UndoStack, enabled = true) {
  const latest = useRef(stack);
  latest.current = stack;
  useEffect(() => {
    if (!enabled) return;
    let heard = 0;
    const field = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || el.dataset?.cellSink) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
    };
    const covered = () => document.querySelector('[role="dialog"], [role="menu"]') !== null;
    const keys = (event: KeyboardEvent) => {
      const asked = undoKey(event);
      if (!asked || field(event.target) || covered()) return;
      event.preventDefault();
      heard = Date.now();
      void (asked === 'undo' ? latest.current.undo() : latest.current.redo());
    };
    const edit = (event: InputEvent) => {
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
      if (field(event.target) || covered()) return;
      event.preventDefault();
      // The key was heard already: the same press, once.
      if (Date.now() - heard < 250) return;
      void (event.inputType === 'historyUndo' ? latest.current.undo() : latest.current.redo());
    };
    document.addEventListener('keydown', keys);
    document.addEventListener('beforeinput', edit, true);
    return () => {
      document.removeEventListener('keydown', keys);
      document.removeEventListener('beforeinput', edit, true);
    };
  }, [enabled]);
}
