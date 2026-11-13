/**
 * Owned together (2026-11-13, mockup D): a small round badge on the lower right of an account's icon, with two people
 * drawn in it. It replaces every "Joint" pill: the row keeps its one line, and the mark says the account is held with
 * the household — the partner sees its rows and can pay from it. Drawn, never an emoji, so it reads the same on every
 * phone; the row says it in words for a screen reader (`OWNED_TOGETHER`).
 */
export const OWNED_TOGETHER = 'owned together';

export function TwoPersonGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      <circle cx="5.6" cy="5" r="2.6" />
      <path d="M0.8 13.6c0-2.8 2.1-4.8 4.8-4.8s4.8 2 4.8 4.8z" />
      <circle cx="11.4" cy="5.6" r="2.1" />
      <path d="M11.4 9.2c2.2 0 3.8 1.7 3.8 4.4h-3.6c0-1.6-.5-3-1.5-4.1.4-.2.8-.3 1.3-.3z" />
    </svg>
  );
}

/** The badge itself, set on an icon whose box is `position: relative`. */
export function TwoPersonMark({ testId = 'owned-together-mark' }: { testId?: string }) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className="pointer-events-none absolute flex items-center justify-center rounded-full bg-[var(--ph-surface)] text-[var(--ph-ink-2)]"
      style={{ right: -5, bottom: -5, width: 16, height: 16, boxShadow: '0 0 0 1px var(--ph-chevron)' }}
    >
      <TwoPersonGlyph />
    </span>
  );
}
