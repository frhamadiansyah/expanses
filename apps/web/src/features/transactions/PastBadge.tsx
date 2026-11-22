import { Check } from 'lucide-react';

/**
 * The small ✓ at the corner of a row's icon, in the statement's paid-off green: the account on that row keeps its
 * balance (owner, 22 Nov 2026 — no words like "before the app" or "was added" on the form). It has no visible words;
 * `label` is what a screen reader hears. Its parent is the 28px glyph, positioned.
 */
export function PastBadge({ label, testId }: { label: string; testId?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId}
      className="absolute -right-1 -bottom-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[var(--ph-up)] text-white ring-2 ring-[var(--ph-surface)]"
    >
      <Check size={9} strokeWidth={3.5} aria-hidden />
    </span>
  );
}

/**
 * `PastBadge` laid over a `FormRow`'s lead icon from outside the row's button, so the button keeps its own name
 * ("From", "To") while the badge is still heard. The row sits in a `relative` wrapper beside it; taps pass through.
 */
export function PastBadgeOverRow({ label, testId }: { label: string; testId?: string }) {
  return (
    <span className="pointer-events-none absolute top-0 bottom-0 left-[10px] flex w-[34px] items-center justify-center">
      <span className="relative h-7 w-7">
        <PastBadge label={label} testId={testId} />
      </span>
    </span>
  );
}
