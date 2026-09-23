import { Check, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Children, cloneElement, type CSSProperties, isValidElement, type ReactElement, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cx } from '../../ui';
import { GROUP_GAP, GROUP_RADIUS, type GroupChild, InsetRow, type InsetRowProps, PanelHeader, ROW_PAD_X, ROW_PAD_Y, rowHeight, rowPositions, TAP, toneClass, type Tone } from '../../ui/native';

/**
 * The card page's shapes that the kit's rows cannot be, composed from the kit's own measurements.
 *
 * The card tabs carry things no primitive holds — a purchase with a typed figure and its own Save, a row with its
 * Edit and its Remove, a listbox of categories — and the old page drew each on a ringed card with outlined
 * boxes. The rule these follow is the one the events batch set: **where a row genuinely carries two controls, both
 * are kept**, and the row is drawn to the kit's padding, height, separator inset and inks rather than by bending
 * `InsetRow`, which exists to forbid exactly that shape. A control that sits *beside* a row is never inside its
 * tap target: `RowWithActions` puts a real `InsetRow` and real glyph buttons side by side.
 */

function Separator({ show }: { show: boolean | undefined }) {
  if (!show) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />;
}

const ROW_BOX = (subtitle: boolean): CSSProperties => ({ minHeight: rowHeight(subtitle), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` });

/** Text in a row's title and subtitle inks, for the free-form rows below. */
export const TITLE = 'text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]';
export const SUBTITLE = 'text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]';

/**
 * A row whose inside is the caller's: the kit's padding, height and separator around content no primitive draws.
 *
 * What goes inside may hold controls of its own — that is the reason it exists — so it is never itself a target.
 */
export function Line({
  position,
  children,
  testId,
  className,
  label,
  tight = false,
  pad,
}: GroupChild & {
  children: ReactNode;
  testId?: string;
  className?: string;
  label?: string;
  /** For a row whose edges are 44 pt controls: they carry their own air, so the row's padding would double it. */
  tight?: boolean;
  /** The row's padding, when its content is not text — a card's face carries its own edge. */
  pad?: string;
}) {
  return (
    <div className="relative" data-testid={testId} aria-label={label}>
      <Separator show={position?.separator} />
      <div className={cx('min-w-0', className)} style={tight ? { minHeight: TAP, padding: '0 2px 0 6px' } : pad ? { minHeight: TAP, padding: pad } : ROW_BOX(false)}>
        {children}
      </div>
    </div>
  );
}

/** A sentence in a group: wraps rather than truncates, since every word of it is the point. */
export function TextLine({ position, children, tone = 'ink-2' }: GroupChild & { children: ReactNode; tone?: Tone }) {
  return (
    <Line position={position}>
      <p className={cx('text-[14px] leading-[19px]', toneClass(tone))}>{children}</p>
    </Line>
  );
}

export interface RowAction {
  label: string;
  glyph: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** What the glyph does, said in full on hover — and what it knows, such as the day the bank posted a purchase. */
  hint?: string;
}

/** A glyph button the size of a thumb: the corner button's shape, without its fill, so a row stays quiet. */
export function GlyphButton({ label, glyph, onClick, destructive, disabled, hint, className }: RowAction & { className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'ph-focus flex shrink-0 items-center justify-center rounded-full disabled:opacity-40',
        destructive ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]',
        className,
      )}
      style={{ width: TAP, height: TAP }}
    >
      {glyph}
    </button>
  );
}

/**
 * A row with its own actions beside it — Edit is the row, Remove is the glyph at its end.
 *
 * The two are siblings, never one inside the other: the row keeps its whole width as one target, and the glyph is
 * a 44 pt target of its own. Swipe-to-remove would be the native shape, and it is a behaviour change the events
 * adoption already queued rather than smuggled into a restyle; until it is decided, removing stays one tap away.
 */
export function RowWithActions({ position, actions, testId, ...row }: InsetRowProps & { actions: RowAction[] }) {
  return (
    <div className="relative flex items-center" data-testid={testId}>
      <Separator show={position?.separator} />
      <div className="min-w-0 flex-1">
        <InsetRow {...row} position={position ? { ...position, separator: false } : undefined} />
      </div>
      <span className="flex shrink-0 items-center pr-[4px]">
        {actions.map((action) => (
          <GlyphButton key={action.label} {...action} />
        ))}
      </span>
    </div>
  );
}

/**
 * A form's primary action as a row: the tint, the row's height, and a real submit button.
 *
 * A real `submit`, not a row that calls the save itself: the browser then checks every `required` field before
 * anything is written, exactly as the dark rectangle it replaces did, and Enter in any field still submits.
 */
export function SubmitRow({ position, label, disabled = false, name }: GroupChild & { label: string; disabled?: boolean; name?: string }) {
  return (
    <div className="relative">
      <Separator show={position?.separator} />
      <button
        type="submit"
        name={name}
        disabled={disabled}
        className="ph-focus-inset block w-full text-left text-[15px] leading-[20px] font-medium text-[var(--ph-tint)] disabled:text-[var(--ph-ink-3)]"
        style={ROW_BOX(false)}
      >
        {label}
      </button>
    </div>
  );
}

/** An action that is not the form's submit: Cancel, Add tier, Catch up. Tint, or grey for a way out. */
export function ActionRow({
  position,
  label,
  onClick,
  icon,
  quiet = false,
  disabled = false,
}: GroupChild & { label: string; onClick: () => void; icon?: ReactNode; quiet?: boolean; disabled?: boolean }) {
  return (
    <InsetRow
      position={position}
      icon={icon}
      iconColour={icon ? 'var(--ph-tint)' : undefined}
      title={<span className={quiet ? 'font-normal text-[var(--ph-ink-2)]' : 'text-[var(--ph-tint)]'}>{label}</span>}
      onClick={onClick}
      disabled={disabled}
      chevron={false}
    />
  );
}

/**
 * A choice of several, as a row: the label and its hint on top, the platform's own list under them.
 *
 * `SelectRow` is one answer on the right; a rule's categories are many, and a single-line picker would hide all but
 * one of them. The list is laid bare inside the row, with no box of its own, as `SelectRow` lays its select bare.
 */
export function MultiSelectRow({
  position,
  label,
  hint,
  children,
  ...props
}: GroupChild & { label: string; hint?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <div className="relative">
      <Separator show={position?.separator} />
      <div style={ROW_BOX(true)}>
        <label htmlFor={id} className="block text-[15px] leading-[20px] text-[var(--ph-ink)]">
          {label}
        </label>
        {hint && <p className={cx('mt-[2px]', SUBTITLE)}>{hint}</p>}
        <select
          {...props}
          id={id}
          multiple
          className="ph-focus mt-[8px] block w-full rounded-[8px] bg-[var(--ph-fill)] p-[4px] text-[16px] leading-[22px] text-[var(--ph-ink)] md:text-[14px]"
        >
          {children}
        </select>
      </div>
    </div>
  );
}

/**
 * Earlier and later, around what is on screen: a statement's dates, a cycle's.
 *
 * Two targets and a label between them, so it is a row drawn from the kit's parts rather than an `InsetRow`.
 */
export function StepperRow({
  position,
  earlier,
  later,
  laterDisabled,
  children,
  testId,
}: GroupChild & { earlier: RowAction; later: Omit<RowAction, 'glyph'>; laterDisabled?: boolean; children: ReactNode; testId?: string }) {
  return (
    <div className="relative">
      <Separator show={position?.separator} />
      <div className="flex items-center gap-1 px-[4px]" style={{ minHeight: TAP }}>
        <GlyphButton {...earlier} />
        <span className="tabular min-w-0 flex-1 truncate text-center text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]" data-testid={testId}>
          {children}
        </span>
        <GlyphButton {...later} glyph={<ChevronRight size={20} aria-hidden />} disabled={laterDisabled} />
      </div>
    </div>
  );
}

export const EARLIER = <ChevronLeft size={20} aria-hidden />;

/** The iOS search field: a filled capsule with the glass in it, on the page rather than in a group. */
export function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="relative mb-[12px] block">
      <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-[10px] -translate-y-1/2 text-[var(--ph-ink-3)]" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="ph-focus h-[36px] w-full rounded-[10px] bg-[var(--ph-track)] pr-[10px] pl-[32px] text-[16px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
      />
    </label>
  );
}

/** A setup step, named above the group it belongs to: the tint line iOS puts over a header that is a stage. */
export function Step({ children }: { children: ReactNode }) {
  return <p className="px-[4px] pb-[4px] text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-tint)] uppercase">{children}</p>;
}

/** A small capsule button for a choice inside a row — a statement to jump to, a fix to apply. Never a dark box. */
export function Capsule({
  children,
  onClick,
  selected = false,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  selected?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      className={cx(
        'ph-focus ph-tap rounded-full px-[10px] py-[4px] text-[13px] leading-[18px] font-medium',
        selected ? 'bg-[var(--ph-tint)] text-[var(--ph-surface)]' : 'bg-[var(--ph-fill)] text-[var(--ph-tint)]',
      )}
      style={{ '--ph-tap-y': '9px' } as CSSProperties}
    >
      {children}
    </button>
  );
}

/** A row that leaves the app — a mail to the catalogue's keeper. A plain link, since no route can name it. */
export function HrefRow({ position, href, label }: GroupChild & { href: string; label: string }) {
  return (
    <div className="relative">
      <Separator show={position?.separator} />
      <a href={href} className="ph-focus-inset block w-full text-[15px] leading-[20px] font-medium text-[var(--ph-tint)]" style={ROW_BOX(false)}>
        {label}
      </a>
    </div>
  );
}

/**
 * One of a list to pick from — a catalogue card. The whole row is the one target, and the pick is a tick at its end,
 * as an iOS list of choices marks it; `aria-pressed` says the same to a screen reader.
 */
export function ChoiceRow({ position, label, selected, onClick }: GroupChild & { label: string; selected: boolean; onClick: () => void }) {
  return (
    <div className="relative">
      <Separator show={position?.separator} />
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cx('ph-focus-inset flex w-full items-center gap-3 text-left text-[15px] leading-[20px]', selected ? 'font-medium text-[var(--ph-ink)]' : 'text-[var(--ph-ink)]')}
        style={ROW_BOX(false)}
      >
        <span className="min-w-0 flex-1">{label}</span>
        <Check size={17} aria-hidden className={cx('shrink-0 text-[var(--ph-tint)]', !selected && 'invisible')} />
      </button>
    </div>
  );
}

/**
 * A figure row whose second line is not a subtitle but a meter: a rule's cap, a bonus's progress.
 *
 * The title and the figure come first in the document as well as on screen, so the sentence a reader (or a test)
 * reads off the row is "Monthly spend bonus Rp 21.000.000 → 1.000 miles", not the name broken by the meter.
 */
export function FigureRow({ position, title, value, children, testId }: GroupChild & { title: ReactNode; value: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <Line position={position} testId={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cx('min-w-0', TITLE)}>{title}</span>
        <span className="tabular shrink-0 text-right text-[15px] leading-[20px] whitespace-nowrap text-[var(--ph-ink-2)]">{value}</span>
      </div>
      {children}
    </Line>
  );
}

/** The kit's 7 px meter, for a fraction the caller has already worked out — a cap used, a bonus reached. */
export function Meter({ fraction, tone = 'tint', label }: { fraction: number; tone?: 'tint' | 'warn'; label?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div
      className="mt-[6px] overflow-hidden bg-[var(--ph-track)]"
      style={{ height: 7, borderRadius: 99 }}
      role={label ? 'progressbar' : undefined}
      aria-label={label}
      aria-valuenow={label ? percent : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
    >
      <div className="h-full" style={{ width: `${percent}%`, borderRadius: 99, background: tone === 'warn' ? 'var(--ph-warn)' : 'var(--ph-tint)' }} />
    </div>
  );
}

const COLUMNS = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' } as const;

/**
 * One group whose rows a desktop lays out in columns: the old page's form of three or four fields in a line.
 *
 * On a phone it is exactly an `InsetGroup` — one white shape, one list, a hairline between every row. On a wide
 * screen the same rows stand in side-by-side columns inside that one shape, with a hairline between the columns,
 * so a desktop reads a form across rather than down a 672 px strip. It is the same DOM at both widths: each
 * column is a short list of its own, and the join between two columns is drawn as a row separator on the phone
 * and as a vertical rule on the desktop.
 */
export function ColumnGroup({
  header,
  trailing,
  footer,
  columns,
  testId,
}: {
  header?: string;
  trailing?: ReactNode;
  footer?: ReactNode;
  /** Each column's rows, in the order a phone reads them. An empty column is left out. */
  columns: ReactNode[][];
  testId?: string;
}) {
  const filled = columns
    .map((column) => Children.toArray(column).filter(isValidElement) as ReactElement<GroupChild>[])
    .filter((column) => column.length > 0);
  return (
    <section className="w-full" style={{ marginBottom: GROUP_GAP }} data-testid={testId}>
      {header && <PanelHeader title={header} trailing={trailing} />}
      <div className={cx('overflow-hidden bg-[var(--ph-surface)] md:grid', COLUMNS[filled.length as keyof typeof COLUMNS])} style={{ borderRadius: GROUP_RADIUS }}>
        {filled.map((rows, index) => {
          const positions = rowPositions(rows.length);
          return (
            <div key={index} className="relative min-w-0">
              {index > 0 && (
                <>
                  <span aria-hidden className="pointer-events-none absolute top-0 z-[1] bg-[var(--ph-hair)] md:hidden" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />
                  <span aria-hidden className="pointer-events-none absolute top-[11px] bottom-[11px] left-0 hidden bg-[var(--ph-hair)] md:block" style={{ width: 0.5 }} />
                </>
              )}
              {rows.map((row, at) => cloneElement(row, { position: positions[at] }))}
            </div>
          );
        })}
      </div>
      {footer && <p className="px-[4px] pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p>}
    </section>
  );
}

/** Groups side by side on a desktop, stacked on a phone: a form whose groups each already have a header. */
export function GroupColumns({ children, wide = 'even' }: { children: ReactNode; wide?: 'even' | 'second' }) {
  return (
    <div className={cx('md:grid md:items-start md:gap-x-[18px]', wide === 'even' ? 'md:grid-cols-2' : 'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]')}>
      {children}
    </div>
  );
}
