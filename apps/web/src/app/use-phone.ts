import { useEffect, useState } from 'react';

/** Tailwind's md, the width the sidebar appears at. Below it, the phone shell takes over. */
const PHONE = '(max-width: 767px)';

/** Whether the app's start page is Overview: on a screen wide enough for the sidebar, not on a phone (held either way). */
export function opensOnOverview(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia(PHONE).matches && !window.matchMedia(SIDEWAYS).matches;
}

/**
 * Whether the shell should draw its phone parts at all.
 *
 * Hiding them with CSS alone leaves them in the page, where a screen reader still finds a second set
 * of navigation and a test still matches their labels. Below md they exist; above it they do not.
 */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(PHONE).matches));
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const onChange = () => setPhone(query.matches);
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/**
 * A phone held sideways: short and wide. Wider than md, so `usePhone` reads it as a wide screen, and the shell asks
 * this as well, so a phone on its side keeps the phone shell rather than growing a sidebar. Only Cashflow does more
 * with it: there it shows the wide-screen table full screen. The pages' own `md:` styling is left as it is.
 * Phone-wide as well (the widest iPhone on its side is 956), so a short desktop or Mac window keeps its sidebar.
 */
export const SIDEWAYS = '(orientation: landscape) and (max-height: 499px) and (max-width: 960px)';

/** Whether a phone is held sideways, read the way `usePhone` reads its own width. */
export function useSideways(): boolean {
  const [sideways, setSideways] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(SIDEWAYS).matches));
  useEffect(() => {
    const query = window.matchMedia(SIDEWAYS);
    const onChange = () => setSideways(query.matches);
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);
  return sideways;
}
