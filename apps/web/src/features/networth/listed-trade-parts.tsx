import { Minus, Plus } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ratePreview } from '../../lib/rates';
import { cx } from '../../ui';
import { type GroupChild, InsetGroup, ROW_PAD_X, ROW_PAD_Y, rowHeight, SelectRow, TextRow } from '../../ui/native';
import { useKeyboardInset } from '../../ui/native/KeyboardStrip';
import { GoalParts } from './GoalParts';
import { SPLIT } from './goal-parts-form';
import { Explained, InfoButton, type TradeDetailsState } from './trade-sheet-parts';

/*
 * The rows of the listed share's Buy / Sell sheet that no other trade sheet has: a plain row that is typed into when
 * tapped, the bar of − / + over the keyboard, the figure rows of the total box with the fee row that folds open in
 * place, and the goal box.
 */

const ROW_TEXT = 'text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]';
const shell = { minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` } as const;

function Separator({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />;
}

/** The label with its ⓘ, and the text the ⓘ opens under the row. */
function useExplained() {
  const [explained, setExplained] = useState(false);
  return { explained, toggle: () => setExplained((was) => !was) };
}

/** A row that only reads: the label at the left, a grey value at the right, no chevron and nothing to tap. */
export function ReadRow({ label, value, position }: GroupChild & { label: string; value: string }) {
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell}>
        <span className={cx('shrink-0 text-[var(--ph-ink)]', ROW_TEXT)}>{label}</span>
        <span className={cx('min-w-0 flex-1 truncate text-right text-[var(--ph-ink-3)]', ROW_TEXT)}>{value}</span>
      </div>
    </div>
  );
}

/**
 * A row that reads as a plain row, like Date: the label (and its ⓘ) at the left, the value in grey at the right. Tapping
 * it selects it: the value turns blue and is typed in with the numeric keypad. The field is laid over the whole row, so
 * a tap anywhere on it (the ⓘ aside) lands on the field itself.
 */
export function TapRow({
  label,
  info,
  shown,
  raw,
  onType,
  onEdit,
  invalid,
  position,
}: GroupChild & {
  label: string;
  info?: ReactNode;
  /** The value as the row reads while not selected: "1 lot · 100 shares". The field itself always holds `raw`. */
  shown: string;
  /** The value as it is typed while selected: "1". */
  raw: string;
  onType: (text: string) => void;
  onEdit: (editing: boolean) => void;
  invalid: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const { explained, toggle } = useExplained();
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="relative flex items-center gap-3" style={shell}>
        <span className="pointer-events-none relative z-10 flex shrink-0 items-center gap-[6px]">
          <span className={cx('text-[var(--ph-ink)]', ROW_TEXT)}>{label}</span>
          {info && (
            <span className="pointer-events-auto">
              <InfoButton label={label} open={explained} onToggle={toggle} />
            </span>
          )}
        </span>
        <span aria-hidden className={cx('tabular min-w-0 flex-1 truncate text-right', ROW_TEXT, invalid ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]', focused && 'invisible')}>
          {shown}
        </span>
        <input
          aria-label={label}
          aria-invalid={invalid}
          value={raw}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => {
            setFocused(true);
            onEdit(true);
          }}
          onBlur={() => {
            setFocused(false);
            onEdit(false);
          }}
          inputMode="numeric"
          autoComplete="off"
          className={cx(
            'ph-focus-inset tabular absolute inset-0 w-full bg-transparent text-right',
            ROW_TEXT,
            // Unselected, the row's own text above shows through: the field is there to be tapped.
            !focused ? 'text-transparent caret-transparent' : invalid ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]',
          )}
          style={{ paddingRight: ROW_PAD_X }}
        />
      </div>
      {info && explained && <Explained>{info}</Explained>}
    </div>
  );
}

/**
 * − + and Done on the keyboard's top edge, while Price or Lots is selected. The buttons keep the field focused (a
 * press on them is not allowed to move the focus), so the keyboard stays up between steps; Done lets the field go.
 * Where there is no keyboard it sits at the foot of the window.
 */
export function StepBar({
  open,
  label,
  canDown,
  canUp,
  onStep,
}: {
  open: boolean;
  /** "price" or "lots", as the buttons are named. */
  label: string;
  canDown: boolean;
  canUp: boolean;
  onStep: (direction: 1 | -1) => void;
}) {
  const inset = useKeyboardInset();
  if (!open) return null;
  const hold = { onPointerDown: (e: { preventDefault: () => void }) => e.preventDefault(), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() };
  const button = 'ph-focus-inset flex h-11 w-12 items-center justify-center text-[var(--ph-ink)] active:bg-[var(--ph-fill)] disabled:opacity-40';
  return createPortal(
    <div
      role="toolbar"
      aria-label={`Step ${label}`}
      className="fixed inset-x-0 z-50 flex items-center border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-bar)] px-2"
      style={{
        bottom: inset,
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        paddingBottom: inset === 0 ? 'env(safe-area-inset-bottom)' : undefined,
      }}
    >
      <button type="button" aria-label={`Less ${label}`} disabled={!canDown} {...hold} onClick={() => onStep(-1)} className={button}>
        <Minus size={20} aria-hidden />
      </button>
      <button type="button" aria-label={`More ${label}`} disabled={!canUp} {...hold} onClick={() => onStep(1)} className={button}>
        <Plus size={20} aria-hidden />
      </button>
      <button
        type="button"
        {...hold}
        onClick={() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }}
        className="ph-focus-inset ml-auto flex h-11 items-center px-3 text-[17px] font-semibold text-[var(--ph-ink)]"
      >
        Done
      </button>
    </div>,
    document.body,
  );
}

/** A plain row of the total box: the label at the left, a figure at the right. */
export function FigureRow({
  label,
  value,
  info,
  bold = false,
  valueClass,
  testId,
  position,
}: GroupChild & { label: string; value: ReactNode; info?: ReactNode; bold?: boolean; valueClass?: string; testId?: string}) {
  const { explained, toggle } = useExplained();
  return (
    <div className="relative" data-testid={testId}>
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={shell}>
        <span className="flex min-w-0 flex-1 items-center gap-[6px]">
          <span className={cx('text-[var(--ph-ink)]', ROW_TEXT, bold && 'font-semibold')}>{label}</span>
          {info && <InfoButton label={label} open={explained} onToggle={toggle} />}
        </span>
        <span className={cx('tabular shrink-0 whitespace-nowrap', ROW_TEXT, bold && 'font-semibold', valueClass ?? 'text-[var(--ph-ink)]')}>{value}</span>
      </div>
      {info && explained && <Explained>{info}</Explained>}
    </div>
  );
}

/**
 * The fee row: its figure reads like Value's and Total's, at the same right edge, with nothing after it. The whole row
 * is the button that folds the two typed amounts open under it, in place.
 */
export function FeeRow({
  label,
  value,
  open,
  onToggle,
  info,
  position,
}: GroupChild & { label: string; value: string; open: boolean; onToggle: () => void; info?: ReactNode }) {
  const { explained, toggle } = useExplained();
  return (
    <div className="relative" data-testid="trade-fee">
      <Separator show={Boolean(position?.separator)} />
      <div className="relative flex items-center gap-3" style={shell}>
        <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-[6px]">
          <span className={cx('text-[var(--ph-ink)]', ROW_TEXT)}>{label}</span>
          {info && (
            <span className="pointer-events-auto">
              <InfoButton label={label} open={explained} onToggle={toggle} />
            </span>
          )}
        </span>
        <span className={cx('tabular shrink-0 whitespace-nowrap text-[var(--ph-ink)]', ROW_TEXT)}>{value}</span>
        <button type="button" aria-label={`${label}, tap to change`} aria-expanded={open} onClick={onToggle} className="ph-focus-inset absolute inset-0 z-0 w-full" />
      </div>
      {info && explained && <Explained>{info}</Explained>}
    </div>
  );
}

/** An amount typed under the fee row, indented: empty, it shows the word that says the app works it out. */
export function AmountRow({ label, position, ...props }: GroupChild & { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={{ ...shell, paddingLeft: ROW_PAD_X + 18 }}>
        <label htmlFor={id} className={cx('shrink-0 text-[var(--ph-ink)]', ROW_TEXT)}>
          {label}
        </label>
        <input
          {...props}
          id={id}
          aria-label={label}
          autoComplete="off"
          className={cx('ph-focus tabular min-w-0 flex-1 rounded bg-transparent text-right text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)]', ROW_TEXT)}
        />
      </div>
    </div>
  );
}

/** The goal select's stand-in for no goal, so the row reads "None" rather than an empty answer. */
const NO_GOAL = '__none';

/**
 * The second box: the goal, and the rate that day when the money account is in another currency. Nothing is drawn
 * when there is neither (no goals, one currency), so the sheet has no empty box.
 */
export function GoalBox({
  kind,
  details,
  currency,
  whole,
  unitLabel,
  baseCurrency,
}: {
  kind: 'buy' | 'sell';
  details: TradeDetailsState;
  currency: string;
  whole: string;
  unitLabel: string;
  baseCurrency: string;
}) {
  const { draft, change, goals, pair, needsRate } = details;
  if (goals.length === 0 && !pair && !needsRate) return null;
  return (
    <>
      <InsetGroup>
        {goals.length > 0 ? (
          <SelectRow
            label={kind === 'sell' ? 'Sell from goal' : 'For goal'}
            value={draft.goalId || NO_GOAL}
            onChange={(e) => {
              const goalId = e.target.value === NO_GOAL ? '' : e.target.value;
              change(
                goalId === SPLIT && draft.parts.length === 0
                  ? { goalId, parts: [{ goalId: draft.goalId && draft.goalId !== SPLIT ? draft.goalId : (goals[0]?.id ?? ''), amount: '' }] }
                  : { goalId },
              );
            }}
          >
            <option value={NO_GOAL}>None</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name}
              </option>
            ))}
            {goals.length > 1 && <option value={SPLIT}>Split between goals…</option>}
          </SelectRow>
        ) : null}
        {pair ? (
          <TextRow
            label="Rate that day"
            hint={ratePreview(draft.rate, pair.from, pair.to) ?? `${pair.to} per 1 ${pair.from}`}
            value={draft.rate}
            onChange={(e) => change({ rate: e.target.value })}
            inputMode="decimal"
            placeholder="Rate"
          />
        ) : null}
        {needsRate ? (
          <TextRow
            label={details.dayRateLabel}
            hint={ratePreview(details.dayRate, needsRate, baseCurrency) ?? `${baseCurrency} per 1 ${needsRate}`}
            value={details.dayRate}
            onChange={(e) => details.setDayRate(e.target.value)}
            inputMode="decimal"
            placeholder="Rate"
          />
        ) : null}
      </InsetGroup>
      {draft.goalId === SPLIT && (
        <div style={{ marginBottom: 18 }}>
          <GoalParts parts={draft.parts} onChange={(parts) => change({ parts })} goals={goals} whole={whole} byMoney={false} currency={currency} unitLabel={unitLabel} />
        </div>
      )}
    </>
  );
}

/** The sheet's last box: one centred blue row that records. Grey when it cannot. */
export function RecordRow({ label, disabled, onRecord }: { label: string; disabled: boolean; onRecord: () => void }) {
  return (
    <InsetGroup>
      <RecordButton label={label} disabled={disabled} onRecord={onRecord} />
    </InsetGroup>
  );
}

function RecordButton({ label, disabled, onRecord }: { label: string; disabled: boolean; onRecord: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onRecord}
      className={cx('ph-focus-inset block w-full text-center font-semibold text-[var(--ph-ink)] disabled:text-[var(--ph-ink-3)]', ROW_TEXT)}
      style={shell}
    >
      {label}
    </button>
  );
}
