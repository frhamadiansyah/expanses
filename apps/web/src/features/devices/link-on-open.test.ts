import { afterEach, describe, expect, it } from 'vitest';
import { askLinkOnOpen, clearLinkOnOpen, linkOnOpenWanted } from './link-on-open';

describe('opening on Link to another device', () => {
  afterEach(clearLinkOnOpen);

  it('is off unless the first screen asked for it', () => {
    expect(linkOnOpenWanted()).toBe(false);
  });

  it('holds through every read until the sheet is closed', () => {
    askLinkOnOpen();
    // Read twice, as a render in StrictMode does: the second read still sees it.
    expect(linkOnOpenWanted()).toBe(true);
    expect(linkOnOpenWanted()).toBe(true);
    clearLinkOnOpen();
    expect(linkOnOpenWanted()).toBe(false);
  });
});
