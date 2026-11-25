import { beforeEach, describe, expect, it } from 'vitest';
import { itemOf, noteLocation, resetOpeners, stepsToOpener } from './opened-from';

const at = (pathname: string, index: number) => ({ pathname, state: { __TSR_index: index } });

/** Walks locations in order, as the router resolves them. */
function walk(...steps: Array<[string, number]>) {
  let last: ReturnType<typeof at> | null = null;
  for (const [pathname, index] of steps) {
    const to = at(pathname, index);
    noteLocation(to, last);
    last = to;
  }
}

beforeEach(() => resetOpeners());

describe('itemOf', () => {
  it('reads the item of a card, an account and a joint item, and of the pages under them', () => {
    expect(itemOf('/cards/c1')).toBe('c1');
    expect(itemOf('/cards/c1/statement')).toBe('c1');
    expect(itemOf('/accounts/a1/move')).toBe('a1');
    expect(itemOf('/wallet/joint/j1')).toBe('j1');
  });

  it('reads no item for the static pages that sit where an id would', () => {
    for (const path of ['/cards/merchants', '/cards/points', '/cards/points/p1', '/accounts/new', '/accounts/add', '/wallet', '/wallet/reorder', '/transactions/t1']) {
      expect(itemOf(path)).toBeNull();
    }
  });
});

describe('stepsToOpener', () => {
  it('Wallet, card, statement, its ‹ in the statement’s place: ✕ is two steps back, to Wallet', () => {
    walk(['/wallet', 0], ['/cards/c1', 1], ['/cards/c1/statement', 2], ['/cards/c1', 2]);
    expect(stepsToOpener('c1', 2)).toBe(-2);
  });

  it('a receipt and the Pay screen opened from the statement and left by Back keep the opener', () => {
    walk(['/wallet', 0], ['/cards/c1', 1], ['/cards/c1/statement', 2], ['/transactions/t1', 3], ['/cards/c1/statement', 2],
      ['/transactions/new', 3], ['/cards/c1/statement', 2], ['/cards/c1', 2]);
    expect(stepsToOpener('c1', 2)).toBe(-2);
  });

  it('a card opened from the Debts list goes back to the list', () => {
    walk(['/net-worth/loans', 4], ['/cards/c1', 5], ['/cards/c1/statement', 6], ['/cards/c1', 6]);
    expect(stepsToOpener('c1', 6)).toBe(-2);
  });

  it('a statement opened from elsewhere: the card it goes back to closes onto that page', () => {
    walk(['/transactions', 0], ['/cards/c1/statement', 1], ['/cards/c1', 1]);
    expect(stepsToOpener('c1', 1)).toBe(-1);
  });

  it('a statement opened by its address has no opener, so ✕ goes to Wallet', () => {
    walk(['/cards/c1/statement', 0], ['/cards/c1', 0]);
    expect(stepsToOpener('c1', 0)).toBeNull();
  });

  it('opened again from somewhere else, the newer opener wins', () => {
    walk(['/wallet', 0], ['/cards/c1', 1], ['/wallet', 0], ['/net-worth/loans', 1], ['/cards/c1', 2]);
    expect(stepsToOpener('c1', 2)).toBe(-1);
  });

  it('an opener at or past the place on screen is no way back', () => {
    walk(['/wallet', 0], ['/cards/c1', 1], ['/transactions/t1', 2], ['/cards/c1', 3]);
    expect(stepsToOpener('c1', 3)).toBe(-1);
    expect(stepsToOpener('c1', 2)).toBeNull();
  });
});
