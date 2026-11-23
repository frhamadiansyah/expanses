import { Link, type LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../ui';

/*
 * The Mac Settings pane's rows (Mac Settings and Tools, A): grouped rounded boxes with a small title above and a grey
 * footnote under, 13px rows, a push button on the right where a row does something. Each row is at most two targets
 * side by side — the row's body (a link) and its button — never one inside the other.
 */

/** A Mac push button, as the desk pages draw theirs. */
export const DESK_BTN =
  'inline-flex h-[28px] shrink-0 items-center gap-1 rounded-full bg-[var(--mk-pill)] px-[12px] text-[13px] font-semibold whitespace-nowrap text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] disabled:pointer-events-none disabled:opacity-40';
/** The one red button, for the second press of a restore. */
export const DESK_BTN_DANGER =
  'inline-flex h-[28px] shrink-0 items-center rounded-full bg-[var(--mk-c-red)] px-[12px] text-[13px] font-semibold whitespace-nowrap text-white disabled:opacity-40';

/** The section's own title at the top of the pane. */
export function PaneTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-[16px] text-[26px] leading-[32px] font-extrabold tracking-[-0.3px] text-[var(--mk-ink)]">{children}</h2>;
}

/** A coloured square with a white glyph: a section's mark, and a row's where the row has one. */
export function DeskIcon({ icon: Icon, tint, size = 24 }: { icon: LucideIcon; tint: string; size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: tint }}>
      <Icon size={Math.round(size * 0.58)} strokeWidth={2} />
    </span>
  );
}

export function DeskGroup({ title, footer, children, testId }: { title?: string; footer?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="mb-[22px]" data-testid={testId}>
      {title && <h3 className="mb-[8px] px-[4px] text-[15px] leading-[19px] font-bold text-[var(--mk-ink-2)]">{title}</h3>}
      <div className="overflow-hidden rounded-[18px] bg-[var(--mk-card)] px-[4px] shadow-[var(--mk-card-shadow)] [&>*+*]:border-t [&>*+*]:border-[var(--mk-line)]">{children}</div>
      {footer && <div className="mt-[7px] px-[4px] text-[12px] leading-[16px] text-[var(--mk-ink-2)]">{footer}</div>}
    </section>
  );
}

const BODY = 'flex min-w-0 flex-1 items-center gap-[10px] text-left';

export interface DeskRowProps {
  /** A coloured square, a workspace's round letter, or nothing. */
  lead?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** What sits at the right: a grey value, a button, a switch. Outside the row's body, so it is a target of its own. */
  right?: ReactNode;
  /** The body opens this page… */
  to?: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  /** …or does this. */
  onClick?: () => void;
  disabled?: boolean;
  /** The body's accessible name, when its words alone do not read as one. */
  label?: string;
  testId?: string;
  bodyTestId?: string;
  /** Grey words, for a row that is a fact rather than a place (archived, waiting). */
  quiet?: boolean;
}

export function DeskRow({ lead, title, subtitle, right, to, params, search, onClick, disabled, label, testId, bodyTestId, quiet }: DeskRowProps) {
  const words = (
    <>
      {lead}
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[14px] leading-[18px] font-semibold', quiet ? 'text-[var(--mk-ink-2)]' : 'text-[var(--mk-ink)]')}>{title}</span>
        {subtitle && <span className="mt-[1px] block truncate text-[12.5px] leading-[16px] text-[var(--mk-ink-2)]">{subtitle}</span>}
      </span>
      {to && !right && (
        <span aria-hidden className="shrink-0 text-[15px] leading-none text-[var(--ph-chevron)]">
          {'›'}
        </span>
      )}
    </>
  );
  const body = to ? (
    <Link to={to} params={params} search={search} aria-label={label} data-testid={bodyTestId} className={cx(BODY, 'rounded-[4px] focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)]')}>
      {words}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} data-testid={bodyTestId} className={cx(BODY, 'rounded-[4px] focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)] disabled:opacity-40')}>
      {words}
    </button>
  ) : (
    <div className={BODY} data-testid={bodyTestId}>
      {words}
    </div>
  );
  return (
    <div className="flex min-h-[50px] items-center gap-[12px] px-[14px] py-[8px]" data-testid={testId}>
      {body}
      {right !== undefined && right !== null && <div className="flex shrink-0 items-center gap-[8px] text-[13px] text-[var(--mk-ink-2)]">{right}</div>}
    </div>
  );
}

/** A Mac switch: a real switch for a screen reader and a keyboard, drawn as the green capsule. */
export function DeskSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors disabled:opacity-40', checked ? 'bg-[var(--ph-up)]' : 'bg-[var(--ph-fill)] ring-1 ring-[var(--ph-hair)] ring-inset')}
    >
      <span aria-hidden className={cx('absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-[left]', checked ? 'left-[16px]' : 'left-[2px]')} />
    </button>
  );
}
