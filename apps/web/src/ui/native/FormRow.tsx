import { Search } from 'lucide-react';
import { Children, isValidElement, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cx } from '../index';
import { type FormKind, planFormRow, planSwitchRow } from './form-row';
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
 * A row that opens a picker: the answer on the right, or its prompt in grey, and a chevron saying it reopens.
 * It stays one tap target — the row is the button, and there is nothing else inside it to hit.
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

/**
 * A row whose picker is the platform's own.
 *
 * `PickerRow` is the shape to reach for when a screen has a sheet to open. Where the answer is a `<select>` — which
 * on a phone *is* the system picker, and on a desktop is the control a keyboard already knows — the row is drawn
 * exactly as `PickerRow` draws it (label left, answer right, chevron) and the select is laid bare inside it: no
 * box, no arrow of its own, no second border inside the group's hairline. The forbidden shape is a naked
 * `<select>` sitting on the page under a label, not the platform's list behind a row that looks like a row.
 *
 * The answer is drawn by the row rather than left to the control, and the select is laid invisibly over what it
 * says. WebKit lays a closed `select`'s text out from the left of a box as wide as its **longest option**, and
 * ignores `text-align` on it: "Single" in a Household list whose longest option is "Married, no children" sat a
 * hundred pixels short of the right edge, in the one place a value is supposed to line up with every other.
 */
export function SelectRow({
  label,
  hint,
  position,
  className,
  children,
  ...props
}: GroupChild & { label: string; hint?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  // The same decision `PickerRow` asks: an answer is drawn a shade darker than the prompt still waiting for one.
  const plan = planFormRow('picker', value);
  // A value with no option of its own draws nothing, exactly as a browser draws a select whose value matches nothing.
  const shown = plan.placeholder ? plan.text : (optionLabel(children, value) ?? '');
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell(false)}>
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        <span
          className={cx(
            'relative flex min-w-0 flex-1 items-center justify-end gap-[6px]',
            /* The select is the only focusable thing here, so the ring is drawn on what the reader can see. */
            'ph-focus-within',
            className,
          )}
        >
          <span aria-hidden className={cx('min-w-0 truncate text-[16px] leading-[20px] md:text-[15px]', toneClass(plan.tone))}>
            {shown}
          </span>
          <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
            {'›'}
          </span>
          <select {...props} id={id} className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0">
            {children}
          </select>
        </span>
      </div>
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
    </div>
  );
}

/** The label the select is showing: the option whose value is the chosen one, inside an `optgroup` or not. */
function optionLabel(children: ReactNode, value: string): string | null {
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    const props = child.props as { value?: unknown; children?: ReactNode };
    if (child.type === 'option' && String(props.value ?? '') === value) return String(props.children ?? '');
    if (child.type === 'optgroup') {
      const inside = optionLabel(props.children, value);
      if (inside !== null) return inside;
    }
  }
  return null;
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

/**
 * A yes-or-no row: the question on the left, the box that answers it on the right.
 *
 * The kit's other form rows put a word, a field or a picker on the right; this one puts the control itself,
 * which is the only shape a checkbox has that is not "a box floating loose on the page beside its sentence" —
 * the shape the kit exists to remove. It lived in `features/networth` because the kit had no toggle and three
 * checkboxes had nowhere to go; being the seventh form row is where it belongs, on the same height, the same
 * separator inset and the same inks as the six above it.
 */
export function SwitchRow({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
  position,
}: GroupChild & { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  const plan = planSwitchRow({ checked, hint: hint !== undefined && hint !== null && hint !== false, disabled });
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={{ minHeight: plan.minHeight, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <label htmlFor={id} className={cx('min-w-0 flex-1 text-[15px] leading-[20px]', toneClass(plan.labelTone))}>
          {label}
        </label>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="ph-focus h-[20px] w-[20px] shrink-0 accent-[var(--ph-tint)]"
        />
      </div>
      {plan.hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
    </div>
  );
}

/**
 * A form's primary action as a row: the tint, the row's height, and a real submit button.
 *
 * A real `submit`, not a row that calls the save itself: the browser still checks every `required` field before
 * anything is written, exactly as the dark rectangle it replaces did, and Enter in any field still submits.
 */
export function SubmitRow({ label, disabled = false, position }: GroupChild & { label: string; disabled?: boolean }) {
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <button
        type="submit"
        disabled={disabled}
        className="ph-focus-inset block w-full text-left text-[15px] leading-[20px] font-semibold text-[var(--ph-tint)] disabled:text-[var(--ph-ink-3)]"
        style={shell(false)}
      >
        {label}
      </button>
    </div>
  );
}

/**
 * The search field above a list: the track's grey, a magnifier, no outline. iOS draws it on the page rather than
 * in a group, and at the group's width, so the list below it and the field line up on a wide screen too.
 */
export function SearchField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx('flex w-full items-center gap-[6px] bg-[var(--ph-track)] px-[8px] md:max-w-2xl', className)} style={{ borderRadius: 10, minHeight: 36 }}>
      <Search size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
      <input
        {...props}
        className="ph-focus min-w-0 flex-1 rounded bg-transparent py-[7px] text-[16px] leading-[20px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
      />
    </label>
  );
}

/** The kinds this file draws, named so a caller can see the set is closed. */
export const FORM_KINDS: readonly FormKind[] = ['picker', 'typed', 'static'];
