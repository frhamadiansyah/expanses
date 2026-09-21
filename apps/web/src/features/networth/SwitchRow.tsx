import { type ReactNode, useId } from 'react';
import { type GroupChild, ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';

/**
 * A yes-or-no row: the question on the left, the box that answers it on the right.
 *
 * The kit has six form rows and none of them is a toggle, so the three checkboxes on these screens — "I'd rather
 * type what it is worth", "Count loan principal in the emergency fund" — had nowhere in the vocabulary to go.
 * This is not a seventh primitive invented on the sly: it is drawn entirely on the kit's own `ROW_PAD_X/Y`,
 * `rowHeight` and separator, and it is reported as the gap it is. What it replaces is a checkbox floating loose
 * on the page beside its sentence, which is the shape the kit set out to remove.
 */
export function SwitchRow({
  label,
  checked,
  onChange,
  hint,
  position,
}: GroupChild & { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="relative">
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X }} />
      )}
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <label htmlFor={id} className="min-w-0 flex-1 text-[15px] leading-[20px] text-[var(--ph-ink)]">
          {label}
        </label>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="ph-focus h-[20px] w-[20px] shrink-0 accent-[var(--ph-tint)]"
        />
      </div>
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
    </div>
  );
}
