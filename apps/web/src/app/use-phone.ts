import { useEffect, useState } from 'react';

/** Tailwind's md, the width the sidebar appears at. Below it, the phone shell takes over. */
const PHONE = '(max-width: 767px)';

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
