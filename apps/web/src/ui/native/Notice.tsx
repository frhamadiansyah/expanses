import { Check, ChevronRight } from 'lucide-react';
import { type ButtonHTMLAttributes, createContext, type ReactNode, useContext, useState } from 'react';
import { cx } from '../index';
import { ALERT_ROW, NoticeAlert } from './NoticeAlert';
import { type NoticeKind, noticeLook } from './notice-look';

/**
 * Inside it, a notice is a slim strip rather than a row: the Mac pages put the app's notices under their own title bar
 * (`DeskNotices`, apps/web/src/app/DeskNotices.tsx), one line each across the page. The same press, alert and ✕.
 */
export const NoticeStrip = createContext(false);

/**
 * The one shape every in-app warning, error and notice takes: a single white tappable row, like a Settings row.
 * A 30 px round icon, a bold one-line title, one short grey line and a chevron. Nothing else sits on the row.
 *
 * Tapping opens a centred alert with the text, the primary action and a "Not now" row. Amber lives only inside the icon, and nothing here is red.
 */
export function Notice({
  kind,
  title,
  line,
  body,
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
  /** A sentence or two for the alert. */
  body?: ReactNode;
  /** The alert's primary action: a `NoticeButton`, or a link drawn with `NOTICE_BUTTON`. */
  actions?: ReactNode;
  /** Anything else for the alert, such as an error from the action. */
  children?: ReactNode;
  /** Present when the notice can be put away; it is offered as a row in the alert, never on the notice itself. */
  onDismiss?: () => void;
  dismissLabel?: string;
  testId?: string;
  className?: string;
}) {
  const look = noticeLook(kind);
  const strip = useContext(NoticeStrip);
  const [open, setOpen] = useState(false);
  const alert = open && (
    <NoticeAlert title={title} text={
        <>
          {line != null && <p>{line}</p>}
          {body != null && <div className={line != null ? 'mt-1' : ''}>{body}</div>}
        </>
      } actions={actions} closeLabel={onDismiss ? dismissLabel : 'Close'} onClose={() => setOpen(false)} onDismiss={onDismiss}>
      {children}
    </NoticeAlert>
  );
  if (strip) {
    return (
      <div role={look.role} data-testid={testId} data-kind={kind} className={cx('border-b border-[var(--ph-hair)] bg-[var(--ph-surface)]', className)}>
        <div className="flex h-[34px] items-center gap-[6px] pr-[10px] pl-[18px] text-[12.5px]">
          <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="flex h-full min-w-0 flex-1 items-center gap-[8px] text-left">
            <span
              aria-hidden
              className={cx(
                'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-bold',
                look.amber ? 'bg-[#f5a623] text-[#1c1c1e]' : 'bg-[var(--ph-ink)] text-[var(--ph-surface)]',
              )}
            >
              {look.glyph === 'check' ? <Check size={11} strokeWidth={3} /> : look.glyph}
            </span>
            <span className="shrink-0 font-semibold whitespace-nowrap text-[var(--ph-ink)]">{title}</span>
            {line != null && <span className="min-w-0 truncate text-[var(--ph-ink-3)]">{line}</span>}
            {!onDismiss && <ChevronRight size={14} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />}
          </button>
          {onDismiss && (
            <button type="button" aria-label="Dismiss" onClick={onDismiss} className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
        {alert}
      </div>
    );
  }
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
      {alert}
    </div>
  );
}

/** The alert's primary action row: bold ink. Also the classes for the one that is a link. */
export const NOTICE_BUTTON = cx(ALERT_ROW, 'font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--ph-focus)]');

/** The alert's primary action. */
export function NoticeButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx(NOTICE_BUTTON, className)} {...props} />;
}
