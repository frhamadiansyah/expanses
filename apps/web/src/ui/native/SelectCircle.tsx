import { Check } from 'lucide-react';
import { cx } from '../index';

/**
 * The select-mode circle: an open ring while not picked, filled with the tint and a check once picked. Decorative — the
 * row or button holding it carries the checkbox role. The bill list, Pay several and Cashflow draw their ticks with this one.
 */
export function SelectCircle({ picked, className }: { picked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex h-[28px] w-[28px] items-center justify-center rounded-full',
        picked ? 'bg-[var(--ph-tint)] text-[var(--ph-surface)]' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset',
        className,
      )}
    >
      {picked && <Check size={16} strokeWidth={2.5} />}
    </span>
  );
}
