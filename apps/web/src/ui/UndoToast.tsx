import { CalendarDays, Check, Info, SkipForward, Tag, Trash2, X } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { tapReach } from './native';

/** What a toast says happened, drawn as the small round icon at its left. */
export type ToastIcon = 'paid' | 'recorded' | 'refund' | 'deleted' | 'discarded' | 'category' | 'event' | 'skipped' | 'info';

/** The green ones are things done; the grey ones are things moved, removed or noted. */
const GLYPHS: Record<ToastIcon, { glyph: ReactNode; done: boolean }> = {
  paid: { glyph: <Check size={15} strokeWidth={3} />, done: true },
  recorded: { glyph: <Check size={15} strokeWidth={3} />, done: true },
  refund: { glyph: <Check size={15} strokeWidth={3} />, done: true },
  deleted: { glyph: <Trash2 size={14} />, done: false },
  discarded: { glyph: <X size={15} strokeWidth={2.5} />, done: false },
  category: { glyph: <Tag size={14} />, done: false },
  event: { glyph: <CalendarDays size={14} />, done: false },
  skipped: { glyph: <SkipForward size={14} />, done: false },
  info: { glyph: <Info size={15} />, done: false },
};

/** The round icon: white tick on green for done, ink glyph on grey for the rest. */
export function toastIconStyle(icon: ToastIcon): { done: boolean; glyph: ReactNode } {
  return GLYPHS[icon];
}

/** The light floating card shared by every toast: icon, text (and a small grey line), and an optional action. */
export function ToastCard({
  icon = 'info',
  text,
  detail,
  action,
  wide = false,
  ...rest
}: {
  icon?: ToastIcon;
  text: string;
  detail?: string | undefined;
  action?: ReactNode;
  /** Wider on a wide screen, for a line that says more (the Mac Cashflow's "Recorded 29 in August and September 2026"). */
  wide?: boolean;
  role?: 'status';
  'aria-live'?: 'polite';
  'data-testid'?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void;
}) {
  const { done, glyph } = toastIconStyle(icon);
  // The tab bar's own pill (owner, 22 Nov 2026, mockup 2026-11-22-undo-toast-shape A): its width, round ends, frosted
  // glass, border and shadow, 8px above it — one family with the bar instead of a card stacked on it.
  return (
    <div
      role="status"
      {...rest}
      className={`fixed inset-x-4 bottom-[calc(81px+env(safe-area-inset-bottom))] z-40 mx-auto flex min-h-[60px] max-w-md ${wide ? 'md:max-w-[640px]' : ''} items-center gap-[10px] rounded-full border border-[var(--ph-hair)] bg-[var(--ph-chrome)] py-[6px] pr-[8px] pl-[16px] shadow-lg shadow-black/10 backdrop-blur-xl md:bottom-6`}
    >
      <span
        data-icon={icon}
        aria-hidden
        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ${done ? 'bg-[var(--ph-up)] text-white' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]'}`}
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] leading-[20px] text-[var(--ph-ink)]">{text}</span>
        {detail && <span className="block truncate text-[12px] leading-[16px] text-[var(--ph-ink-3)]">{detail}</span>}
      </span>
      {action}
    </div>
  );
}

/**
 * A short line saying what was just done, with the way back. It goes by itself after four seconds — but not while the
 * pointer rests on it or focus is inside it, so reaching for Undo never races the timer.
 */
export function UndoToast({
  text,
  detail,
  icon,
  testId,
  extra,
  wide = false,
  onUndo,
  onDone,
}: {
  text: string;
  detail?: string | undefined;
  icon?: ToastIcon;
  testId?: string;
  /** A second way on, before Undo: the Mac Cashflow's Show › to the month a row was recorded in. */
  extra?: ReactNode;
  /** Wider on a wide screen (`ToastCard`'s `wide`). */
  wide?: boolean;
  onUndo: () => void;
  onDone: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(timer);
  }, [text, onDone, paused]);
  return (
    <ToastCard
      {...(icon ? { icon } : {})}
      text={text}
      detail={detail}
      wide={wide}
      {...(testId ? { 'data-testid': testId } : {})}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      action={
        <>
          {extra}
          <button
            type="button"
            onClick={onUndo}
            className="ph-focus ph-tap shrink-0 rounded-full bg-[var(--ph-fill)] px-[12px] py-[5px] text-[14px] leading-[18px] font-semibold text-[var(--ph-ink)]"
            style={{ '--ph-tap-y': `${tapReach(28)}px` } as CSSProperties}
          >
            Undo
          </button>
        </>
      }
    />
  );
}
