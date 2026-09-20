import { ChevronRight } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cx } from './index';

/**
 * Grouped rows: a white card, and inside it a stack of lines, each a label on the left and its value on the right.
 *
 * The house form until now stacked a label above its field. That reads well on a wide screen and badly on a phone,
 * where every field costs two lines and the eye has nothing to run down. A grouped list gives one line per field, a
 * column of labels to scan, and a column of values to check — which is why a phone's own settings are built this way.
 *
 * Bills use it first; Add Transaction is meant to use the same rows, so nothing here knows what a bill is. These are
 * shapes, not screens: no data fetching, no validation, no copy of their own.
 *
 * Desktop is not the poor relation. Every row is a real label tied to a real control, so a pointer click on the label
 * focuses the field, Tab walks the group in order, and focus is drawn where it lands. Nothing here needs a finger.
 */

/** 44px of height: the smallest thing a thumb can be asked to hit, and the floor the phone e2e enforces. */
const ROW = 'flex min-h-11 items-center justify-between gap-3 border-t border-slate-100 px-3 first:border-t-0';

/**
 * The control inside a row is drawn bare — no border of its own. The row's hairline is already the boundary; a second
 * one would read as a box inside a box. Focus is given back as an outline, since there is no border left to thicken.
 *
 * 16px below md: iOS zooms the whole page when a field smaller than that takes focus.
 */
const CONTROL = 'min-w-0 rounded-lg bg-transparent py-2 text-right text-base focus-visible:outline-2 focus-visible:outline-slate-900 md:text-sm';

const LABEL = 'shrink-0 text-sm text-slate-900';

/**
 * A row, and under it the sentence that belongs to that one field.
 *
 * `RowHint` explains a whole group and sits below it; a row that needs a line of its own — a To row saying where a
 * fund purchase goes instead — has nowhere to put it. The line goes **under** the row rather than beside the label:
 * beside it, a long sentence and the control share one line's width, and at 390px the control is squeezed to
 * nothing and stops being clickable at all. Drawn as `SwitchRow`'s hint already is, so this adds a place for a
 * sentence rather than a look.
 */
function RowShell({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  if (!hint) return <div className={ROW}>{children}</div>;
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <div className={cx(ROW, 'border-t-0')}>{children}</div>
      <p className="px-3 pb-2 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/** The card a run of rows sits in. Rows draw their own dividers, so it only has to clip the corners. */
export function RowGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('overflow-hidden rounded-xl bg-white ring-1 ring-slate-200', className)}>{children}</div>;
}

/**
 * A row that shows something rather than asks for it: a label, its value, and a chevron when tapping it opens
 * something. With `onClick` it becomes a button — so it answers Enter and Space, not only a tap.
 */
export function Row({
  label,
  value,
  chevron,
  onClick,
  className,
}: {
  label: ReactNode;
  value?: ReactNode;
  /** Show the "opens something" chevron. Implied by `onClick`, since a row that acts should say so. */
  chevron?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const points = chevron ?? Boolean(onClick);
  const body = (
    <>
      <span className={LABEL}>{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-sm text-slate-600">
        <span className="truncate text-right">{value}</span>
        {points && <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-400" />}
      </span>
    </>
  );
  if (!onClick) return <div className={cx(ROW, className)}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(ROW, 'w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900', className)}
    >
      {body}
    </button>
  );
}

/**
 * A row holding a text field. `className` styles the field, as it does on `Input`, because the row itself is the kit's
 * business and the field is the caller's. An `id` passed through is kept, so a caller with its own handle on the field
 * keeps it; otherwise one is made, because a label with nothing to point at is not a label.
 */
export function InputRow({ label, hint, className, ...props }: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  // A date field is drawn by the browser, digits and calendar button together, and ignores text-align. Rather than
  // fight it, it is shrunk to its own width; the row's justify-between then puts it at the right edge like the rest.
  const width = props.type === 'date' ? 'flex-none' : 'flex-1';
  return (
    <RowShell hint={hint}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input {...props} id={id} className={cx(CONTROL, width, 'text-slate-900', className)} />
    </RowShell>
  );
}

/**
 * A row holding a picker. The browser's own arrow is dropped for the chevron the rest of the rows use, so a row that
 * opens a list looks the same whether the list is a native `select` or, later, a sheet. It stays a real `select`:
 * keyboard, type-ahead and the phone's own picker all still work.
 */
export function SelectRow({
  label,
  hint,
  className,
  children,
  ...props
}: { label: string; hint?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <RowShell hint={hint}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <select {...props} id={id} className={cx(CONTROL, 'flex-1 appearance-none text-slate-600 disabled:text-slate-400', className)}>
          {children}
        </select>
        {/* A disabled row opens nothing, so it is not promised a chevron. */}
        {!props.disabled && <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-400" />}
      </span>
    </RowShell>
  );
}

/** The small heading over a group — "When" — naming what the rows below it are about. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('px-1 pt-3 text-[11px] font-semibold tracking-wide text-slate-500 uppercase', className)}>{children}</h2>;
}

/**
 * The sentence under a group. It belongs to the group, not to one row: a row has a single line and no room to explain
 * itself. Give it an `id` and point the row's `aria-describedby` at it when it explains one field in particular.
 */
export function RowHint({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="px-1 text-xs text-slate-500">
      {children}
    </p>
  );
}
