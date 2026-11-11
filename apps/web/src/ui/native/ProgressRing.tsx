/**
 * A ring that fills as far as `fraction`, with the percent (or a tick, once reached) inside: a card's spend bonus,
 * the Debt-free plan's share repaid. `label` and `testId` name what it measures; the card's words are the default.
 */
export function ProgressRing({
  fraction,
  reached,
  size = 40,
  label,
  testId = 'bonus-ring',
  inner = 4,
  text = 'text-[11px]',
}: {
  fraction: number;
  reached: boolean;
  size?: number;
  label?: string;
  testId?: string;
  /** How thick the ring is, in px. */
  inner?: number;
  /** The percent's type size inside. */
  text?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <span
      role="img"
      aria-label={label ?? (reached ? 'Reached' : `${pct}% of the way`)}
      data-testid={testId}
      className="relative block shrink-0 rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(var(--ph-up) 0 ${pct}%, var(--ph-track) ${pct}% 100%)` }}
    >
      <span className={`absolute flex items-center justify-center rounded-full bg-[var(--ph-surface)] font-semibold text-[var(--ph-ink)] ${text}`} style={{ inset: inner }}>
        {reached ? '✓' : `${pct}%`}
      </span>
    </span>
  );
}
