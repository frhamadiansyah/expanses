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
  ...rest
}: {
  icon?: ToastIcon;
  text: string;
  detail?: string | undefined;
  action?: ReactNode;
  role?: 'status';
  'aria-live'?: 'polite';
  'data-testid'?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void;
}) {
  const { done, glyph } = toastIconStyle(icon);
  return (
    <div
      role="status"
      {...rest}
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-[10px] rounded-[16px] bg-[var(--ph-surface)] py-[10px] pr-[10px] pl-[14px] shadow-[0_8px_28px_rgba(0,0,0,0.14),0_0_0_0.5px_var(--ph-hair)] md:bottom-6"
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
  onUndo,
  onDone,
}: {
  text: string;
  detail?: string | undefined;
  icon?: ToastIcon;
  testId?: string;
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
      {...(testId ? { 'data-testid': testId } : {})}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      action={
        <button
          type="button"
          onClick={onUndo}
          className="ph-focus ph-tap shrink-0 rounded-full bg-[var(--ph-fill)] px-[12px] py-[5px] text-[14px] leading-[18px] font-semibold text-[var(--ph-ink)]"
          style={{ '--ph-tap-y': `${tapReach(28)}px` } as CSSProperties}
        >
          Undo
        </button>
      }
    />
  );
}
