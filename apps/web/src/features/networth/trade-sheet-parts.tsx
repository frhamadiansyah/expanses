import { formatMinor, groupTypedAmount, parseMajor } from '@expanses/core';
import { type AccountRow, type RecordTradeInput, recordTrade } from '@expanses/db';
import { Info } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, useEffect, useId, useState } from 'react';
import { useApp } from '../../app/context';
import { canTradeCashWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview } from '../../lib/rates';
import { cx } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, PickerRow, ROW_PAD_X, ROW_PAD_Y, rowHeight, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { useGoals } from '../goals/queries';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { CategoryOptions } from '../cards/options';
import { PaymentSheet } from '../transactions/PaymentSheet';
import { detailsToggleLabel } from '../transactions/tx-form';
import { GoalParts } from './GoalParts';
import { SPLIT } from './goal-parts-form';
import { emptyTradeDetails, pairRate, type TradeDetailsDraft, withDetails } from './trade-details';
import { tradeRatesForSave } from './trade-money';

/*
 * The parts the short Buy / Sell sheets share: the holding's own line, a money row, the account the money comes from
 * or goes to, a worked-out row with its ⓘ, the details behind "Add more details", and the save.
 */

/** A row's text, as the kit's form rows draw it: 17 px on a phone (never under 16, or iOS zooms a field), 15 px on md. */
const ROW_TEXT = 'text-[17px] leading-[22px] md:text-[15px] md:leading-[20px]';

/** A gain with its sign, as the page writes one: +Rp 11.840, −Rp 110.000. */
export const signedMinor = (minor: number, currency: string) => `${minor < 0 ? '−' : '+'}${formatMinor(Math.abs(minor), currency)}`;

/** A typed amount in minor units, or null while it is not one above zero. */
export function typedMinor(text: string, currency: string): number | null {
  if (text.trim() === '') return null;
  try {
    const minor = parseMajor(text, currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

function Separator({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />;
}

/** The ⓘ beside a label, which shows its explanation under the row. */
export function InfoButton({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`About ${label}`}
      aria-expanded={open}
      onClick={onToggle}
      className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
    >
      <Info size={16} aria-hidden />
    </button>
  );
}

export const Explained =({ children }: { children: ReactNode }) => <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{children}</p>;

/**
 * A row typed into: the label (with an ⓘ when it has one) at the left, the figure at the right, and — on a sell — an
 * All pill after it. The field is a plain text field; the caller groups what is typed. Drawn at the kit's form-row
 * size, so it reads the same as the Paid from and Date rows under it.
 */
export function TypedRow({
  label,
  info,
  pill,
  position,
  ...props
}: GroupChild & {
  label: string;
  info?: ReactNode;
  /** A pill at the row's right end: All. */
  pill?: { label: string; on: boolean; run: () => void };
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="flex shrink-0 items-center gap-[6px]">
          <label htmlFor={id} className={cx(ROW_TEXT, 'text-[var(--ph-ink)]')}>
            {label}
          </label>
          {info && <InfoButton label={label} open={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        <input
          {...props}
          id={id}
          autoComplete="off"
          className={cx('ph-focus tabular min-w-0 flex-1 rounded bg-transparent text-right text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)]', ROW_TEXT)}
        />
        {pill && (
          <button
            type="button"
            aria-pressed={pill.on}
            onClick={pill.run}
            className={cx(
              'ph-focus shrink-0 rounded-full px-[10px] py-[3px] text-[13px] leading-[18px] font-semibold',
              pill.on ? 'bg-[var(--ph-tint)] text-[var(--ph-surface)]' : 'bg-[var(--ph-fill)] text-[var(--ph-tint)]',
            )}
          >
            {pill.label}
          </button>
        )}
      </div>
      {info && explained && <Explained>{info}</Explained>}
    </div>
  );
}

/** A worked-out row: the label (and its ⓘ) and the figure, both in the quiet grey of something not typed. */
export function ResultRow({
  label,
  info,
  value,
  valueClass,
  testId,
  position,
}: GroupChild & { label: string; info?: ReactNode; value: ReactNode; valueClass?: string; testId?: string }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative" data-testid={testId}>
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="flex min-w-0 flex-1 items-center gap-[6px]">
          <span className={cx(ROW_TEXT, 'text-[var(--ph-ink-3)]')}>{label}</span>
          {info && <InfoButton label={label} open={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        <span className={cx('tabular shrink-0 whitespace-nowrap', ROW_TEXT, valueClass ?? 'text-[var(--ph-ink-3)]')}>{value}</span>
      </div>
      {info && explained && <Explained>{info}</Explained>}
    </div>
  );
}

/** The accounts money can come from or go to, as the full form offers them, and the one chosen now. */
export function useCashSide(defaultId: string | null, kind: 'buy' | 'sell' = 'sell') {
  const accounts = useAccounts();
  // A buy may also be charged to a credit card, as the full Buy form allows (`canTradeCashWith`).
  const choices: AccountRow[] = moneyHolders(accounts.data ?? []).filter((account) => canTradeCashWith(account, kind));
  const [picked, setPicked] = useState('');
  // Owned before the app: recorded against Opening Balances, so no account's balance moves (an empty cash account).
  const [past, setPast] = useState(false);
  const chosen = picked || (defaultId && choices.some((a) => a.id === defaultId) ? defaultId : '') || choices[0]?.id || '';
  const cashAccountId = past ? '' : chosen;
  const cashAccount = past ? undefined : choices.find((account) => account.id === cashAccountId);
  return {
    accounts: accounts.data ?? [],
    choices,
    cashAccountId,
    cashAccount,
    /** The paying account is a credit card: the purchase then asks its category for points, and an MCC. */
    isCard: cashAccount?.subtype === 'credit_card',
    past,
    setPast,
    /** An account to move, or a past trade that moves none. */
    ready: past || cashAccountId !== '',
    pick: (id: string) => {
      setPast(false);
      setPicked(id);
    },
  };
}

/** "Paid from" or "To": the account, opening the list of them. */
export function CashRow({ label, side, onOpen, position }: GroupChild & { label: string; side: ReturnType<typeof useCashSide>; onOpen: () => void }) {
  return <PickerRow position={position} label={label} value={side.past ? (label === 'To' ? 'Past sale' : 'Past purchase') : (side.cashAccount?.name ?? null)} placeholder="Account" onOpen={onOpen} />;
}

/** The list of accounts in a sheet of its own, as a transaction's Paid with — drawn outside the groups. */
export function CashSheet({ title, side, onClose }: { title: string; side: ReturnType<typeof useCashSide>; onClose: () => void }) {
  return (
    <PaymentSheet
      title={title}
      options={side.choices.map((account) => ({ accountId: account.id, cardId: null, accountName: account.name, last4: null, holderName: null }))}
      accounts={side.accounts}
      chosenAccountId={side.cashAccountId}
      onPick={(option) => side.pick(option.accountId)}
      onClose={onClose}
    />
  );
}

/** The holding the sheet trades: its kind's drawing, its name, and what is held with its price. */
export function HoldingRow({ icon, name, subtitle, position }: GroupChild & { icon: ReactNode; name: string; subtitle: string }) {
  return <InsetRow position={position} icon={icon} title={name} subtitle={subtitle} testId="trade-holding" />;
}

/** The goal select's stand-in for no goal, so the row reads "None" rather than an empty answer. */
const NO_GOAL = '__none';

/**
 * What the sheet keeps behind "Add more details": the draft, whether it is open, and the day rate the save could not
 * find. Folding it away keeps every value, and the save still sends them. Picking an account in another currency
 * opens it, since its Rate that day is then needed before the trade can be recorded.
 */
export function useTradeDetails(o: { holdingCurrency: string; cashCurrency: string | undefined; byMoney?: boolean; card?: boolean }) {
  const { ws } = useApp();
  const goals = useGoals();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TradeDetailsDraft>(emptyTradeDetails);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const cashCurrency = o.cashCurrency ?? ws.baseCurrency;
  const pair = pairRate(o.holdingCurrency, cashCurrency, ws.baseCurrency);
  const pairKey = pair ? `${pair.from}/${pair.to}` : '';
  useEffect(() => {
    if (pairKey) setOpen(true);
  }, [pairKey]);

  /** The sheet's trade with the details on it, or the reason it cannot be read; null in, null out. */
  function apply(input: RecordTradeInput | null): { input: RecordTradeInput | null; problem: string | null } {
    if (!input) return { input: null, problem: null };
    try {
      return { input: withDetails(input, draft, { holdingCurrency: o.holdingCurrency, cashCurrency, baseCurrency: ws.baseCurrency, byMoney: !!o.byMoney, card: !!o.card }), problem: null };
    } catch (e) {
      return { input: null, problem: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    open,
    toggle: () => setOpen((was) => !was),
    draft,
    change: (patch: Partial<TradeDetailsDraft>) => setDraft((was) => ({ ...was, ...patch })),
    goals: (goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name })),
    pair,
    needsRate,
    /** The save found no day rate for `currency`: ask for it here, in view. */
    onMissing: (currency: string) => {
      setNeedsRate(currency);
      setOpen(true);
    },
    dayRateLabel: needsRate && pair ? `${needsRate} rate that day` : 'Rate that day',
    apply,
  };
}

export type TradeDetailsState = ReturnType<typeof useTradeDetails>;

/**
 * The second box, under the first and opened by the plain toggle under it, as Add transaction and a new debt fold
 * theirs: Fee, Tax withheld, the goal, and Rate that day when the money account is in another currency. `emptyWord`
 * is what an empty Fee or Tax withheld means — "None", or a listed share's "Worked out". The first box never moves.
 */
export function TradeDetails({
  kind,
  details,
  currency,
  emptyWord,
  whole,
  byMoney = false,
  unitLabel,
  problem,
  past,
}: {
  /** A trade made before the app: the switch that records it against Opening Balances, no account moving. */
  past?: { on: boolean; set: (on: boolean) => void };
  kind: 'buy' | 'sell';
  details: TradeDetailsState;
  /** The holding's currency: the fee and tax are in it. */
  currency: string;
  emptyWord: string;
  /** The trade's own units (or, by money, its amount), as typed: what a split between goals divides. */
  whole: string;
  byMoney?: boolean;
  unitLabel: string;
  problem: string | null;
}) {
  const { ws } = useApp();
  const { draft, change, goals, pair, needsRate } = details;
  const amountMode = currency === 'IDR' ? 'numeric' : 'decimal';
  return (
    <>
      {details.open && (
        <>
          <InsetGroup footer={problem ?? undefined}>
            {past ? (
              <SwitchRow
                label={kind === 'buy' ? 'Past purchase' : 'Past sale'}
                checked={past.on}
                onChange={past.set}
                info={kind === 'buy' ? "Bought earlier, so no account's balance moves." : "Sold earlier, so no account's balance moves."}
              />
            ) : null}
            <TypedRow
              label="Fee"
              value={draft.fee}
              onChange={(e) => change({ fee: groupTypedAmount(e.target.value, currency) })}
              inputMode={amountMode}
              placeholder={emptyWord}
            />
            <TypedRow
              label="Tax withheld"
              value={draft.tax}
              onChange={(e) => change({ tax: groupTypedAmount(e.target.value, currency) })}
              inputMode={amountMode}
              placeholder={emptyWord}
            />
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
                hint={ratePreview(draft.dayRate, needsRate, ws.baseCurrency) ?? `${ws.baseCurrency} per 1 ${needsRate}`}
                value={draft.dayRate}
                onChange={(e) => change({ dayRate: e.target.value })}
                inputMode="decimal"
                placeholder="Rate"
              />
            ) : null}
          </InsetGroup>
          {draft.goalId === SPLIT && (
            <div style={{ marginBottom: 18 }}>
              <GoalParts parts={draft.parts} onChange={(parts) => change({ parts })} goals={goals} whole={whole} byMoney={byMoney} currency={currency} unitLabel={unitLabel} />
            </div>
          )}
        </>
      )}
      <button
        type="button"
        aria-expanded={details.open}
        onClick={details.toggle}
        className="ph-focus mb-[18px] flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-[var(--ph-ink-2)]"
      >
        {detailsToggleLabel(details.open)}
      </button>
    </>
  );
}

/**
 * What a purchase on a credit card asks beyond the account: the category it counts under for points and its MCC, in a
 * box of their own under the first. Drawn only for a buy paid by a card, and nowhere else.
 */
export function CardPointsBox({ details, accounts, show }: { details: TradeDetailsState; accounts: readonly AccountRow[]; show: boolean }) {
  if (!show) return null;
  const { draft, change } = details;
  return (
    <InsetGroup footer="Not spending: it only tells the points engine what the card bought.">
      <SelectRow label="Category for points" value={draft.spendCategoryId} onChange={(e) => change({ spendCategoryId: e.target.value })}>
        <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
      </SelectRow>
      <TextRow label="MCC" value={draft.mcc} onChange={(e) => change({ mcc: e.target.value })} inputMode="numeric" placeholder="Code" />
    </InsetGroup>
  );
}

/** The trade's save, as the full form saves one: rates for the day, the set-aside question, then `recordTrade`. */
export function useTradeSave(o: {
  input: RecordTradeInput | null;
  holdingCurrency: string;
  cashCurrency: string | undefined;
  details: TradeDetailsState;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const setAside = useSetAside(o.input ? tradeDoor(o.input) : null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const input = o.input;
    if (!input || !setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const ratesToBase = await tradeRatesForSave({
        database, ws, input, holdingCurrency: o.holdingCurrency, cashCurrency: o.cashCurrency ?? ws.baseCurrency,
        needsRate: o.details.needsRate, manualRate: o.details.draft.dayRate, resolveRates, onMissing: o.details.onMissing, where: o.details.dayRateLabel,
      });
      // A past trade names no account: Opening Balances stands for it, as the full form's empty choice did.
      await recordTrade(database, ws, { ...input, cashAccountId: input.cashAccountId || null, ratesToBase, setAside: setAside.choice });
      await invalidate();
      o.onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { save, error, busy, setAside, canSave: !busy && o.input !== null && setAside.ready };
}
