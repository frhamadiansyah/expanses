import { isoDate } from '@expanses/core';
import { AlignLeft, CalendarDays, ChevronLeft, ChevronRight, Store, Wifi, X } from 'lucide-react';
import { type CSSProperties, useId, useRef } from 'react';
import { cx } from '../../ui';
import { ROW_BODY, RowGlyph, RowLead } from './FormRow';

/*
 * B2's Note and Date rows, as the Add screen draws them — one drawing for every card that records spending, so the
 * workspace card and a shared event's card (shared events §6, R14) are the same screen to learn. They were the
 * workspace card's own closures until a second card needed them; the markup is unchanged.
 */

/** The ‹ › steppers are 28px drawn; their target reaches the 44pt floor around them. */
const TAP_REACH = { '--ph-tap-y': '8px', '--ph-tap-x': '4px' } as CSSProperties;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu, 17 Sep 2026" — how B2's date row reads a day. The empty string for anything that is not a date. */
export function dayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${DAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** A day either side of the date, as the ‹ › buttons step it. */
export function stepDay(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

/** Note is the Description, typed in place, drawn as the row's title with ☰ in the lead. */
export function NoteRow({
  value,
  onChange,
  onFocus,
  onBlur,
  disabled = false,
  channel,
  onChannel,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  /**
   * Online or offline, carried by the note's own glyph when given: ≡ while not set, a wifi sign once online (the globe is the amount's currency), a shop once
   * offline, each tap the next. It used to be a row of its own under Add more details, opening a sheet of two choices.
   */
  channel?: 'online' | 'offline' | null;
  onChannel?: (channel: 'online' | 'offline' | null) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const glyph = channel === 'online' ? <Wifi size={15} /> : channel === 'offline' ? <Store size={15} /> : <AlignLeft size={15} />;
  return (
    <div className="flex items-center gap-[10px] pl-[10px]">
      <RowLead>
        {onChannel ? (
          <button
            type="button"
            aria-label={`Channel: ${channel === 'online' ? 'Online' : channel === 'offline' ? 'Offline' : 'not set'}`}
            title={channel === 'online' ? 'Online' : channel === 'offline' ? 'Offline' : 'Online or offline'}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChannel(channel === null || channel === undefined ? 'online' : channel === 'online' ? 'offline' : null)}
            // The same grey circle whatever it holds: the glyph alone says online, offline or not set.
            className="ph-focus ph-tap flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-2)]"
            style={{ '--ph-tap-y': '8px', '--ph-tap-x': '8px' } as CSSProperties}
          >
            {glyph}
          </button>
        ) : (
          <RowGlyph>{glyph}</RowGlyph>
        )}
      </RowLead>
      <span className={ROW_BODY}>
        <input
          ref={input}
          id={id}
          aria-label="Note"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Note"
          className="ph-focus-inset min-w-0 flex-1 bg-transparent py-1 text-[17px] leading-[22px] md:text-[15px] md:leading-5 text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
        />
        {/* The amount row's own ×: the whole note gone in one tap, and the cursor left in the empty field. */}
        {value !== '' && !disabled && (
          <button
            type="button"
            aria-label="Clear text"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('');
              input.current?.focus();
            }}
            className="ph-focus ph-tap flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-3)]"
            style={{ '--ph-tap-y': '12px', '--ph-tap-x': '12px' } as CSSProperties}
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </span>
    </div>
  );
}

const stepButton = 'ph-focus ph-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink)] disabled:opacity-40';

/**
 * Date is ‹ [the day] ›: the arrows step a day, which is nearly always what a correction is, and the middle is the
 * real date input laid over the day it shows, so it is still labelled Date and still opens the browser's own picker.
 * `disabled` greys the whole row — a shared expense's date is its payer's alone (D8) — rather than hiding it.
 */
export function DateRow({ on, onChange, max, disabled = false }: { on: string; onChange: (iso: string) => void; max?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={cx('flex items-center gap-[10px] pl-[10px]', disabled && 'opacity-40')}>
      <RowLead>
        <RowGlyph>
          <CalendarDays size={15} />
        </RowGlyph>
      </RowLead>
      <span className={cx(ROW_BODY, 'gap-[6px]')}>
        <button type="button" aria-label="A day earlier" disabled={disabled} onClick={() => onChange(stepDay(on, -1))} className={stepButton} style={TAP_REACH}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="relative flex h-7 min-w-0 flex-1 items-center justify-center rounded-lg bg-[var(--ph-fill)] text-[13px] font-medium text-[var(--ph-ink)]">
          <span aria-hidden className="truncate">
            {dayLabel(on)}
          </span>
          <input
            id={id}
            aria-label="Date"
            type="date"
            required
            max={max}
            value={on}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                // A browser that will not show its picker on a click still takes the keyboard.
              }
            }}
            className="ph-focus absolute inset-0 h-full w-full cursor-pointer rounded-lg opacity-0"
          />
        </span>
        <button type="button" aria-label="A day later" disabled={disabled} onClick={() => onChange(stepDay(on, 1))} className={stepButton} style={TAP_REACH}>
          <ChevronRight size={16} aria-hidden />
        </button>
      </span>
    </div>
  );
}
