/*
 * How much each Mac page shows (owner, 2026-11-23): `v1` draws the pages as sparse as the v1 screens
 * (docs/mockups/2026-11-21-mac-redesign-sidebar.html); `v2` brings back every part v1 leaves out — the charts, the
 * full tables, the extra boxes — in the same look, laid out as docs/mockups/2026-11-21-mac-redesign-v2.html. The parts
 * themselves are kept in the code either way; this one switch decides whether they are drawn.
 *
 * There is no setting for it. The default is `v1`; an end-to-end test (or a developer) that needs the v2 parts sets
 * `localStorage['cicis.mac-detail'] = 'v2'` before the page loads.
 */
export type MacDetail = 'v1' | 'v2';

export const MAC_DETAIL_DEFAULT: MacDetail = 'v1';

const KEY = 'cicis.mac-detail';

function read(): MacDetail {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'v2' ? 'v2' : MAC_DETAIL_DEFAULT;
  } catch {
    return MAC_DETAIL_DEFAULT;
  }
}

/** Read once, when the app starts: the layout never changes under a page that is open. */
export const MAC_DETAIL: MacDetail = read();

/** Whether the v2 parts are drawn. */
export const macV2 = MAC_DETAIL === 'v2';
