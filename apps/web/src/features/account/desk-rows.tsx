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
  'inline-flex h-[24px] shrink-0 items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)] disabled:pointer-events-none disabled:opacity-40';
/** The one red button, for the second press of a restore. */
export const DESK_BTN_DANGER =
  'inline-flex h-[24px] shrink-0 items-center rounded-[6px] bg-[var(--ph-alarm)] px-[10px] text-[12.5px] font-medium whitespace-nowrap text-white disabled:opacity-40';

/** The section's own title at the top of the pane. */
export function PaneTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-[14px] text-[20px] leading-[26px] font-semibold text-[var(--ph-ink)]">{children}</h2>;
}

/** A coloured square with a white glyph: a section's mark, and a row's where the row has one. */
export function DeskIcon({ icon: Icon, tint, size = 24 }: { icon: LucideIcon; tint: string; size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-[6px] text-white" style={{ width: size, height: size, background: tint }}>
      <Icon size={Math.round(size * 0.58)} strokeWidth={2} />
    </span>
  );
}

export function DeskGroup({ title, footer, children, testId }: { title?: string; footer?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="mb-[20px]" data-testid={testId}>
      {title && <h3 className="mb-[6px] px-[2px] text-[13px] leading-[17px] font-semibold text-[var(--ph-ink)]">{title}</h3>}
      <div className="overflow-hidden rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] [&>*+*]:border-t [&>*+*]:border-[var(--ph-hair)]">{children}</div>
      {footer && <div className="mt-[6px] px-[2px] text-[11.5px] leading-[15px] text-[var(--ph-ink-3)]">{footer}</div>}
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
        <span className={cx('block truncate text-[13px] leading-[17px]', quiet ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>{title}</span>
        {subtitle && <span className="mt-[1px] block truncate text-[11.5px] leading-[15px] text-[var(--ph-ink-3)]">{subtitle}</span>}
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
    <div className="flex min-h-[44px] items-center gap-[10px] px-[14px] py-[7px]" data-testid={testId}>
      {body}
      {right !== undefined && right !== null && <div className="flex shrink-0 items-center gap-[8px] text-[12.5px] text-[var(--ph-ink-3)]">{right}</div>}
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
