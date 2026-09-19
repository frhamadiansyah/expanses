import { EventError } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { buyTarget, coverTarget, isNothingLeft } from './buy-item';

/*
 * The one refusal a screen routes rather than prints.
 *
 * `EventDetailPage.record()` posts the payment, tags it, and then asks the item to claim it. When the receipt is
 * already spoken for the repository answers `NOTHING_LEFT`, and the screen must carry the user to "What it covers"
 * with the item in hand instead of showing them a sentence. Everything else it must rethrow, or a real failure —
 * a share out of range, a category that is not a category — would vanish into a navigation.
 *
 * That catch has no e2e: from the UI the payment is *posted in the same breath*, so the receipt it links to is
 * always brand new and always has its whole self left. The repository's own tests reach the error (see
 * `packages/db/test/event-covers.test.ts`, "a tick with nothing left is NOTHING_LEFT"); what is left over is the
 * seam — that the screen recognises exactly that error and no other, and that the place it sends them to is the
 * screen that can settle it, carrying the item and the workspace tab it was being read in.
 */
describe('the refusal the screen can route', () => {
  it('recognises nothing-left, and nothing else', () => {
    expect(isNothingLeft(new EventError('NOTHING_LEFT', 'That payment already answers other items.'))).toBe(true);
    // Real failures, which the catch rethrows: a figure out of range is not a receipt needing splitting.
    expect(isNothingLeft(new EventError('OVER_ALLOCATED', 'Only 500 of this payment is still unaccounted for'))).toBe(false);
    expect(isNothingLeft(new EventError('SHARE_RANGE', 'A share is a figure above nought'))).toBe(false);
    expect(isNothingLeft(new EventError('ITEM_NOT_FOUND', 'That item is not on this event'))).toBe(false);
    // Not by message, and not by anything that merely looks like one: the code on a real EventError, or nothing.
    expect(isNothingLeft(new Error('That payment already answers other items.'))).toBe(false);
    expect(isNothingLeft({ code: 'NOTHING_LEFT', message: 'nothing left' })).toBe(false);
    expect(isNothingLeft(null)).toBe(false);
    expect(isNothingLeft(undefined)).toBe(false);
  });

  it('sends the user to the screen that can settle the receipt, with the item and the tab in hand', () => {
    expect(coverTarget('e1', 't1', { item: 'i1', ws: 'b1' })).toEqual({
      to: '/events/$eventId/plan/link/$transactionId',
      params: { eventId: 'e1', transactionId: 't1' },
      search: { ws: 'b1', item: 'i1' },
    });
    // The whole trip rather than one workspace's share of it: the tab is absent, not the string "undefined".
    expect(coverTarget('e1', 't1', { item: 'i1' })).toMatchObject({ search: { ws: undefined, item: 'i1' } });
    expect(coverTarget('e1', 't1')).toMatchObject({ search: { ws: undefined, item: undefined } });
  });

  it('opens the event’s own card to buy the item, and names the item it is buying', () => {
    expect(buyTarget('e1', 'i1')).toEqual({ to: '/events/$eventId', params: { eventId: 'e1' }, search: { buy: 'i1' } });
  });
});
