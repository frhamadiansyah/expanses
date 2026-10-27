import { Info, Search } from 'lucide-react';
import { Children, isValidElement, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId, useState } from 'react';
import { cx } from '../index';
import { currencyMatches, type FormKind, planFormRow, planSwitchRow } from './form-row';
import { KeyboardStrip } from './KeyboardStrip';
import { type GroupChild, toneClass, RowIcon } from './InsetList';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight, TAP } from './metrics';
import type { Tone } from './row';
/**
 * Primitive 6: the form row.
 *
 * Label left, value right. **Never a label stacked above an outlined box, and never a bare `<select>`** — the
 * two shapes almost every form in the app uses today, and the reason a form page costs two lines per field and
 * gives the eye no column to run down.
 *
 * The control inside a row is drawn bare: the group's hairline is already the boundary, and a border inside it
 * would read as a box inside a box. Focus comes back as an outline, since there is no border left to thicken.
 */

const LABEL = 'shrink-0 text-[17px] leading-[22px] md:text-[15px] md:leading-[20px] text-[var(--ph-ink)]';

/** The inputs WebKit draws with a height of their own. */
const DATE_TYPES = new Set(['date', 'time', 'datetime-local', 'month']);

/** The switch's capsule, iOS's own size: 51 × 31, with a 27 px round knob inset 2 px — the shape a thumb knows. */
const SWITCH_W = 51;
const SWITCH_H = 31;
/** The knob is the capsule's height less its 2 px of air on each side, so it is a circle and never an ellipse. */
const KNOB = SWITCH_H - 4;
/** How far the knob travels: the capsule less itself, which lands it with the same 2 px of air on the other side. */
const KNOB_TRAVEL = SWITCH_W - SWITCH_H;

function shell(hasSubtitle: boolean) {
  return { minHeight: rowHeight(hasSubtitle), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` } as const;
}

/** The hairline above a row: inset at both ends to the row's own padding, level with the text and clear of the corner. */
function Separator({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />;
}

/**
 * A row that opens a picker: the answer on the right, or its prompt in grey, and a chevron saying it reopens.
 * It stays one tap target — the row is the button, and there is nothing else inside it to hit.
 */
export function PickerRow({
  label,
  value,
  placeholder,
  onOpen,
  position,
  hint,
  disabled = false,
  detail,
  detailTone,
  info,
  testId,
}: GroupChild & {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  /**
   * What the row means, behind an ⓘ beside the label and under the row only when asked for — as TextRow's `info`. The row is
   * one button, which cannot hold another, so with an ⓘ the button is laid over the whole row and the label, answer and ⓘ are
   * drawn above it: a tap anywhere but the ⓘ falls through to the button.
   */
  info?: ReactNode;
  /** What a test names the row by; on the row's wrapper, so a click lands on the button and the text includes the answer. */
  testId?: string;
  onOpen: () => void;
  hint?: ReactNode;
  /** Greyed and inert: the answer still reads, but nothing opens — a code while the thing is kept off the report. */
  disabled?: boolean;
  /** A second, smaller line under the answer, in the quiet ink: what a code stands for. Only drawn under an answer. */
  detail?: ReactNode;
  /** The detail's ink, when it warns rather than explains. */
  detailTone?: Tone;
}) {
  const plan = planFormRow('picker', value, placeholder);
  const answer = <span className={cx('truncate text-right text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]', toneClass(plan.tone))}>{plan.text}</span>;
  const twoLines = Boolean(detail) && !plan.placeholder;
  const [explained, setExplained] = useState(false);
  const right = (
    <span className="flex min-w-0 flex-1 items-center justify-end gap-[6px]">
      {twoLines ? (
        <span className="flex min-w-0 flex-col items-end">
          {answer}
          <span className={cx('mt-[2px] max-w-full truncate text-right text-[12.5px] leading-[16px]', toneClass(detailTone ?? 'ink-3'))}>{detail}</span>
        </span>
      ) : (
        answer
      )}
      {plan.chevron && (
        <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
          {'›'}
        </span>
      )}
    </span>
  );
  return (
    <div className="relative" data-testid={testId}>
      <Separator show={Boolean(position?.separator)} />
      {info ? (
        <div className="relative">
          <button
            type="button"
            onClick={onOpen}
            disabled={disabled}
            aria-label={plan.placeholder ? label : `${label}, ${plan.text}`}
            className="ph-focus-inset absolute inset-0 h-full w-full disabled:opacity-40"
          />
          <div className={cx('pointer-events-none relative flex w-full items-center gap-3', disabled && 'opacity-40')} style={shell(twoLines)}>
            <span className="flex shrink-0 items-center gap-[6px]">
              <span className={LABEL}>{label}</span>
              <span className="pointer-events-auto relative z-10">
                <InfoToggle label={label} explained={explained} onToggle={() => setExplained((was) => !was)} />
              </span>
            </span>
            {right}
          </div>
        </div>
      ) : (
        <button type="button" onClick={onOpen} disabled={disabled} className="ph-focus-inset flex w-full items-center gap-3 disabled:opacity-40" style={shell(twoLines)}>
          <span className={LABEL}>{label}</span>
          {right}
        </button>
      )}
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
      {info && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}

/**
 * A row typed into in place. No chevron: nothing opens, the caret is already there.
 *
 * 16 px below md, because iOS zooms the whole page when a field smaller than that takes focus — the same floor
 * the app's existing rows keep, for the same reason.
 */
export function TextRow({
  label,
  hint,
  info,
  middle,
  suffix,
  prefix,
  position,
  className,
  ...props
}: GroupChild & {
  label: string;
  /** The unit after the figure, in the figure's ink, once one is typed: "g" for grams. */
  suffix?: string;
  /** The currency before the figure, at the right with it, always shown: "IDR" in front of 450.000, so the label stays "Amount". */
  prefix?: string;
  /** Something between the label and the field, on the same line — a foreign balance's "@ rate". */
  middle?: ReactNode;
  /** A line always shown under the row: something the reader needs every time, such as what the row just decided. */
  hint?: ReactNode;
  /**
   * An explanation behind an ⓘ beside the label, shown under the row only when asked for. For what a reader needs
   * once and then not again — "you are warned three weeks before" — so a form does not read as a page of fine print.
   * The same ⓘ the transaction form's Exclude row carries.
   */
  info?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell(false)}>
        {info ? (
          <span className="flex shrink-0 items-center gap-[6px]">
            <label htmlFor={id} className={LABEL}>
              {label}
            </label>
            <InfoToggle label={label} explained={explained} onToggle={() => setExplained((was) => !was)} />
          </span>
        ) : (
          <label htmlFor={id} className={LABEL}>
            {label}
          </label>
        )}
        {middle}
        {prefix ? (
          // The figure sits right beside its currency: the field is as wide as the figure it holds (a hidden copy of the
          // text sizes it), so "IDR" and the number read as one amount at the right of the row.
          <span className="ml-auto flex min-w-0 items-baseline gap-[6px]">
            <span aria-hidden className="shrink-0 text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">
              {prefix}
            </span>
            <span className="relative inline-grid min-w-[3ch]">
              <span aria-hidden className="invisible col-start-1 row-start-1 px-[1px] text-[17px] leading-[22px] whitespace-pre md:text-[15px] md:leading-[20px]">
                {String(props.value ?? '') || String(props.placeholder ?? '') || ' '}
              </span>
              <input
                {...props}
                id={id}
                className={cx(
                  'ph-focus absolute inset-0 w-full min-w-0 rounded bg-transparent text-right text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]',
                  'placeholder:text-[var(--ph-ink-3)]',
                  className,
                )}
              />
            </span>
          </span>
        ) : (
          <input
            {...props}
            id={id}
            className={cx(
              'ph-focus min-w-0 flex-1 rounded bg-transparent text-right text-[17px] leading-[22px] md:leading-[20px] text-[var(--ph-ink)] md:text-[15px]',
              'placeholder:text-[var(--ph-ink-3)]',
              // WebKit draws a date or time input at a height of its own, with a margin inside it, so on iOS every
              // date row stood taller than the rows around it. Held to a text field's 20px, it lines up with them.
              DATE_TYPES.has(props.type ?? '') && 'ph-date-input h-[20px] appearance-none',
              className,
            )}
          />
        )}
        {suffix && String(props.value ?? '').trim() !== '' && (
          <span aria-hidden className="-ml-[8px] shrink-0 text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
      {info && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}

/**
 * A row whose picker is the platform's own.
 *
 * `PickerRow` is the shape to reach for when a screen has a sheet to open. Where the answer is a `<select>` — which
 * on a phone *is* the system picker, and on a desktop is the control a keyboard already knows — the row is drawn
 * exactly as `PickerRow` draws it (label left, answer right, chevron) and the select is laid bare inside it: no
 * box, no arrow of its own, no second border inside the group's hairline. The forbidden shape is a naked
 * `<select>` sitting on the page under a label, not the platform's list behind a row that looks like a row.
 *
 * The answer is drawn by the row rather than left to the control, and the select is laid invisibly over what it
 * says. WebKit lays a closed `select`'s text out from the left of a box as wide as its **longest option**, and
 * ignores `text-align` on it: "Single" in a Household list whose longest option is "Married, no children" sat a
 * hundred pixels short of the right edge, in the one place a value is supposed to line up with every other.
 */
export function SelectRow({
  label,
  hint,
  info,
  position,
  className,
  children,
  ...props
}: GroupChild & {
  label: string;
  hint?: ReactNode;
  /** What the choice means, behind an ⓘ beside the label rather than a line always under it — as TextRow's `info`. */
  info?: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  const [explained, setExplained] = useState(false);
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  // The same decision `PickerRow` asks: an answer is drawn a shade darker than the prompt still waiting for one.
  const plan = planFormRow('picker', value);
  // A value with no option of its own draws nothing, exactly as a browser draws a select whose value matches nothing.
  const shown = plan.placeholder ? plan.text : (optionLabel(children, value) ?? '');
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell(false)}>
        <span className="flex shrink-0 items-center gap-[6px]">
          <label htmlFor={id} className={LABEL}>
            {label}
          </label>
          {info && <InfoToggle label={label} explained={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        <span
          className={cx(
            'relative flex min-w-0 flex-1 items-center justify-end gap-[6px]',
            /* The select is the only focusable thing here, so the ring is drawn on what the reader can see. */
            'ph-focus-within',
            className,
          )}
        >
          <span aria-hidden className={cx('min-w-0 truncate text-[17px] leading-[22px] md:leading-[20px] md:text-[15px]', toneClass(plan.tone))}>
            {shown}
          </span>
          <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
            {'›'}
          </span>
          <select {...props} id={id} className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0">
            {children}
          </select>
        </span>
      </div>
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
      {info && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}

/**
 * The label the select is showing: the option whose value is the chosen one, inside an `optgroup` or not.
 *
 * Exported because the transaction form's glyph rows draw a select exactly as this row does — bare, under a
 * value the row prints itself — and a second copy of this walk is a second answer to what the select says.
 */
export function optionLabel(children: ReactNode, value: string): string | null {
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    const props = child.props as { value?: unknown; children?: ReactNode };
    // An option's text in pieces ({name}{' · held 5'}) reads as one, never as the array's "name,".
    if (child.type === 'option' && String(props.value ?? '') === value) return Children.toArray(props.children).map(String).join('');
    if (child.type === 'optgroup') {
      const inside = optionLabel(props.children, value);
      if (inside !== null) return inside;
    }
  }
  return null;
}

/** A row that shows rather than asks: a computed total, a workspace's name. Quieter ink, and it points nowhere. */
export function ReadOnlyRow({
  label,
  value,
  tone,
  info,
  testId,
  position,
}: GroupChild & {
  label: string;
  value: string | null | undefined;
  /** What a test names the row by. */
  testId?: string;
  /** The figure's ink when the quiet one would mislead: a gain in the tint, a loss in alarm. */
  tone?: Tone;
  /** What the figure is, behind an ⓘ beside the label and under the row only when asked for — as TextRow's `info`. */
  info?: ReactNode;
}) {
  const plan = planFormRow('static', value, '—');
  // The figure is named by its label, as a field is, so a screen reader (and a test) finds "Total" and hears its value.
  const id = useId();
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative" style={{ minHeight: TAP }} data-testid={testId}>
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell(false)}>
        <span className="flex shrink-0 items-center gap-[6px]">
          <span id={id} className={LABEL}>
            {label}
          </span>
          {info && <InfoToggle label={label} explained={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        <span aria-labelledby={id} className={cx('tabular min-w-0 flex-1 truncate text-right text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]', toneClass(plan.placeholder ? plan.tone : (tone ?? plan.tone)))}>
          {plan.text}
        </span>
      </div>
      {info && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}

/**
 * The ⓘ beside a label: the one button every row with an `info` carries, 18 px round in the quiet ink, saying whether
 * its explanation is open. The row keeps the state and draws the explanation; this only asks.
 */
export function InfoToggle({ label, explained, onToggle }: { label: string; explained: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`About ${label}`}
      aria-expanded={explained}
      onClick={onToggle}
      className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
    >
      <Info size={16} aria-hidden />
    </button>
  );
}

/**
 * A destructive action: its own group, one row, centred, in alarm, no icon.
 *
 * Its own group is the point — a "Delete" sharing a group with "Rename" is a row-height away from the wrong tap,
 * and the air between two groups is the only undo a finger gets.
 */
export function DestructiveRow({
  label,
  onClick,
  position,
  muted = false,
  calm = false,
  disabled = false,
  testId,
}: GroupChild & {
  label: string;
  onClick: () => void;
  /** Cannot be pressed at all (the button is disabled), drawn grey: a confirmation that waits for something typed. */
  disabled?: boolean;
  testId?: string;
  /** Drawn in the ordinary ink, not the alarm's: a way out that loses nothing, such as Archive. */
  calm?: boolean;
  /** Not available yet: drawn grey, and still pressed, so the press can say why rather than a line always under it. */
  muted?: boolean;
}) {
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <button
        type="button"
        disabled={disabled}
        data-testid={testId}
        onClick={onClick}
        className={cx('ph-focus-inset w-full text-center text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]', muted || disabled ? 'text-[var(--ph-ink-3)]' : calm ? 'text-[var(--ph-ink)]' : 'text-[var(--ph-alarm)]')}
        style={shell(false)}
      >
        {label}
      </button>
    </div>
  );
}

/**
 * A yes-or-no row: the question on the left, the pill that answers it on the right.
 *
 * The kit's other form rows put a word, a field or a picker on the right; this one puts the control itself, and
 * the control is the shape iOS draws a switch in — a capsule with a knob, tinted when on — never a box with a
 * tick in it, which is a checklist and says “choose me” rather than “this is on”.
 *
 * The checkbox is still the real control, laid invisibly over the whole pill exactly as `SelectRow` lays its select
 * over the word it shows: the label still toggles it, a keyboard still reaches it, and a reader still hears a
 * checked or unchecked box. What is drawn is the pill.
 */
export function SwitchRow({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
  info,
  icon,
  position,
  testId,
}: GroupChild & {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** What a test names the switch by. */
  testId?: string;
  hint?: ReactNode;
  /** What the switch means, behind an ⓘ beside the label rather than a line always under it — as TextRow's `info`. */
  info?: ReactNode;
  /** The round icon every row of a group with icons carries, so a switch among them does not stand out bare. */
  icon?: ReactNode;
}) {
  const id = useId();
  const [explained, setExplained] = useState(false);
  const plan = planSwitchRow({ checked, hint: hint !== undefined && hint !== null && hint !== false, disabled });
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      {/* The pill is the row's content, and 31 px of it inside the row's 44 leaves less air above and below than
          a line of text would: the padding is what keeps a switch row the height of every other row. */}
      <div className="flex items-center gap-3" style={{ minHeight: plan.minHeight, padding: `${(TAP - SWITCH_H) / 2}px ${ROW_PAD_X}px` }}>
        {icon && <RowIcon>{icon}</RowIcon>}
        <span className="flex min-w-0 flex-1 items-center gap-[6px]">
          <label htmlFor={id} className={cx('min-w-0 text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]', toneClass(plan.labelTone))}>
            {label}
          </label>
          {info && <InfoToggle label={label} explained={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        <span
          className={cx(
            'ph-focus-within relative shrink-0 rounded-full transition-colors',
            checked ? 'bg-[var(--ph-switch-on)]' : 'bg-[var(--ph-track)]',
            disabled && 'opacity-40',
          )}
          style={{ height: SWITCH_H, width: SWITCH_W }}
        >
          <span
            aria-hidden
            className="absolute top-[2px] left-[2px] rounded-full bg-[var(--ph-knob)] shadow-[0_2px_5px_rgba(0,0,0,0.18)] transition-transform"
            style={{ height: KNOB, width: KNOB, transform: checked ? `translateX(${KNOB_TRAVEL}px)` : undefined }}
          />
          <input
            id={id}
            type="checkbox"
            data-testid={testId}
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-default"
          />
        </span>
      </div>
      {plan.hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
      {info && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}

/**
 * A form's primary action as a row: centred, in ink, the row's height, and a real submit button. Drawn in a group of its own, as a Delete is.
 *
 * A real `submit`, not a row that calls the save itself: the browser still checks every `required` field before
 * anything is written, exactly as the dark rectangle it replaces did, and Enter in any field still submits.
 */
export function SubmitRow({ label, disabled = false, position, testId }: GroupChild & { label: string; disabled?: boolean; testId?: string }) {
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <button
        type="submit"
        disabled={disabled}
        data-testid={testId}
        className="ph-focus-inset block w-full text-center text-[17px] leading-[22px] md:text-[15px] md:leading-[20px] font-semibold text-[var(--ph-ink)] disabled:text-[var(--ph-ink-3)]"
        style={shell(false)}
      >
        {label}
      </button>
    </div>
  );
}

/**
 * The search field above a list: the track's grey, a magnifier, no outline. iOS draws it on the page rather than
 * in a group, and at the group's width, so the list below it and the field line up on a wide screen too.
 */
export function SearchField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx('flex w-full items-center gap-[6px] bg-[var(--ph-track)] px-[8px] md:max-w-2xl', className)} style={{ borderRadius: 10, minHeight: 36 }}>
      <Search size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
      <input
        {...props}
        className="ph-focus min-w-0 flex-1 rounded bg-transparent py-[7px] text-[17px] leading-[22px] md:leading-[20px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
      />
    </label>
  );
}

/** The kinds this file draws, named so a caller can see the set is closed. */
export const FORM_KINDS: readonly FormKind[] = ['picker', 'typed', 'static'];

/**
 * A currency typed as its three-letter code — no list of 160 to scroll. The field is only as wide as its code, so
 * the › drawn after it by the caller sits right beside it. A code counts once all three letters are a known one;
 * anything else goes back to the last good code when the field is left. While typing, a phone offers matching
 * currencies over the keyboard and a desktop gets the browser's own list.
 */
export function CurrencyCode({
  label,
  value,
  onChange,
  codes,
  className,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  codes: readonly { code: string; name: string }[];
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-codes`;
  const [typed, setTyped] = useState<string | null>(null);
  const known = (code: string) => codes.some((c) => c.code === code);
  const desktop = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches;
  const offered = typed === null || desktop ? [] : currencyMatches(codes, typed);
  const sized = cx('text-[17px] leading-[22px] md:leading-[20px] tracking-[0.5px] uppercase md:text-[15px]', className);
  return (
    <>
      {/* As wide as the code it shows, so the caller's › sits right after it: an unseen copy sets the width. */}
      <span className="inline-grid shrink-0">
        <span aria-hidden className={cx('invisible col-start-1 row-start-1 whitespace-pre', sized)}>
          {(typed ?? value) || 'IDR'}
        </span>
      <input
        aria-label={label}
        // A desktop gets the browser's own list of codes while typing. A phone gets the strip over the keyboard
        // instead: iOS floats its list in a bubble that lands over the sheet's title, and keeps room for a
        // suggestion button at the field's end that pushes the code off the right edge.
        list={typed !== null && desktop ? listId : undefined}
        value={typed ?? value}
        onFocus={(e) => {
          setTyped(value);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          const next = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
          setTyped(next);
          if (next.length === 3 && known(next)) onChange(next);
        }}
        onBlur={() => setTyped(null)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={3}
        placeholder="IDR"
        size={1}
        className={cx('ph-focus col-start-1 row-start-1 w-full min-w-0 rounded bg-transparent placeholder:text-[var(--ph-ink-3)]', sized)}
      />
      </span>
      <KeyboardStrip
        label="Currencies"
        cells={offered.map((c) => ({
          key: c.code,
          label: `${c.code}, ${c.name}`,
          title: c.code,
          detail: c.name,
          onPick: () => {
            onChange(c.code);
            setTyped(c.code);
          },
        }))}
      />
      <datalist id={listId}>
        {codes.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
