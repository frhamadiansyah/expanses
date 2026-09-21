import { useEffect, useReducer } from 'react';

/**
 * A form that fills itself in from data still on its way — the schedule's next instalment, the paying account —
 * and that the person may already be typing into when it lands.
 *
 * The rule, field by field: a suggestion fills a field only the first time a value for it arrives, and only when
 * nobody has touched the field. Touching is focusing as much as typing, because a field that changes under the
 * caret takes the keys that follow as an addition to the new figure: 2007385 then 5000000 posts 20073855000000.
 * Nothing that arrives later, a refetch included, ever refills a field.
 */
export type DraftAction<T> =
  | { type: 'arrive'; suggestion: Partial<T> }
  | { type: 'edit'; patch: Partial<T> }
  | { type: 'touch'; field: keyof T };

export interface DraftState<T> {
  /** The first value that arrived for each field; later ones are ignored. */
  suggested: Partial<T>;
  /** Fields the person has touched, with what they hold. These always win. */
  edited: Partial<T>;
}

export const emptyDraft = <T,>(): DraftState<T> => ({ suggested: {}, edited: {} });

export function suggestedDraftReducer<T>(state: DraftState<T>, action: DraftAction<T>): DraftState<T> {
  switch (action.type) {
    case 'arrive': {
      const fresh = (Object.keys(action.suggestion) as (keyof T)[]).filter(
        (field) => action.suggestion[field] !== undefined && !(field in state.suggested),
      );
      // Nothing new returns the same state, so React skips the render and an effect can dispatch this freely.
      if (fresh.length === 0) return state;
      const suggested = { ...state.suggested };
      for (const field of fresh) suggested[field] = action.suggestion[field];
      return { ...state, suggested };
    }
    case 'edit':
      return { ...state, edited: { ...state.edited, ...action.patch } };
    case 'touch': {
      if (action.field in state.edited) return state;
      // Pinned at whatever it shows now, so a suggestion landing after the focus cannot change it.
      return { ...state, edited: { ...state.edited, [action.field]: state.suggested[action.field] } };
    }
  }
}

/** What the form shows: typed over suggested over the blank form. */
export function draftValue<T>(state: DraftState<T>, fallback: T): T {
  const value = { ...fallback };
  for (const field of Object.keys(state.suggested) as (keyof T)[]) {
    if (state.suggested[field] !== undefined) value[field] = state.suggested[field] as T[keyof T];
  }
  // A field touched before anything arrived is pinned at the blank form's value, not left open to the suggestion.
  for (const field of Object.keys(state.edited) as (keyof T)[]) {
    value[field] = state.edited[field] === undefined ? fallback[field] : (state.edited[field] as T[keyof T]);
  }
  return value;
}

/**
 * The hook over the reducer. `suggestion` holds only the fields whose data has arrived (leave the rest out, or
 * undefined); `fallback` is what a field shows before its suggestion lands.
 */
export function useSuggestedDraft<T extends object>(fallback: T, suggestion: Partial<T>) {
  const [state, dispatch] = useReducer(suggestedDraftReducer<T>, undefined, emptyDraft<T>);
  // Keyed on the values, not the object, which is new on every render.
  const key = JSON.stringify(suggestion);
  useEffect(() => dispatch({ type: 'arrive', suggestion }), [key]);
  return {
    value: draftValue(state, fallback),
    set: (patch: Partial<T>) => dispatch({ type: 'edit', patch }),
    /** Spread onto a field: `onFocus={touch('principal')}`. */
    touch: (field: keyof T) => () => dispatch({ type: 'touch', field }),
  };
}
