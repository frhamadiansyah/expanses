import type { AccountRow } from '@expanses/db';
import { CreditCard, Hash, History, Landmark, Layers, Percent, Receipt, Tag, Target } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { CategoryIcon } from '../categories/CategoryIcon';
import { SPLIT } from '../networth/goal-parts-form';
import { type BuyMode, goalRowText, payRowText, type TradeSide } from './buy-rows';
import { CategoryPicker } from './CategoryPicker';
import { ChoiceSheet } from './ChoiceSheet';
import { FieldRow, FormRow, ROW_BODY, RowGlyph, RowLead, type RowPill, SwitchRow } from './FormRow';
import { detailsToggleLabel } from './tx-form';

/*
 * One Buy / Sell, wherever it is made (owner, 13 Nov 2026): the Trade screen and every holding's own sheet read like
 * the Expense form. Paid with (Received into), the amount (`FigureRow`), the holding as Expense's Category row, the
 * units the kind is counted in, the date; then, behind Add more details, the goal, a card's two facts for points,
 * the fee and the tax. These are only the rows: each form keeps its own draft and its own save, so what is recorded
 * is exactly what it recorded before.
 */

/** Paid with or Received into: the row Expense and Income lead with, opening the same account sheet. */
export function TradeMoneyRow({ kind, value, onClick, disabled = false }: { kind: TradeSide; value: string; onClick: () => void; disabled?: boolean }) {
  const { label, caption } = payRowText(kind);
  return (
    <FormRow
      lead="value"
      icon={<RowGlyph>{kind === 'buy' ? <CreditCard size={15} /> : <Landmark size={15} />}</RowGlyph>}
      label={label}
      caption={caption}
      value={value}
      chevron={!disabled}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

/**
 * The holding, read as Expense's Category row: its kind's drawing and its name, nothing under it. On Trade it opens
 * the Investment sheet; on a holding's own sheet it is that holding, so it is a plain row — no chevron, no tap.
 */
export function TradeHoldingRow({ glyph, name, onClick, label = 'Investment' }: { glyph: ReactNode; name: string; onClick?: () => void; label?: string }) {
  const icon = <RowGlyph>{glyph}</RowGlyph>;
  if (onClick) return <FormRow lead="value" icon={icon} label={label} placeholder={label} value={name} caption="" onClick={onClick} />;
  return (
    <div data-testid="trade-holding" className="flex items-center gap-[10px] pl-[10px]">
      <RowLead>{icon}</RowLead>
      <span className={ROW_BODY}>
        <span className="min-w-0 flex-1 truncate text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-5">{name}</span>
      </span>
    </div>
  );
}

/** How much of the holding moved, in the word its kind is counted in — Grams, Units, Par value, Lots — with All on a sell. */
export function TradeUnitsRow({
  label,
  caption,
  value,
  onChange,
  placeholder = 'How many',
  pill,
  invalid,
  onFocus,
  onBlur,
}: {
  label: string;
  caption?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  pill?: RowPill;
  invalid?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <FieldRow
      icon={
        <RowGlyph>
          <Layers size={15} />
        </RowGlyph>
      }
      label={label}
      caption={caption ?? label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      inputMode="decimal"
      pill={pill}
      invalid={invalid}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}

/** A figure typed under Add more details — Fee, Tax withheld — its word on the right once something is in it. */
export function TradeFigureField({
  glyph,
  label,
  caption,
  value,
  onChange,
  placeholder,
  inputMode = 'decimal',
}: {
  glyph: ReactNode;
  label: string;
  caption: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <FieldRow
      icon={<RowGlyph>{glyph}</RowGlyph>}
      label={label}
      caption={value.trim() === '' ? undefined : caption}
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? caption}
      inputMode={inputMode}
    />
  );
}

/** The tax a payment had withheld, on the payment's own card: a coupon's tax is half of what the payment is. */
export function TradeTaxField({ label, value, onChange }: { label: string; value: string; onChange: (text: string) => void }) {
  return <TradeFigureField glyph={<Receipt size={15} />} label={label} caption="Tax withheld" value={value} onChange={onChange} />;
}

export interface TradeGoalChoice {
  goals: readonly { id: string; name: string }[];
  /** The goal chosen: empty for none, `SPLIT` while the trade is split between goals. */
  value: string;
  onPick: (goalId: string) => void;
  /** Offer Split between goals… (with two goals or more): the holding sheets can carry a split, Trade cannot. */
  split?: boolean;
}

export interface TradePoints {
  /** Where the category's name and colour are read from. */
  accounts: readonly AccountRow[];
  categoryId: string;
  mcc: string;
  onCategory: (categoryId: string) => void;
  onMcc: (mcc: string) => void;
}

/**
 * Add more details' rows for a trade, in the order the mockup draws them: Goal (From goal on a sell), then — a buy on
 * a credit card only — Category for points and MCC, then Fee, and Tax withheld on a sell. Each one line, no hint
 * under any. Category for points opens the Select category sheet Expense opens. `children` come after, in the same
 * group: the rate rows a form asks for when its money crosses a currency.
 *
 * Drawn as rows for a `FormRows` the caller owns, so Trade can put them at the head of its own Add more details.
 */
export function TradeDetailRows({
  kind,
  goal,
  points,
  fee,
  tax,
  past,
  children,
}: {
  kind: TradeSide;
  goal?: TradeGoalChoice;
  points?: TradePoints;
  fee?: { label: string; value: string; onChange: (text: string) => void };
  tax?: { label: string; value: string; onChange: (text: string) => void };
  /** A trade made before the app, recorded against Opening Balances with no account moving. */
  past?: { label: string; on: boolean; set: (on: boolean) => void; info: string };
  children?: ReactNode;
}) {
  const [sheet, setSheet] = useState<null | 'goal' | 'points'>(null);
  const goalWords = goalRowText(kind === 'sell' ? 'sell' : ('buy' as BuyMode));
  const goalName = (id: string) => (id === SPLIT ? 'Split between goals' : (goal?.goals.find((each) => each.id === id)?.name ?? 'None'));
  const pointsName = points?.categoryId ? (points.accounts.find((account) => account.id === points.categoryId)?.name ?? '') : '';
  return (
    <>
      {goal && goal.goals.length > 0 && (
        <FormRow
          lead="value"
          icon={
            <RowGlyph>
              <Target size={15} />
            </RowGlyph>
          }
          label={goalWords.label}
          caption={goalWords.caption}
          value={goalName(goal.value)}
          onClick={() => setSheet('goal')}
        />
      )}
      {points && (
        <>
          <FormRow
            lead="value"
            icon={
              points.categoryId ? (
                <CategoryIcon categoryId={points.categoryId} accounts={points.accounts} size="row" />
              ) : (
                <RowGlyph>
                  <Tag size={15} />
                </RowGlyph>
              )
            }
            label="Category for points"
            placeholder="Category for points"
            caption="For points"
            value={pointsName}
            onClick={() => setSheet('points')}
          />
          <FieldRow
            icon={
              <RowGlyph>
                <Hash size={15} />
              </RowGlyph>
            }
            label="MCC"
            caption={points.mcc.trim() === '' ? undefined : 'MCC'}
            placeholder="MCC"
            inputMode="numeric"
            value={points.mcc}
            onChange={points.onMcc}
          />
        </>
      )}
      {fee && <TradeFigureField glyph={<Percent size={15} />} label={fee.label} caption="Fee" value={fee.value} onChange={fee.onChange} />}
      {tax && <TradeTaxField label={tax.label} value={tax.value} onChange={tax.onChange} />}
      {past && (
        <SwitchRow
          icon={
            <RowGlyph>
              <History size={15} />
            </RowGlyph>
          }
          label={past.label}
          checked={past.on}
          onChange={past.set}
          info={past.info}
        />
      )}
      {children}

      {sheet === 'goal' && goal && (
        <ChoiceSheet
          title={goalWords.label}
          value={goal.value}
          groups={[
            {
              choices: [
                { value: '', label: 'None', glyph: <Target size={15} /> },
                ...goal.goals.map((each) => ({ value: each.id, label: each.name, glyph: <Target size={15} /> })),
                ...(goal.split && goal.goals.length > 1 ? [{ value: SPLIT, label: 'Split between goals…', glyph: <Target size={15} /> }] : []),
              ],
            },
          ]}
          onPick={goal.onPick}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'points' && points && (
        <CategoryPicker
          kind="expense"
          lockKind
          value={points.categoryId}
          onPick={points.onCategory}
          {...(points.categoryId ? { onNone: () => points.onCategory('') } : {})}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

/** Add more details / Fewer details: plain words across the column, under the card, as Expense draws it. */
export function DetailsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="ph-focus flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-[var(--ph-ink-2)]"
    >
      {detailsToggleLabel(open)}
    </button>
  );
}
