import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/**
 * A page that opens one of its own sheets from a link: the Debt-free plan's Pay buttons land on a loan, a card, a
 * bill or a Lend & borrow loan with one search param that opens that page's existing pay sheet. The sheet opens once
 * (a re-render or a refetch never opens it again), and closing it — Save or Cancel — goes back to where Pay was
 * tapped. Without the param the page behaves exactly as it always did.
 */

/** Pure: whether to open now — asked for, the page ready to draw the sheet, and not opened from the link already. */
export function shouldOpen(flag: boolean, ready: boolean, alreadyOpened: boolean): boolean {
  return flag && ready && !alreadyOpened;
}

export function useOpenFromSearch(flag: boolean, open: () => void, ready: boolean): { fromSearch: boolean; done: () => void } {
  const router = useRouter();
  const opened = useRef(false);
  const [fromSearch, setFromSearch] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!shouldOpen(flag, ready, opened.current)) return;
    opened.current = true;
    setFromSearch(true);
    openRef.current();
  }, [flag, ready]);

  const done = () => {
    if (!fromSearch) return;
    setFromSearch(false);
    // The router knows its own steps; a link opened as a fresh page load still has the browser's step before it.
    if (router.history.canGoBack()) router.history.back();
    else if (window.history.length > 1) window.history.back();
  };
  return { fromSearch, done };
}
