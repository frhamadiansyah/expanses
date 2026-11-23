import type { DraftRow } from '@expanses/db';
import type { DeskDraftState } from './review-desk-model';

/*
 * The Mac Review's tiles (v1, owner approved 2026-11-23): Waiting, Ready to record with what the ready rows add up to,
 * and Missing something with what is missing. Each is the queue's own reading (`deskState`), so a tile and the table's
 * ticks agree: a filled tick is a ready row.
 */

export type MissingKey = 'account' | 'category' | 'amount';

export interface MissingTile {
  /** The captures that lack something: an account, a category, or a figure to check. */
  count: number;
  /** What is missing and in how many, in that order, only the ones that are. */
  parts: { key: MissingKey; count: number }[];
}

export function missingTile(states: readonly Pick<DeskDraftState, 'needsAccount' | 'needsCategory' | 'checkAmount'>[]): MissingTile {
  const of = (key: MissingKey) =>
    states.filter((state) => (key === 'account' ? state.needsAccount : key === 'category' ? state.needsCategory : state.checkAmount)).length;
  const keys: MissingKey[] = ['account', 'category', 'amount'];
  return {
    count: states.filter((state) => state.needsAccount || state.needsCategory || state.checkAmount).length,
    parts: keys.map((key) => ({ key, count: of(key) })).filter((part) => part.count > 0),
  };
}

/**
 * What the ready rows add up to: their figures as the table shows them (money in or out alike, without a sign), when
 * they are all in one currency. Null with none ready, or with several currencies, which make no one figure.
 */
export function readyTotal(drafts: readonly Pick<DraftRow, 'amountMinor' | 'currency'>[]): { minor: number; currency: string } | null {
  const first = drafts[0];
  if (!first || drafts.some((draft) => draft.currency !== first.currency)) return null;
  return { minor: drafts.reduce((sum, draft) => sum + Math.abs(draft.amountMinor), 0), currency: first.currency };
}
