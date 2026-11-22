import { Check } from 'lucide-react';

/**
 * The small ✓ at the corner of a row's leading icon: the same mark the statement gives a paid-off line, and nothing
 * written beside it (owner, 22 Nov 2026). Its words are for a screen reader only. The icon it sits on is `relative`.
 */
export function PastBadge({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="absolute -right-1 -bottom-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[var(--ph-tint)] text-[var(--ph-surface)] ring-2 ring-[var(--ph-surface)]"
    >
      <Check size={9} strokeWidth={3.5} aria-hidden />
    </span>
  );
}
