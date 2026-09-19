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

  /*
   * Read as the URL it lands on, rather than as the object it is.
   *
   * Asserting the object back restates the one-line body: `{ to, params, search }` in, the same three out, and a
   * test that cannot tell the difference between a target that works and a target that merely has the right shape.
   * What decides whether a user arrives is the address — every `$name` in the path filled from `params`, everything
   * else appended as search with anything absent left out altogether — so that is what is built here, by a filler
   * that is not the implementation. A param the target forgot throws; a param named differently from its slot
   * throws; a search key renamed lands somewhere the destination is not reading; a `ws` that leaked through as the
   * string "undefined" shows up as `?ws=undefined`. None of those is visible in a shape assertion.
   */
  const href = (target: { to: string; params?: Record<string, string>; search?: Record<string, string | undefined> }) => {
    const path = target.to.replace(/\$(\w+)/g, (_whole, name: string) => {
      const value = target.params?.[name];
      if (value === undefined) throw new Error(`nothing to put in $${name}`);
      return encodeURIComponent(value);
    });
    const query = new URLSearchParams(Object.entries(target.search ?? {}).filter((pair): pair is [string, string] => pair[1] !== undefined)).toString();
    return query ? `${path}?${query}` : path;
  };

  it('sends the user to the screen that can settle the receipt, with the item and the tab in hand', () => {
    expect(href(coverTarget('e1', 't1', { item: 'i1', ws: 'b1' }))).toBe('/events/e1/plan/link/t1?ws=b1&item=i1');
    // The whole trip rather than one workspace's share of it: the tab is absent from the address, not the word
    // "undefined" sitting in it — `?ws=undefined` is a workspace id, and one no book will ever match.
    expect(href(coverTarget('e1', 't1', { item: 'i1' }))).toBe('/events/e1/plan/link/t1?item=i1');
    expect(href(coverTarget('e1', 't1'))).toBe('/events/e1/plan/link/t1');
    // The receipt is a path segment and not a search key: it is what the screen is *of*, and the route says so.
    expect(coverTarget('e1', 't1').params).toMatchObject({ transactionId: 't1' });
  });

  it('opens the event’s own card to buy the item, and names the item it is buying', () => {
    // The item rides in `buy`, which is the one key `EventDetailPage` opens its card from; as `item` it would land
    // on the event with the card shut, and as a path segment it would not be that route at all.
    expect(href(buyTarget('e1', 'i1'))).toBe('/events/e1?buy=i1');
  });

  it('puts ids into the address rather than pasting them into it', () => {
    // Ids are opaque. One carrying a slash or a space would otherwise invent path segments of its own, which is how
    // a link to an item becomes a link to a route nobody wrote.
    expect(href(buyTarget('e/1', 'i 1'))).toBe('/events/e%2F1?buy=i+1');
    expect(href(coverTarget('e 1', 't/1'))).toBe('/events/e%201/plan/link/t%2F1');
  });
});
