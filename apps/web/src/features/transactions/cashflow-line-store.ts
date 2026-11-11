import { useSyncExternalStore } from 'react';

/**
 * The thread between the tab bar's held ＋ and Cashflow's One line field, which live in different parts of the tree.
 *
 * Cashflow registers how to open its field (`registerLineOpener`); the tab bar calls `openCashflowLine` from the
 * finger's release, so the field is focused inside that same gesture and the phone brings its keyboard up. While the
 * field is open the tab bar stands aside (`open`). `flashId` is the row just saved, lit for a moment once the list has it.
 */
export interface LineState {
  open: boolean;
  flashId: string | null;
}

const CLOSED: LineState = { open: false, flashId: null };
let state: LineState = CLOSED;
const listeners = new Set<() => void>();
let opener: (() => void) | null = null;

export function lineState(): LineState {
  return state;
}

export function setLineState(patch: Partial<LineState>): void {
  const next = { ...state, ...patch };
  if (next.open === state.open && next.flashId === state.flashId) return;
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeLine(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useLineState(): LineState {
  return useSyncExternalStore(subscribeLine, lineState, lineState);
}

/** Cashflow's way to open its field; the returned function takes it back, and closes the field with it. */
export function registerLineOpener(open: () => void): () => void {
  opener = open;
  return () => {
    if (opener === open) opener = null;
    setLineState(CLOSED);
  };
}

/** Opens Cashflow's field; false when no Cashflow is on screen to open it. */
export function openCashflowLine(): boolean {
  if (!opener) return false;
  opener();
  return true;
}
