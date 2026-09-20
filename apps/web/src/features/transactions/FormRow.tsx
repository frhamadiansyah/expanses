import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../ui';

/**
 * One row of a transaction screen: a leading slot, a label, what it says now, and a way in.
 *
 * It is a `<button>` rather than a div with a click handler, so it is reachable by Tab, pressable by Enter and
 * Space, and findable by name — the accessible name is the label, which is how every later spec drives it.
 * 48px tall, with a 34px leading slot so labels line up whether or not a row carries an icon.
 *
 * `name` overrides that accessible name where a one-word label is already the name of something else on screen:
 * a row reading "Workspace" and the sidebar's workspace switcher are two different buttons, and a name they
 * share is a name that names neither.
 */
export function FormRow({
  icon,
  label,
  name,
  value,
  chevron = true,
  onClick,
  disabled = false,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  name?: string;
  value?: ReactNode;
  chevron?: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'muted';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={name ?? label}
      className={cx(
        'flex h-12 w-full items-center gap-2 px-3 text-left text-sm',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900',
        disabled ? 'cursor-not-allowed text-slate-400' : 'text-slate-900 hover:bg-slate-50',
      )}
    >
      <span className="flex w-[34px] shrink-0 items-center justify-center text-slate-500" aria-hidden>
        {icon}
      </span>
      <span className={cx('shrink-0', tone === 'muted' && 'text-slate-500')}>{label}</span>
      <span className="ml-auto truncate text-right text-slate-500">{value}</span>
      {chevron && <ChevronRight size={16} className={cx('shrink-0', disabled ? 'text-slate-300' : 'text-slate-400')} aria-hidden />}
    </button>
  );
}

/**
 * The same row with a switch instead of a chevron — Exclude is the one that toggles rather than opens.
 *
 * `role="switch"` with `aria-checked` is what makes it a switch to a screen reader and to a test; the pill is
 * only paint. Space and Enter both flip it, because it is still a button.
 */
export function SwitchRow({
  icon,
  label,
  checked,
  onChange,
  disabled = false,
  hint,
}: {
  icon?: ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-sm',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900',
        disabled ? 'cursor-not-allowed text-slate-400' : 'text-slate-900 hover:bg-slate-50',
      )}
    >
      <span className="flex w-[34px] shrink-0 items-center justify-center text-slate-500" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={cx('ml-auto flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors', checked ? 'bg-emerald-600' : 'bg-slate-300')}
      >
        <span className={cx('h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </span>
    </button>
  );
}

/** Rows drawn as one grouped list, hairlines between them, the way a phone settings screen looks. */
export function FormRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200', className)}>{children}</div>;
}
