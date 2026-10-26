import { Check, ChevronRight } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { cx } from '../index';
import { InsetGroup, InsetRow } from './InsetList';
import { type NoticeKind, noticeLook } from './notice-look';

/**
 * The one shape every in-app warning, error and notice takes: a single white tappable row, like a Settings row.
 * A 30 px round icon, a bold one-line title, one short grey line and a chevron. Nothing else sits on the row.
 *
 * Tapping opens a half-height sheet with the full text, the primary action and, where the notice can be put
 * away, a "Not now" row in a group of its own. Amber lives only inside the icon, and nothing here is red.
 */
export function Notice({
  kind,
  title,
  line,
  body,
  detail,
  actions,
  children,
  onDismiss,
  dismissLabel = 'Not now',
  testId,
  className,
}: {
  kind: NoticeKind;
  title: string;
  /** The one short line under the title. */
  line?: string;
  /** A sentence or two for the sheet. */
  body?: ReactNode;
  /** Longer text, behind a Details button in the sheet. */
  detail?: ReactNode;
  /** The sheet's primary action: a `NoticeButton`, or a link drawn with `NOTICE_BUTTON`. */
  actions?: ReactNode;
  /** Anything else for the sheet, such as an error from the action. */
  children?: ReactNode;
  /** Present when the notice can be put away; it is offered as a row in the sheet, never on the notice itself. */
  onDismiss?: () => void;
  dismissLabel?: string;
  testId?: string;
  className?: string;
}) {
  const look = noticeLook(kind);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const icon = (
    <span
      aria-hidden
      className={cx(
        'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[16px] leading-none font-bold',
        look.amber ? 'bg-[#f5a623] text-[#1c1c1e]' : 'bg-[var(--ph-ink)] text-[var(--ph-surface)]',
      )}
    >
      {look.glyph === 'check' ? <Check size={16} strokeWidth={3} /> : look.glyph}
    </span>
  );
  return (
    <div role={look.role} data-testid={testId} data-kind={kind} className={cx('mb-4', className)}>
      <div className="flex min-h-[56px] items-center rounded-[14px] bg-[var(--ph-surface)]">
        <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="flex min-h-[56px] min-w-0 flex-1 items-center gap-[10px] py-[11px] pr-1 pl-3 text-left">
          {icon}
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-[20px] font-semibold text-[var(--ph-ink)]">{title}</span>
            {line != null && <span className="block text-[13px] leading-[17px] text-[var(--ph-ink-2)]">{line}</span>}
          </span>
          {!onDismiss && <ChevronRight size={20} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />}
        </button>
        {onDismiss && (
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="flex h-11 w-11 shrink-0 items-center justify-center">
            <span aria-hidden className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--ph-fill)] text-[15px] text-[var(--ph-ink-2)]">
              ✕
            </span>
          </button>
        )}
      </div>
      {open && (
        <Sheet grouped tall title={title} onClose={() => setOpen(false)}>
          <div className="space-y-3 px-1 pb-2">
            <div className="flex items-start gap-[10px] px-1 pt-1">
              {icon}
              <div className="min-w-0 flex-1 text-[15px] leading-[20px] text-[var(--ph-ink)]">
                <p className="font-semibold">{title}</p>
                {line != null && <p className="text-[13px] leading-[17px] text-[var(--ph-ink-2)]">{line}</p>}
                {body != null && <div className="mt-2">{body}</div>}
              </div>
            </div>
            {actions != null && <div className="flex flex-col [&>*]:w-full">{actions}</div>}
            {children}
            {detail != null && (
              <div className="rounded-[12px] bg-[var(--ph-surface)]">
                <button type="button" aria-expanded={more} onClick={() => setMore((was) => !was)} className="flex min-h-11 w-full items-center justify-between px-3 text-left text-[15px] text-[var(--ph-ink)]">
                  Details
                  <ChevronRight size={18} aria-hidden className={cx('text-[var(--ph-ink-3)]', more && 'rotate-90')} />
                </button>
                {more && <div className="px-3 pb-3 text-[13px] leading-[17px] text-[var(--ph-ink-2)]">{detail}</div>}
              </div>
            )}
            {onDismiss && (
              <InsetGroup>
                <InsetRow
                  title={dismissLabel}
                  action
                  onClick={() => {
                    setOpen(false);
                    onDismiss();
                  }}
                />
              </InsetGroup>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** The primary pill's classes, for the one that is a link rather than a button. */
export const NOTICE_BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[var(--ph-ink)] px-[14px] text-[15px] font-semibold text-[var(--ph-surface)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ph-focus)]';

/** The sheet's primary action: an ink pill, light on a dark page. */
export function NoticeButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx(NOTICE_BUTTON, className)} {...props} />;
}
