import { describe, expect, it } from 'vitest';
import { editInsteadIn, openToEditMessage } from './filing';

const business = { id: 'b2', name: 'Business', kind: 'business' };

describe('a row an account’s history borrowed from another workspace', () => {
  it('cannot be edited where it is shown, and names the workspace to open', () => {
    expect(editInsteadIn(business, 'b1')).toEqual(business);
    expect(openToEditMessage(business)).toBe('Filed in Business — open that workspace to edit it.');
  });

  it('is edited in place when it belongs to the open workspace, or names none', () => {
    expect(editInsteadIn(business, 'b2')).toBeNull();
    // A row with no workspace of its own — a transfer, a card payment — is every workspace's to edit.
    expect(editInsteadIn(null, 'b1')).toBeNull();
    // A database from before workspaces existed has no book at all; nothing there can be in the wrong one.
    expect(editInsteadIn(business, null)).toBeNull();
  });
});
