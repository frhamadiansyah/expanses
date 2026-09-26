import { Info } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { cx } from '../../ui';
import { optionLabel } from '../../ui/native';

/**
 * The lead circle a transaction row draws its glyph in: 28px, the kit's fill behind the kit's secondary ink.
 *
 * The approved mockup (Option B) draws an emoji per row; the kit draws a Lucide glyph in a tinted circle, so every
 * glyph here is a Lucide one and every colour a kit token — the same row in the dark as in the light.
 */
export function RowGlyph({ children, tone = 'fill' }: { children: ReactNode; tone?: 'fill' | 'plain' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex h-7 w-7 items-center justify-center rounded-full text-[var(--ph-ink-2)]',
        tone === 'fill' ? 'bg-[var(--ph-fill)]' : 'bg-transparent',
      )}
    >
      {children}
    </span>
  );
}

/** The chevron, as the kit draws it: a glyph on the text's baseline, in the chevron token. */
function Chevron({ faint = false }: { faint?: boolean }) {
  return (
    <span aria-hidden className={cx('shrink-0 text-[17px] leading-none', faint ? 'text-[var(--ph-hair)]' : 'text-[var(--ph-chevron)]')}>
      {'›'}
    </span>
  );
}

/**
 * The part of a row right of its glyph. It carries the hairline, so a separator is inset to the text — never
 * full-bleed — and `FormRows` draws it above every body but the first.
 */
export const ROW_BODY_FLUSH = 'ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]';
export const ROW_BODY = `${ROW_BODY_FLUSH} py-[6px]`;

/**
 * The lead slot, 34px wide, so labels line up whether or not a row carries a glyph. Not hidden itself: the amount
 * row's flag in this slot is a real control, and a glyph that is only paint hides itself (`RowGlyph`).
 */
export function RowLead({ children }: { children?: ReactNode }) {
  return (
    <span className="flex w-[34px] shrink-0 items-center justify-center">
      {children}
    </span>
  );
}

/**
 * One row of a transaction screen: a leading glyph, what it says, and a way in.
 *
 * It is a `<button>` rather than a div with a click handler, so it is reachable by Tab, pressable by Enter and
 * Space, and findable by name — the accessible name is the label, which is how every later spec drives it.
 *
 * Two readings, both from the approved mockup:
 *
 * - `lead="label"` (Add more details, the edit sheet): the label is the title and what it holds sits on the right —
 *   "Event · Singapore holiday ›".
 * - `lead="value"` (the main card, B2): **what was chosen** is the title and the label is the small caption on the
 *   right — "BCA KrisFlyer · ···· 1467 ›", "Personal · Workspace ›". Empty, the title is `placeholder` in the faint
 *   ink ("Select category") and there is no caption, because the placeholder already says what the row is.
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
  caption,
  placeholder,
  lead = 'label',
  chevron = true,
  onClick,
  disabled = false,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  name?: string;
  value?: ReactNode;
  /** With `lead="value"`, the caption on the right; the label when left out. */
  caption?: ReactNode;
  /** With `lead="value"`, what an empty row says. The label when left out. */
  placeholder?: string;
  lead?: 'label' | 'value';
  chevron?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** `muted` for a row with nothing chosen yet (B3's blank Channel); `tint` for a row that is an action. */
  tone?: 'plain' | 'muted' | 'tint';
}) {
  const empty = value === undefined || value === null || value === '';
  const title =
    lead === 'value' ? (
      <span className={cx('min-w-0 flex-1 truncate text-[15px] leading-5', empty ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>
        {empty ? (placeholder ?? label) : value}
      </span>
    ) : (
      <span
        className={cx(
          'min-w-0 flex-1 truncate text-[15px] leading-5',
          tone === 'muted' ? 'text-[var(--ph-ink-3)]' : tone === 'tint' ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-ink)]',
        )}
      >
        {label}
      </span>
    );
  const right = lead === 'value' ? (empty ? null : (caption ?? label)) : value;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={name ?? label}
      className={cx(
        'ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left',
        disabled ? 'cursor-not-allowed opacity-40' : 'active:bg-[var(--ph-fill)]',
      )}
    >
      <RowLead>{icon}</RowLead>
      <span className={ROW_BODY}>
        {title}
        {right !== undefined && right !== null && right !== '' && (
          <span className="max-w-[55%] shrink-0 truncate text-right text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{right}</span>
        )}
        {chevron && <Chevron faint={disabled} />}
      </span>
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
  info,
}: {
  icon?: ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
  /**
   * What the switch does, behind an ⓘ beside its name rather than under it: a sentence the row needs once, not every
   * time it is read. Shown under the name while the ⓘ is pressed.
   */
  info?: ReactNode;
}) {
  const [explained, setExplained] = useState(false);
  const track = (
    <span
      aria-hidden
      className={cx(
        'flex h-[26px] w-[44px] shrink-0 items-center rounded-full p-[2px] transition-colors',
        checked ? 'bg-[var(--ph-tint)]' : 'bg-[var(--ph-track)]',
      )}
    >
      <span className={cx('h-[22px] w-[22px] rounded-full bg-[var(--ph-selected)] shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform', checked && 'translate-x-[18px]')} />
    </span>
  );
  if (info === undefined) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left', disabled && 'cursor-not-allowed opacity-40')}
      >
        <RowLead>{icon}</RowLead>
        <span className={cx(ROW_BODY, 'py-2')}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-5 text-[var(--ph-ink)]">{label}</span>
            {hint && <span className="mt-[2px] block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{hint}</span>}
          </span>
          {track}
        </span>
      </button>
    );
  }
  /*
   * With an ⓘ the row cannot be one button — a button inside a button is not a thing a browser will draw — so the
   * switch is the track itself, and the rest of the row still flips it, as the one-button row does.
   */
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      className={cx('flex w-full cursor-pointer items-center gap-[10px] pl-[10px] text-left', disabled && 'cursor-not-allowed opacity-40')}
    >
      <RowLead>{icon}</RowLead>
      <span className={cx(ROW_BODY, 'py-2')}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-[6px]">
            <span className="text-[15px] leading-5 text-[var(--ph-ink)]">{label}</span>
            <button
              type="button"
              aria-label={`About ${label}`}
              aria-expanded={explained}
              onClick={(event) => {
                event.stopPropagation();
                setExplained((was) => !was);
              }}
              className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
            >
              <Info size={16} aria-hidden />
            </button>
          </span>
          {explained && <span className="mt-[2px] block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{info}</span>}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onChange(!checked);
          }}
          // 44 px tall however thin the track: the whole height is the target, as the kit asks of every control.
          className="ph-focus flex h-11 shrink-0 items-center rounded-full"
        >
          {track}
        </button>
      </span>
    </div>
  );
}

/*
 * The three rows below are the same reading as `FormRow`, for a field whose answer is not a sheet: a bare select
 * laid over a row that draws itself, a figure typed in place, and money with its currency's flag in the lead.
 *
 * They exist because the Buy / sell tab was the one tab still drawn label-left, value-right — the old app's shape
 * — while Expense, Income and Transfer had moved to a glyph, a value and a caption. The controls are unchanged:
 * a select is still a select, so the system picker, the keyboard and every `selectOption` in the suite still
 * reach it; a figure is still an input at every width, because a trade's cost does not live on `draft.amount`
 * and so has no keypad to open.
 */

/** The row's own text on the left: the value, or its prompt in the faint ink. */
const ROW_TITLE = 'min-w-0 flex-1 truncate text-[15px] leading-5';
/** The small grey word on the right — "Paid with", "IDR" — as `FormRow` draws a caption. */
const ROW_CAPTION = 'max-w-[55%] shrink-0 truncate text-right text-[12.5px] leading-4 text-[var(--ph-ink-3)]';
/** A figure or a word typed straight into a row: no box, no border, the group's hairline is the boundary. */
const ROW_FIELD = 'ph-focus-inset tabular min-w-0 flex-1 border-0 bg-transparent p-0 text-base leading-5 text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]';
/** The currency's flag, in the same 28px circle every other row leads with. */
const FLAG_CIRCLE = 'flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[15px] leading-none';

/**
 * The line under a row, indented to the text column, in the muted ink — the shape the amount row's own hint has.
 * It is what the Buy / sell tab's full-width grey paragraphs between rows become.
 */
export function RowHintLine({ children }: { children: ReactNode }) {
  return <p className="pr-[13px] pb-2 pl-[54px] text-[12px] leading-4 text-[var(--ph-ink-3)]">{children}</p>;
}

/**
 * A row carrying a hint sits in a wrapper of its own, which puts its body out of reach of the group's "every row
 * but the first" rule — so the hairline is drawn by hand, exactly as the charged row in `AmountRow` draws it.
 */
function bodyClass(divided: boolean | undefined, flush = false) {
  return cx(flush ? ROW_BODY_FLUSH : ROW_BODY, divided && 'border-t-[0.5px] border-[var(--ph-hair)]');
}

/** Row plus its hint, or the bare row when it has none, so an unhinted row keeps the group's own hairline. */
function withHint(row: ReactNode, hint: ReactNode) {
  if (!hint) return <>{row}</>;
  return (
    <div>
      {row}
      <RowHintLine>{hint}</RowHintLine>
    </div>
  );
}

/**
 * A row whose answer is the platform's own list: drawn as `FormRow` draws a chosen value — glyph, value, caption,
 * chevron — with the select laid invisibly over it. The row prints what the select says rather than letting the
 * control draw it, for the reason the kit's own `SelectRow` gives: WebKit lays a closed select out from the left
 * of a box as wide as its longest option and ignores `text-align`.
 */
export function SelectFormRow({
  icon,
  label,
  value,
  onChange,
  children,
  caption,
  display,
  placeholder,
  hint,
  divided,
}: {
  icon?: ReactNode;
  /** The accessible name — the one the journeys and the screen readers already know. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  /** The small grey word on the right, once something is chosen. */
  caption?: string;
  /**
   * What to draw instead of the chosen option's own label. Two reasons a caller needs it: the options are a
   * component rather than a list of `<option>`s, so there is nothing here to walk; or the row wants a shorter
   * face than the picker's label — "Antam" under a caption reading Bought, rather than "Investments › Antam"
   * truncated at 390px.
   */
  display?: string;
  /** What the row says with nothing chosen; the label when left out. */
  placeholder?: string;
  hint?: ReactNode;
  divided?: boolean;
}) {
  const id = useId();
  const chosen = display ?? optionLabel(children, value);
  const empty = value === '' || chosen === null || chosen === '';
  const row = (
    /* The select is laid over the **whole** row, glyph and all, so the tap target is the row — what `FormRow`
       gets for free by being one button, and what a picker row has to be given by hand. */
    <div className="ph-focus-within relative flex items-center gap-[10px] pl-[10px]">
      <RowLead>{icon}</RowLead>
      <span className={bodyClass(divided)}>
        <span aria-hidden className={cx(ROW_TITLE, empty ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>
          {empty ? (placeholder ?? label) : chosen}
        </span>
        {!empty && caption && (
          <span aria-hidden className={ROW_CAPTION}>
            {caption}
          </span>
        )}
        <Chevron />
      </span>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
      >
        {children}
      </select>
    </div>
  );
  return withHint(row, hint);
}

/**
 * A row typed into in place, read the way the amount row is read: the figure is the row's own text on the left
 * and the caption on the right says what it is — "2 · Grams", "5944 · MCC". No chevron: nothing opens.
 */
export function FieldRow({
  icon,
  label,
  value,
  onChange,
  caption,
  placeholder,
  hint,
  inputMode,
  divided,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  caption?: string;
  placeholder?: string;
  hint?: ReactNode;
  inputMode?: 'decimal' | 'numeric' | 'text';
  divided?: boolean;
}) {
  const row = (
    <div className="flex items-center gap-[10px] pl-[10px]">
      <RowLead>{icon}</RowLead>
      <span className={bodyClass(divided)}>
        <input
          aria-label={label}
          inputMode={inputMode}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={ROW_FIELD}
        />
        {caption && (
          <span aria-hidden className="shrink-0 text-[12.5px] leading-4 text-[var(--ph-ink-3)]">
            {caption}
          </span>
        )}
      </span>
    </div>
  );
  return withHint(row, hint);
}

/**
 * A money figure drawn as the add card's amount row draws one: the currency's flag in the lead, the figure where
 * a row's title goes, the code — or what the figure is — as the caption.
 *
 * The flag here is only drawn. The currency belongs to the holding, or to the account that paid, and is never a
 * choice made on this row: `AmountRow` is the one place a currency is picked, and only where the save would
 * honour it.
 */
export function MoneyFieldRow({
  currency,
  flag,
  label,
  caption,
  value,
  onChange,
  placeholder,
  hint,
  divided,
}: {
  currency: string;
  /** The flag to draw, worked out by the caller from `currency` — the kit does not read a currency table. */
  flag: string;
  label: string;
  caption?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  divided?: boolean;
}) {
  const row = (
    <div className="flex items-center gap-[10px] pl-[10px]">
      <RowLead>
        <span aria-hidden className={FLAG_CIRCLE}>
          {flag}
        </span>
      </RowLead>
      <span className={bodyClass(divided, true)}>
        <input
          aria-label={label}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={ROW_FIELD}
        />
        <span aria-hidden className="shrink-0 text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{caption ?? currency}</span>
      </span>
    </div>
  );
  return withHint(row, hint);
}

/**
 * Rows drawn as one group: the kit's surface, its radius, flat — no ring — and a hairline above every row but the
 * first, inset to the text. A child that is not a row (a hint, a second line) is simply drawn in its place.
 */
export function FormRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-[11px] bg-[var(--ph-surface)]',
        '[&>*+*>.ph-row-body]:border-t-[0.5px] [&>*+*>.ph-row-body]:border-[var(--ph-hair)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
