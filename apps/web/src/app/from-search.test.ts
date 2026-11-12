import { describe, expect, it } from 'vitest';
import { billFromSearch, fromSearch, isTransactionDetail, originHref, trackOrigin } from './from-search';

/** A router as `trackOrigin` sees it: a location, and the one event it listens for. */
function fakeRouter(href: string) {
  let listener: (() => void) | null = null;
  const router = {
    state: { location: { pathname: href.split('?')[0]!, href } },
    subscribe: (_event: 'onResolved', fn: () => void) => {
      listener = fn;
    },
  };
  const go = (next: string) => {
    router.state.location = { pathname: next.split('?')[0]!, href: next };
    listener?.();
  };
  return { router, go };
}

describe('where a page was opened from', () => {
  it('keeps Cashflow as the only origin a section knows', () => {
    expect(fromSearch({ from: 'cashflow' })).toEqual({ from: 'cashflow' });
    expect(fromSearch({ from: 'transaction' })).toEqual({});
    expect(fromSearch({})).toEqual({});
  });

  it('a bill also knows a transaction as its origin, and still knows Cashflow exactly as before', () => {
    expect(billFromSearch({ from: 'transaction' })).toEqual({ from: 'transaction' });
    expect(billFromSearch({ from: 'cashflow' })).toEqual({ from: 'cashflow' });
    expect(billFromSearch({ from: 'elsewhere' })).toEqual({});
    expect(billFromSearch({})).toEqual({});
  });

  it('counts the receipt, its edit, its duplicate and its bill pages as a transaction’s own screens', () => {
    expect(isTransactionDetail('/transactions/t1')).toBe(true);
    expect(isTransactionDetail('/transactions/t1/bill')).toBe(true);
    expect(isTransactionDetail('/transactions/t1/bill/b1')).toBe(true);
    expect(isTransactionDetail('/transactions/flow')).toBe(false);
    expect(isTransactionDetail('/bills/b1')).toBe(false);
  });
});

describe('trackOrigin', () => {
  it('remembers the list a receipt was opened from, not the bill the receipt opened', () => {
    const { router, go } = fakeRouter('/cards/c1/statement?month=2026-10');
    trackOrigin(router);
    go('/transactions/t1');
    // Receipt → its bill → back: the bill is the transaction's own step, never where Save or Delete lands.
    go('/bills/b1?from=transaction');
    go('/transactions/t1');
    expect(originHref()).toBe('/cards/c1/statement?month=2026-10');
  });

  it('skips the pages that bill opens onward too, until a page of its own is reached', () => {
    const { router, go } = fakeRouter('/goals/g1');
    trackOrigin(router);
    go('/transactions/t1');
    go('/transactions/t1/bill');
    go('/bills/b1?from=transaction');
    // Open this bill → Edit bill → back → back → the receipt's Delete.
    go('/bills/b1/edit');
    go('/bills/b1/earlier');
    go('/bills/b1/link?month=2026-04');
    go('/bills/b1?from=transaction');
    go('/transactions/t1');
    expect(originHref()).toBe('/goals/g1');
    // Another bill's pages, or any other page, are remembered again — and the onward skip ends there.
    go('/bills/b2/edit');
    expect(originHref()).toBe('/bills/b2/edit');
    go('/bills/b1?from=transaction');
    go('/transactions');
    go('/bills/b1/edit');
    expect(originHref()).toBe('/bills/b1/edit');
  });

  it('still remembers a bill opened on its own, or from Cashflow', () => {
    const { router, go } = fakeRouter('/transactions');
    trackOrigin(router);
    go('/bills/b1');
    go('/transactions/t1');
    expect(originHref()).toBe('/bills/b1');
    go('/bills/b2?from=cashflow');
    go('/transactions/t2');
    expect(originHref()).toBe('/bills/b2?from=cashflow');
  });
});
