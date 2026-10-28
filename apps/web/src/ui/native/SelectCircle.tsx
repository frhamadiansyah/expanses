import { Check } from 'lucide-react';
import { cx } from '../index';

/**
 * The select-mode circle: solid ink with a white check once picked, an empty open ring when not. Drawn only; the
 * control it belongs to (a checkbox or the row's button) takes the tap.
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
