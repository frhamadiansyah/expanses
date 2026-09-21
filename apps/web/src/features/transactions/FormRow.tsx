import type { ReactNode } from 'react';
import { cx } from '../../ui';

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
}: {
  icon?: ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
}) {
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
        <span
          aria-hidden
          className={cx(
            'flex h-[26px] w-[44px] shrink-0 items-center rounded-full p-[2px] transition-colors',
            checked ? 'bg-[var(--ph-tint)]' : 'bg-[var(--ph-track)]',
          )}
        >
          <span className={cx('h-[22px] w-[22px] rounded-full bg-[var(--ph-selected)] shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform', checked && 'translate-x-[18px]')} />
        </span>
      </span>
    </button>
  );
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
