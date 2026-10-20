import { ASSET_FAMILIES } from '@expanses/core';
import type { PickerPlace } from './OwnablePicker';

/** New asset's place in the URL, so Back from a screen it led to (Add a holding) returns to the same list. */
export const addAssetSearch = (search: Record<string, unknown>): PickerPlace => ({
  ...(ASSET_FAMILIES.some((f) => f.id === search.family) ? { family: search.family as PickerPlace['family'] } : {}),
  ...(typeof search.query === 'string' && search.query !== '' ? { query: search.query } : {}),
});
