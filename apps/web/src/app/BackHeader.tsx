import { type LinkProps, useNavigate, useRouter } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { cx } from '../ui';

/**
 * The round control a detail screen's header is built from — back, edit, and whatever a screen adds beside them.
 *
 * One string. The receipt, the transaction card's own page and a bill each held their own copy of it, and a
 * fourth screen would have held a fourth: shared, they cannot drift.
 */
export const ROUND =
  'flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ph-corner)] text-[var(--ph-ink)] shadow-[var(--ph-lift)] focus-visible:outline-2 focus-visible:outline-[var(--ph-focus)]';

/**
 * The way back a screen owes its user: where it was opened from, or `fallback` when it was opened cold.
 *
 * A deep link, a reload or a share has nothing behind it in this tab's history, and a back button that does
 * nothing on those is a screen with no way out.
 */
export function useBack(fallback: LinkProps['to']) {
  const navigate = useNavigate();
  const router = useRouter();
  return () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: fallback });
  };
}

/** That way back, as the control every one of those screens draws in its top-left corner. */
export function BackButton({ fallback, className }: { fallback: LinkProps['to']; className?: string }) {
  const back = useBack(fallback);
  return (
    <button type="button" onClick={back} aria-label="Back" className={cx(ROUND, className)}>
      <ChevronLeft size={18} aria-hidden />
    </button>
  );
}
