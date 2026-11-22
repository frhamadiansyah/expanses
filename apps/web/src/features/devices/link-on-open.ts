/**
 * "Link to another device" on the first screen (owner, 22 Nov 2026: a new Mac restored from iCloud was not linked to
 * the iPhone, and linking afterwards replaced what had been restored). That screen draws before the app and its
 * context exist, so it only records the wish here and lets the app open; the app then opens Account › Devices with
 * Link to another device already showing. Kept in memory: it holds for this open only, and a reload after a link
 * starts clean.
 */
let wanted = false;

/** The first screen's choice: open the app on Link to another device. */
export function askLinkOnOpen(): void {
  wanted = true;
}

/** Whether the app was asked to open on Link to another device — read without clearing it, as often as needed. */
export function linkOnOpenWanted(): boolean {
  return wanted;
}

/** The sheet was closed: going back to Devices later shows the page as it always is. */
export function clearLinkOnOpen(): void {
  wanted = false;
}
