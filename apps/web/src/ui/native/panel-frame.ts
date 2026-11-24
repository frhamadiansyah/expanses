import { macV2 } from '../mac-detail';

/*
 * The Mac's floating panel on the right (option C, owner 2026-11-23): one frame for the add and edit forms
 * (`FormPanelHost`) and, in the v1 look, for every side peek (`SidePeek`, owner 2026-11-24:
 * docs/mockups/2026-11-24-mac-transaction-peek.html), so a row's peek and its Edit are the same panel in the same place.
 * Each part of it is said once, here.
 */

/** The panel itself, short of where it hangs from and what it stacks above. */
export const PANEL_FRAME =
  'fixed right-[14px] bottom-[14px] flex w-[410px] max-w-[calc(100vw-28px)] flex-col overflow-hidden rounded-[22px] bg-[var(--mk-panel)] shadow-[var(--mk-panel-shadow)]';

/** Its sides: the title, the rows and the foot all start 22px in. */
export const PANEL_X = 'px-[22px]';

/** The panel's title: large and heavy, beside its round buttons. */
export const PANEL_TITLE = 'min-w-0 flex-1 pt-[2px] text-[22px] leading-[28px] font-extrabold tracking-[-0.2px] break-words text-[var(--mk-ink)]';

/** The grey line under the title. */
export const PANEL_SUBTITLE = 'mt-[2px] text-[13.5px] leading-[18px] text-[var(--mk-ink-2)]';

/** A round grey button beside the title: ✕, and a peek's ⌃ ⌄. */
export const PANEL_ROUND =
  'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--mk-pill)] text-[var(--mk-ink-2)] hover:bg-[var(--mk-pill-hover)] disabled:pointer-events-none disabled:opacity-35';

/** A grey box of rows inside the panel: the forms' groups, the transaction peek's. */
export const PANEL_GROUP = 'rounded-[14px] bg-[var(--mk-panel-card)] px-[14px] py-[2px]';

/**
 * The room a page leaves on its right while a peek is open, so nothing it draws is under the peek: the v1 panel
 * (410px, 14px from the edge), or v2's narrower peek.
 */
export const PEEK_ROOM = macV2 ? 'mr-[322px]' : 'mr-[406px]';

/** The same room, for a page whose peek is the app's own (`useReceiptPeekHost`), kept on the page's whole column. */
export const PEEK_MAIN_ROOM = macV2 ? 'pr-[330px]' : 'pr-[414px]';
