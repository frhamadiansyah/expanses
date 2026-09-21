import { formatPriceMicro, isoDate, type Position, tradeCashMovedMinor, type TradeKind, tradeRateNeeds } from '@expanses/core';
import { type AccountRow, type RecordTradeInput, recordTrade, replaceTrade, type TradeRow } from '@expanses/db';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview } from '../../lib/rates';
import { cx, ErrorBox, InputRow, Money, RowHint, SelectRow } from '../../ui';
import { useSetAsideChoiceOf } from '../goals/queries';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { FormRows, ROW_BODY_FLUSH, RowLead } from '../transactions/FormRow';
import { currencyFlag } from '../transactions/tx-form';
import { usePostedTradeMoney } from './queries';
import { draftToInput, emptyTradeDraft, prefillCharged, pricePreview, sellPreview, tradeFormReady, type TradeDraft, waitingForPostedMoney } from './trade-form';
import { tradeRatesForSave, withCharged } from './trade-money';

const KINDS: { value: TradeKind; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'income', label: 'Dividend or coupon' },
  { value: 'unit_change', label: 'Unit change (split or bonus units)' },
];

export interface TradeFormProps {
  holdings: { accountId: string; name: string; currency: string }[];
  goals: { id: string; name: string }[];
  cashAccounts: AccountRow[];
  positions: Record<string, Position>;
  /** Set when editing an existing trade; saving replaces it. */
  editing?: TradeRow | null;
  initial?: Partial<TradeDraft>;
  /** Set when the trade comes from a monthly buy, so the template counts as done this month. */
  templateId?: string | null;
  onSaved: (message: string) => void;
  onCancel?: () => void;
}

const FLAG_CIRCLE = 'flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[19px] leading-none';
const FIGURE = 'ph-focus-inset tabular min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] leading-5 text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none';

/**
 * A money figure drawn as the Add Transaction card's amount row draws one: the currency's flag in the lead, the
 * figure where a row's title goes, the code as the caption. The flag is only drawn — the currency is the holding's
 * (or the paying account's), never a choice here. `label` is the field's accessible name.
 */
function MoneyRow({
  label,
  currency,
  caption,
  value,
  onChange,
  placeholder,
  divided,
}: {
  label: string;
  currency: string;
  caption?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Draw the hairline above by hand, for a row the group's "every row but the first" rule cannot see. */
  divided?: boolean;
}) {
  return (
    <div className="flex items-center gap-[10px] pl-[10px]">
      <RowLead>
        <span aria-hidden className={FLAG_CIRCLE}>
          {currencyFlag(currency)}
        </span>
      </RowLead>
      <span className={cx(ROW_BODY_FLUSH, divided && 'border-t-[0.5px] border-[var(--ph-hair)]')}>
        <input aria-label={label} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={FIGURE} />
        <span className="shrink-0 text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{caption ?? currency}</span>
      </span>
    </div>
  );
}

export function TradeForm({ holdings, goals, cashAccounts, positions, editing, initial, templateId, onSaved, onCancel }: TradeFormProps) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const today = isoDate();
  const hintId = useId();
  const [draft, setDraft] = useState<TradeDraft>({
    ...emptyTradeDraft(holdings[0]?.accountId ?? '', cashAccounts[0]?.id ?? '', today),
    ...initial,
  });
  const [charged, setCharged] = useState('');
  const [manualRate, setManualRate] = useState('');
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const holding = holdings.find((row) => row.accountId === draft.accountId);
  const currency = holding?.currency ?? ws.baseCurrency;
  const position = positions[draft.accountId];
  const price = pricePreview(draft, currency);
  const sell = sellPreview(draft, position, currency);
  const change = (patch: Partial<TradeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const cashAccount = cashAccounts.find((account) => account.id === draft.cashAccountId);
  // An opening position pays from Opening Balances, which moves in the holding's own currency.
  const cashCurrency = cashAccount ? (cashAccount.currency ?? ws.baseCurrency) : currency;
  const needs = tradeRateNeeds(currency, cashCurrency, ws.baseCurrency);
  const asksCharged = needs.charged && draft.kind !== 'unit_change';
  // A sell whose fees took all of it moves nothing through the account: no charged amount is needed, and the row says so.
  const nothingReaches = (() => {
    if (draft.kind === 'buy' || draft.kind === 'unit_change') return false;
    try {
      return tradeCashMovedMinor(draftToInput(draft, currency, today)) === 0;
    } catch {
      return false;
    }
  })();
  /** What `submit` sends, before its rates: the one input the door, the question and the save all read. */
  const typedInput = (): RecordTradeInput => withCharged(draftToInput(draft, currency, today), charged, currency, cashCurrency);

  /*
   * An edit of a trade that crossed a currency opens with "Charged in" filled from what its own transaction posted
   * — the read a reworked sell uses (`postedTradeMoney`) — so the edit never starts from an empty figure. Filled
   * once, while the trade still pays from the account it was posted through; the owner's typing is never replaced.
   */
  const posted = usePostedTradeMoney(editing?.id ?? null);
  const prefilled = useRef(false);
  const postedCash = posted.data?.cashMinor;
  useEffect(() => {
    if (prefilled.current || !editing || postedCash === undefined) return;
    prefilled.current = true;
    setCharged((typed) => prefillCharged({ editingCashAccountId: editing.cashAccountId, cashAccountId: draft.cashAccountId, postedCash, cashCurrency, typed }) ?? typed);
  }, [editing, postedCash, draft.cashAccountId, cashCurrency]);
  const waitingForPosted = waitingForPostedMoney(!!editing, posted.isPending);

  // The one buy rule (`tradeDoor`), read off the input `submit` sends; an incomplete draft asks nothing yet. An edit
  // asks about the cash account as if the old trade's payment were not there, and opens on its saved answer.
  const door = (() => {
    try {
      return tradeDoor(typedInput());
    } catch {
      return null;
    }
  })();
  const editedTransactionId = editing?.transactionId ?? null;
  const saved = useSetAsideChoiceOf(editedTransactionId);
  const setAside = useSetAside(door, { excludeTransactionId: editedTransactionId, initial: saved.data ?? null });

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Enter submits too: the question is a condition on it.
    if (!tradeFormReady(setAside.ready, waitingForPosted)) return;
    setError(null);
    setBusy(true);
    try {
      const typed = typedInput();
      const ratesToBase = await tradeRatesForSave({
        database, ws, input: typed, holdingCurrency: currency, cashCurrency,
        needsRate, manualRate, resolveRates, onMissing: setNeedsRate, where: 'Rate that day',
      });
      // The answer still goes with every save — an edit explicitly, so a question no longer asked clears the old one.
      const input = { ...typed, ratesToBase, templateId: templateId ?? null, setAside: setAside.choice };
      const result = editing ? await replaceTrade(database, ws, editing.id, input) : await recordTrade(database, ws, input);
      await invalidate();
      const changed = result.recalculatedSells.length;
      onSaved(changed === 0 ? 'Recorded.' : `Recorded. ${changed === 1 ? '1 later sell was' : `${changed} later sells were`} worked out again at the new average cost.`);
      setDraft({ ...emptyTradeDraft(draft.accountId, draft.cashAccountId, today) });
      setCharged('');
      setManualRate('');
      setNeedsRate(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const amountLabel =
    draft.kind === 'buy' ? `What it cost, before fees (${currency})` : draft.kind === 'sell' ? `Proceeds, before fees (${currency})` : `Amount before tax (${currency})`;
  const where = cashAccount?.name ?? 'the account';

  return (
    <form onSubmit={submit} className="flex flex-col gap-[10px]">
      {/* Option B: one card holding every row of the trade, as the Add Transaction card's Buy / sell tab draws it. */}
      <FormRows>
        <SelectRow label="What happened" value={draft.kind} onChange={(e) => change({ kind: e.target.value as TradeKind })}>
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </SelectRow>
        <SelectRow label="Holding" value={draft.accountId} onChange={(e) => change({ accountId: e.target.value })}>
          {holdings.map((row) => (
            <option key={row.accountId} value={row.accountId}>
              {row.name}
            </option>
          ))}
        </SelectRow>
        {draft.kind !== 'unit_change' && (
          // The row carries no label of its own, as the Add Transaction card's amount row does not: the placeholder says what it is.
          <MoneyRow label={amountLabel} currency={currency} value={draft.gross} onChange={(gross) => change({ gross })} placeholder={amountLabel.replace(/ \(.*\)$/, '')} />
        )}
        {draft.kind !== 'income' && (
          <InputRow
            label="Units, shares or grams"
            hint={position ? `You hold ${(position.unitsMicro / 1_000_000).toLocaleString('id-ID')}` : undefined}
            value={draft.units}
            onChange={(e) => change({ units: e.target.value })}
            inputMode="decimal"
            placeholder="2"
          />
        )}
        {draft.kind !== 'unit_change' && draft.kind !== 'income' && (
          <InputRow label={`Fee (${currency})`} value={draft.fee} onChange={(e) => change({ fee: e.target.value })} inputMode="decimal" />
        )}
        {draft.kind !== 'unit_change' && (
          <InputRow label={`Tax withheld (${currency})`} value={draft.tax} onChange={(e) => change({ tax: e.target.value })} inputMode="decimal" />
        )}
        <SelectRow
          label="Money account"
          hint="Opening balance is for holdings you owned before using this app."
          value={draft.cashAccountId}
          onChange={(e) => {
            change({ cashAccountId: e.target.value });
            // What was charged was charged to the account it was typed against.
            setCharged('');
          }}
        >
          {cashAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
          <option value="">Opening balance</option>
        </SelectRow>
        {asksCharged && (
          <div>
            <MoneyRow
              label={`Charged in ${cashCurrency}`}
              caption={`Charged in ${cashCurrency}`}
              currency={cashCurrency}
              value={charged}
              onChange={setCharged}
              placeholder="0"
              divided
            />
            <p className="pr-[13px] pb-2 pl-[54px] text-[12px] leading-4 text-[var(--ph-ink-3)]">
              {draft.kind === 'buy'
                ? `What left ${where}, in ${cashCurrency}.`
                : nothingReaches
                  ? `Nothing reaches ${where}: the fees take all of the sale, so leave this empty.`
                  : `What reached ${where}, in ${cashCurrency}.`}
            </p>
          </div>
        )}
        <InputRow label="Date" type="date" value={draft.occurredOn} max={today} onChange={(e) => change({ occurredOn: e.target.value })} />
      </FormRows>

      {(price !== null && draft.kind !== 'income') || sell ? (
        <RowHint id={hintId}>
          {price !== null && draft.kind !== 'income' && <>That is {formatPriceMicro(price, currency)} per unit. </>}
          {sell && (
            <>
              Gives up <Money minor={sell.basisMinor} currency={currency} /> of cost, so the gain is <Money minor={sell.realizedMinor} currency={currency} tone="auto" />.
            </>
          )}
        </RowHint>
      ) : null}

      {/* The second card, as on the Add Transaction card: the goal, and the rate when the save could not find one. */}
      {(draft.kind === 'buy' || draft.kind === 'sell' || needsRate) && (
        <FormRows>
          {(draft.kind === 'buy' || draft.kind === 'sell') && (
            <SelectRow
              label={draft.kind === 'sell' ? 'Sell from goal' : 'For goal'}
              hint={draft.kind === 'sell' ? 'Units come out of this goal only.' : 'Each purchase can fund a different goal.'}
              value={draft.goalId}
              onChange={(e) => change({ goalId: e.target.value })}
            >
              <option value="">No goal</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                </option>
              ))}
            </SelectRow>
          )}
          {needsRate && (
            <InputRow
              label="Rate that day"
              hint={ratePreview(manualRate, needsRate, ws.baseCurrency) ?? `${ws.baseCurrency} per 1 ${needsRate}`}
              value={manualRate}
              onChange={(e) => setManualRate(e.target.value)}
              inputMode="decimal"
            />
          )}
        </FormRows>
      )}

      {setAside.node}

      {/* The dock: the error, then Cancel beside the pill that saves, as the Add Transaction card ends. */}
      <div className="flex flex-col gap-2 pt-1">
        <ErrorBox error={error} />
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="ph-focus min-h-11 shrink-0 rounded-full px-4 text-[15px] text-[var(--ph-ink-2)] active:bg-[var(--ph-fill)]"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !tradeFormReady(setAside.ready, waitingForPosted)}
            className="ph-focus min-h-11 flex-1 rounded-full bg-[var(--ph-tint)] text-[15px] font-semibold text-[var(--ph-surface)] disabled:opacity-50"
          >
            {editing ? 'Save changes' : 'Record'}
          </button>
        </div>
      </div>
    </form>
  );
}
