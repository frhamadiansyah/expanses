import { ASSET_FAMILIES } from '@expanses/core';
import type { PickerPlace } from './OwnablePicker';

export interface AddAssetSearch extends PickerPlace {
  /** Opened from Trade's ＋ New investment: once saved, the new holding's page opens, its buy already recorded. */
  from?: 'trade';
}

/** New asset's place in the URL, so Back from a screen it led to (Add a holding) returns to the same list. */
export const addAssetSearch = (search: Record<string, unknown>): AddAssetSearch => ({
  ...(ASSET_FAMILIES.some((f) => f.id === search.family) ? { family: search.family as PickerPlace['family'] } : {}),
  ...(typeof search.query === 'string' && search.query !== '' ? { query: search.query } : {}),
  ...(search.from === 'trade' ? { from: 'trade' as const } : {}),
});
