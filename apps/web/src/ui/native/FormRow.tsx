import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cx } from '../index';
import { type FormKind, planFormRow } from './form-row';
import { type GroupChild, toneClass } from './InsetList';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight, TAP } from './metrics';

/**
 * Primitive 6: the form row.
 *
 * Label left, value right. **Never a label stacked above an outlined box, and never a bare `<select>`** — the
 * two shapes almost every form in the app uses today, and the reason a form page costs two lines per field and
 * gives the eye no column to run down.
 *
 * The control inside a row is drawn bare: the group's hairline is already the boundary, and a border inside it
 * would read as a box inside a box. Focus comes back as an outline, since there is no border left to thicken.
 */

const LABEL = 'shrink-0 text-[15px] leading-[20px] text-[var(--ph-ink)]';

function shell(hasSubtitle: boolean) {
  return { minHeight: rowHeight(hasSubtitle), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` } as const;
}

function Separator({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X }} />;
}

/**
 * A row that opens a picker: the answer on the right in the tint, or its prompt in grey, and a chevron saying
 * it reopens. It stays one tap target — the row is the button, and there is nothing else inside it to hit.
 */
export function PickerRow({
  label,
  value,
  placeholder,
  onOpen,
  position,
  hint,
}: GroupChild & {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  onOpen: () => void;
  hint?: ReactNode;
}) {
  const plan = planFormRow('picker', value, placeholder);
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <button type="button" onClick={onOpen} className="ph-focus-inset flex w-full items-center gap-3" style={shell(false)}>
        <span className={LABEL}>{label}</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-[6px]">
          <span className={cx('truncate text-right text-[15px] leading-[20px]', toneClass(plan.tone))}>{plan.text}</span>
          {plan.chevron && (
            <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
              {'›'}
            </span>
          )}
        </span>
      </button>
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
    </div>
  );
}

/**
 * A row typed into in place. No chevron: nothing opens, the caret is already there.
 *
 * 16 px below md, because iOS zooms the whole page when a field smaller than that takes focus — the same floor
 * the app's existing rows keep, for the same reason.
 */
export function TextRow({
  label,
  hint,
  position,
  className,
  ...props
}: GroupChild & { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell(false)}>
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        <input
          {...props}
          id={id}
          className={cx(
            'ph-focus min-w-0 flex-1 rounded bg-transparent text-right text-[16px] leading-[20px] text-[var(--ph-ink)] md:text-[15px]',
            'placeholder:text-[var(--ph-ink-3)]',
            className,
          )}
        />
      </div>
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
    </div>
  );
}

/** A row that shows rather than asks: a computed total, a workspace's name. Quieter ink, and it points nowhere. */
export function ReadOnlyRow({ label, value, position }: GroupChild & { label: string; value: string | null | undefined }) {
  const plan = planFormRow('static', value, '—');
  return (
    <div className="relative" style={{ minHeight: TAP }}>
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell(false)}>
        <span className={LABEL}>{label}</span>
        <span className={cx('tabular min-w-0 flex-1 truncate text-right text-[15px] leading-[20px]', toneClass(plan.tone))}>{plan.text}</span>
      </div>
    </div>
  );
}

/**
 * A destructive action: its own group, one row, centred, in alarm, no icon.
 *
 * Its own group is the point — a "Delete" sharing a group with "Rename" is a row-height away from the wrong tap,
 * and the air between two groups is the only undo a finger gets.
 */
export function DestructiveRow({ label, onClick, position }: GroupChild & { label: string; onClick: () => void }) {
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <button
        type="button"
        onClick={onClick}
        className="ph-focus-inset w-full text-center text-[15px] leading-[20px] text-[var(--ph-alarm)]"
        style={shell(false)}
      >
        {label}
      </button>
    </div>
  );
}

/** The kinds this file draws, named so a caller can see the set is closed. */
export const FORM_KINDS: readonly FormKind[] = ['picker', 'typed', 'static'];
