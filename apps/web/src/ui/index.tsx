import { formatMinor } from '@expanses/core';
import { type ButtonHTMLAttributes, cloneElement, type InputHTMLAttributes, type ReactElement, type ReactNode, type Ref, type SelectHTMLAttributes, useId } from 'react';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

// Grouped list rows live next door, but they are part of the same kit: one import for anything that draws a screen.
export { InputRow, Kicker, Row, RowGroup, RowHint, SelectRow } from './rows';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const BUTTON = {
  /* `--ph-ink` as a fill with `--ph-surface` for its text is the app's one inverted shape: dark on light, light on dark. */
  primary: 'bg-[var(--ph-ink)] text-[var(--ph-surface)] hover:bg-[var(--ph-ink-2)]',
  secondary: 'bg-[var(--ph-surface)] text-[var(--ph-ink)] ring-1 ring-[var(--ph-track)] hover:bg-[var(--ph-fill)]',
  danger: 'bg-[var(--ph-surface)] text-[var(--ph-alarm)] ring-1 ring-[var(--ph-alarm)] hover:bg-[var(--ph-alarm-panel)]',
  // Green, for the one button on a screen that settles money: recording a payment.
  success: 'bg-[var(--ph-tint)] text-[var(--ph-surface)] hover:bg-[var(--ph-tint-ink)]',
  ghost: 'text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ph-focus)]',
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
}

// Below md the text is 16px: iOS zooms the whole page when a field smaller than that takes focus.
const FIELD =
  'w-full rounded-lg border border-[var(--ph-track)] bg-[var(--ph-surface)] px-3 py-2 text-base text-[var(--ph-ink)] md:text-sm focus:border-[var(--ph-tint)] focus:outline-none';

/** A text field; `leading` puts a short unit such as a currency code inside the field, before what is typed. */
// The ref is spread onto the input like any other prop, so a screen can put the cursor in a box it owns.
export function Input({ className, leading, ...props }: InputHTMLAttributes<HTMLInputElement> & { leading?: string; ref?: Ref<HTMLInputElement> }) {
  if (!leading) return <input className={cx(FIELD, className)} {...props} />;
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--ph-ink-3)]">
        {leading}
      </span>
      <input className={cx(FIELD, className)} style={{ paddingLeft: `calc(${leading.length}ch + 1.25rem)` }} {...props} />
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(FIELD, className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactElement<{ id?: string }>; className?: string }) {
  const id = useId();
  return (
    <div className={cx('block', className)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--ph-ink-2)]">
        {label}
      </label>
      {cloneElement(children, { id })}
      {hint && <span className="mt-1 block text-xs text-[var(--ph-ink-3)]">{hint}</span>}
    </div>
  );
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('rounded-xl bg-[var(--ph-surface)] p-4 shadow-sm ring-1 ring-[var(--ph-hair)]', className)}>
      {children}
    </section>
  );
}

export function PageHeader({ title, action, controls }: { title: string; action?: ReactNode; controls?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      {/* A phone gives the title room and puts its actions in round buttons beside it, as iOS does. */}
      <h1 className={cx('font-semibold', controls ? 'text-3xl tracking-tight md:text-xl' : 'text-xl')}>{title}</h1>
      {controls && <span className="flex items-center gap-2 md:hidden">{controls}</span>}
      {action && <span className={cx(Boolean(controls) && 'hidden md:flex')}>{action}</span>}
    </div>
  );
}

/** A round button for the phone header: one action, no label, 44px of target. */
export function RoundButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        'flex h-11 w-11 items-center justify-center rounded-full shadow-[var(--ph-lift)]',
        pressed ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-corner)] text-[var(--ph-ink)]',
      )}
    >
      {children}
    </button>
  );
}

export function Money({ minor, currency, className, tone }: { minor: number; currency: string; className?: string; tone?: 'auto' | 'none' }) {
  const color = tone === 'auto' ? (minor < 0 ? 'text-[var(--ph-alarm)]' : minor > 0 ? 'text-[var(--ph-tint)]' : '') : '';
  return <span className={cx('tabular whitespace-nowrap', color, className)}>{formatMinor(minor, currency)}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-[var(--ph-alarm-panel)] px-3 py-2 text-sm text-[var(--ph-alarm-ink)]" role="alert">{errorMessage(error)}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-[var(--ph-ink-3)]">{children}</p>;
}
