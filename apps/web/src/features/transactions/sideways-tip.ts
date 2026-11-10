/**
 * "Turn sideways for the table", on Cashflow: shown the first few visits, and never again once the table has been
 * opened sideways or the tip was closed. Kept on this device only; losing it just shows the tip again.
 */
export interface TipState {
  seen: number;
  done: boolean;
}

const KEY = 'expanses.sideways-tip';
const VISITS = 3;
const FRESH: TipState = { seen: 0, done: false };

export function readTip(): TipState {
  try {
    const kept = localStorage.getItem(KEY);
    if (!kept) return FRESH;
    const parsed = JSON.parse(kept) as Partial<TipState>;
    if (typeof parsed.seen !== 'number' || !Number.isFinite(parsed.seen) || typeof parsed.done !== 'boolean') return FRESH;
    return { seen: parsed.seen, done: parsed.done };
  } catch {
    return FRESH;
  }
}

export function writeTip(state: TipState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows can refuse storage; the tip just shows again next time.
  }
}

export const tipShown = (state: TipState): boolean => !state.done && state.seen < VISITS;
export const afterVisit = (state: TipState): TipState => ({ ...state, seen: state.seen + 1 });
export const afterSideways = (state: TipState): TipState => ({ ...state, done: true });
export const afterDismiss = (state: TipState): TipState => ({ ...state, done: true });
