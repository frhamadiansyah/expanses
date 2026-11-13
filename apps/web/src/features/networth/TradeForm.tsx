import { formatPriceMicro, isoDate, type Position, tradeCashMovedMinor, tradeRateNeeds } from '@expanses/core';
import { type AccountRow, type RecordTradeInput, recordTrade, replaceTrade, type TradeRow } from '@expanses/db';
import { type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview } from '../../lib/rates';
import { ErrorBox, Money, RowHint } from '../../ui';
import { InsetGroup } from '../../ui/native';
import { useSetAsideChoiceOf } from '../goals/queries';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { FigureRow } from '../transactions/AmountRow';
import { pastWord, payRowText, type TradeSide } from '../transactions/buy-rows';
import { DateRow } from '../transactions/CardRows';
import { FieldRow, FormRows } from '../transactions/FormRow';
import { PaymentSheet } from '../transactions/PaymentSheet';
import { DetailsToggle, TradeDetailRows, TradeHoldingRow, TradeMoneyRow, TradeTaxField, TradeUnitsRow } from '../transactions/TradeRows';
import { GoalParts } from './GoalParts';
import { SPLIT } from './goal-parts-form';
import { currencyFlag } from '../transactions/tx-form';
import { usePostedTradeMoney } from './queries';
import { draftToInput, emptyTradeDraft, prefillCharged, pricePreview, sellPreview, tradeFormReady, type TradeDraft, waitingForPostedMoney } from './trade-form';
import { tradeRatesForSave, withCharged } from './trade-money';
import { ResultRow } from './trade-sheet-parts';

export interface TradeFormProps {
  /** `byMoney`: a fund tracked by money, bought and sold by amount with its units optional. */
  holdings: { accountId: string; name: string; currency: string; byMoney?: boolean }[];
  goals: { id: string; name: string }[];
  cashAccounts: AccountRow[];
  positions: Record<string, Position>;
  /** Set when editing an existing trade; saving replaces it. */
  editing?: TradeRow | null;
  initial?: Partial<TradeDraft>;
  /** Set when the trade comes from a monthly buy, so the template counts as done this month. */
  templateId?: string | null;
  onSaved: (message: string) => void;
  /** The form element, so the sheet's ✓ can submit it: the trade has no Record button of its own any more. */
  formRef: RefObject<HTMLFormElement | null>;
  /** Whether the ✓ may be pressed now: told whenever it changes. */
  onReady: (ready: boolean) => void;
  /** The holding's kind, drawn in the holding row, and the word its units are counted in (Grams, Par value…). */
  glyph: ReactNode;
  unitLabel: string;
}

export function TradeForm({ holdings, goals, cashAccounts, positions, editing, initial, templateId, onSaved, formRef, onReady, glyph, unitLabel }: TradeFormProps) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const today = isoDate();
  const [draft, setDraft] = useState<TradeDraft>({
    ...emptyTradeDraft(holdings[0]?.accountId ?? '', cashAccounts[0]?.id ?? '', today),
    ...initial,
  });
  const [charged, setCharged] = useState('');
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  // Rates typed under "Rate that day", each kept under its own currency: the row moving on to another missing
  // currency never carries a figure typed for the last one (fix round 1).
  const [typedRates, setTypedRates] = useState<Record<string, string>>({});
  const manualRate = needsRate ? (typedRates[needsRate] ?? '') : '';
  const setManualRate = (typed: string) => {
    if (needsRate) setTypedRates((was) => ({ ...was, [needsRate]: typed }));
  };
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  // Fee, tax on a sell, the goal, a card's facts and a rate wait under Add more details, open from the start when an
  // edit or a prefill already carries something there, so nothing typed is ever out of sight.
  const [detailsOpen, setDetailsOpen] = useState(() => {
    const filled = (text: string | undefined) => !!text && text.trim() !== '' && !/^0([.,]0+)?$/.test(text.trim());
    return filled(initial?.fee) || (initial?.kind !== 'income' && filled(initial?.tax)) || !!initial?.goalId;
  });
  // The account a past trade had before the switch put it on Opening Balances, so switching back restores it.
  const beforePast = useRef('');

  const holding = holdings.find((row) => row.accountId === draft.accountId);
  const currency = holding?.currency ?? ws.baseCurrency;
  const position = positions[draft.accountId];
  const price = pricePreview(draft, currency);
  // A fund tracked by money gives up a share of its money in by value, worked out when saved: no unit-cost preview.
  const sell = holding?.byMoney ? null : sellPreview(draft, position, currency);
  const change = (patch: Partial<TradeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const cashAccount = cashAccounts.find((account) => account.id === draft.cashAccountId);
  // A credit card pays for a buy only; a sale, a payment or a change of units never names one.
  const cardPaid = draft.kind === 'buy' && cashAccount?.subtype === 'credit_card';
  const payers = cashAccounts.filter((account) => account.subtype !== 'credit_card' || draft.kind === 'buy');
  const allAccounts = useAccounts().data ?? [];
  // An opening position pays from Opening Balances, which moves in the holding's own currency.
  const cashCurrency = cashAccount ? (cashAccount.currency ?? ws.baseCurrency) : currency;
  const needs = tradeRateNeeds(currency, cashCurrency, ws.baseCurrency);
  const asksCharged = needs.charged && draft.kind !== 'unit_change';
  // A sell whose fees took all of it moves nothing through the account: no charged amount is needed, and the row says so.
  const nothingReaches = (() => {
    if (draft.kind === 'buy' || draft.kind === 'unit_change') return false;
    try {
      return tradeCashMovedMinor(draftToInput(draft, currency, today, holding?.byMoney, cardPaid)) === 0;
    } catch {
      return false;
    }
  })();
  /** What `submit` sends, before its rates: the one input the door, the question and the save all read. */
  const typedInput = (): RecordTradeInput => withCharged(draftToInput(draft, currency, today, holding?.byMoney, cardPaid), charged, currency, cashCurrency);

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
  // The same read gives back a card purchase's category and MCC, so an edit keeps what the points engine was told.
  const cardFilled = useRef(false);
  const postedCard = posted.data;
  useEffect(() => {
    if (cardFilled.current || !editing || !postedCard) return;
    cardFilled.current = true;
    setDraft((current) => ({ ...current, spendCategoryId: postedCard.spendCategoryId ?? '', mcc: postedCard.mcc ?? '' }));
  }, [editing, postedCard]);
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
        needsRate: null, manualRate: '', typedRates, resolveRates, onMissing: setNeedsRate, where: 'Rate that day',
      });
      // The answer still goes with every save — an edit explicitly, so a question no longer asked clears the old one.
      const input = { ...typed, ratesToBase, templateId: templateId ?? null, setAside: setAside.choice };
      const result = editing ? await replaceTrade(database, ws, editing.id, input) : await recordTrade(database, ws, input);
      await invalidate();
      const changed = result.recalculatedSells.length;
      onSaved(changed === 0 ? 'Recorded.' : `Recorded. ${changed === 1 ? '1 later sell was' : `${changed} later sells were`} worked out again at the new average cost.`);
      setDraft({ ...emptyTradeDraft(draft.accountId, draft.cashAccountId, today) });
      setCharged('');
      setTypedRates({});
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
  const side: TradeSide = draft.kind === 'buy' ? 'buy' : draft.kind === 'sell' ? 'sell' : 'income';
  const buyOrSell = draft.kind === 'buy' || draft.kind === 'sell';
  // What the ✓ answers: the same rule the Record button had, so every refusal still shows when it is pressed.
  const ready = !busy && tradeFormReady(setAside.ready, waitingForPosted);
  useEffect(() => onReady(ready), [onReady, ready]);
  const goPast = (on: boolean) => {
    if (on) {
      beforePast.current = draft.cashAccountId;
      change({ cashAccountId: '' });
    } else change({ cashAccountId: beforePast.current || (payers[0]?.id ?? '') });
    setCharged('');
  };
  const pickGoal = (goalId: string) =>
    change(
      goalId === SPLIT && draft.parts.length === 0
        ? { goalId: SPLIT, parts: [{ goalId: draft.goalId && draft.goalId !== SPLIT ? draft.goalId : (goals[0]?.id ?? ''), amount: '' }] }
        : { goalId },
    );
  const typedTax = draft.tax.trim() !== '' && !/^0([.,]0+)?$/.test(draft.tax.trim());
  const rateRow = needsRate ? (
    <FieldRow
      label="Rate that day"
      caption={`${ws.baseCurrency} per 1 ${needsRate}`}
      hint={ratePreview(manualRate, needsRate, ws.baseCurrency) ?? undefined}
      value={manualRate}
      onChange={setManualRate}
      inputMode="decimal"
      placeholder="Rate"
    />
  ) : null;
  // Add more details holds something for every kind with money; a change of units has none.
  const hasDetails = draft.kind !== 'unit_change';

  return (
    <form ref={formRef} onSubmit={submit} className="mb-[18px] flex flex-col gap-[10px]">
      {/*
        Trade's rows (owner, 13 Nov 2026): Paid with (Received into), the amount, the holding — fixed, it is this
        page's — the units it is counted in, the day. A payment has its tax on the card; a change of units has only
        the units and the day.
      */}
      <FormRows>
        {draft.kind !== 'unit_change' && (
          <TradeMoneyRow kind={side} value={draft.cashAccountId === '' ? pastWord(side) : (cashAccount?.name ?? '')} onClick={() => setPicking(true)} />
        )}
        {draft.kind !== 'unit_change' && (
          <FigureRow field={{ which: 'amount', label: amountLabel, value: draft.gross, currency }} flag={currencyFlag(currency)} onChange={(gross) => change({ gross })} />
        )}
        {asksCharged && (
          <FigureRow
            field={{ which: 'charged', label: `Charged in ${cashCurrency}`, value: charged, currency: cashCurrency }}
            flag={currencyFlag(cashCurrency)}
            clearLabel={`Clear charged in ${cashCurrency}`}
            onChange={setCharged}
          />
        )}
        <TradeHoldingRow glyph={glyph} name={holding?.name ?? ''} />
        {draft.kind !== 'income' && (
          <TradeUnitsRow label={unitLabel} value={draft.units} onChange={(units) => change({ units })} placeholder={holding?.byMoney ? 'Optional' : 'How many'} />
        )}
        {draft.kind === 'income' && <TradeTaxField label={`Tax withheld (${currency})`} value={draft.tax} onChange={(tax) => change({ tax })} />}
        <DateRow on={draft.occurredOn} onChange={(occurredOn) => change({ occurredOn })} max={today} />
      </FormRows>
      {/* Said only when it matters: a sale whose fees took all of it leaves nothing to type as charged. */}
      {asksCharged && nothingReaches && <RowHint>{`Nothing reaches ${where}: the fees take all of the sale, so leave this empty.`}</RowHint>}

      {(price !== null && draft.kind !== 'income') || sell ? (
        <InsetGroup>
          {price !== null && draft.kind !== 'income' ? <ResultRow testId="trade-price" label="Price a unit" value={formatPriceMicro(price, currency)} /> : null}
          {sell ? <ResultRow testId="trade-cost" label="Cost given up" value={<Money minor={sell.basisMinor} currency={currency} />} /> : null}
          {sell ? <ResultRow testId="trade-gain" label="Gain" value={<Money minor={sell.realizedMinor} currency={currency} tone="auto" />} /> : null}
        </InsetGroup>
      ) : null}

      {hasDetails && detailsOpen && (
        <FormRows>
          <TradeDetailRows
            kind={side}
            {...(buyOrSell ? { goal: { goals, value: draft.goalId, onPick: pickGoal, split: true } } : {})}
            {...(cardPaid
              ? {
                  points: {
                    accounts: allAccounts,
                    categoryId: draft.spendCategoryId,
                    mcc: draft.mcc,
                    onCategory: (spendCategoryId: string) => change({ spendCategoryId }),
                    onMcc: (mcc: string) => change({ mcc }),
                  },
                }
              : {})}
            {...(buyOrSell ? { fee: { label: `Fee (${currency})`, value: draft.fee, onChange: (fee: string) => change({ fee }) } } : {})}
            // Tax withheld is a sell's; a buy keeps one typed before in view, so it is never hidden.
            {...(draft.kind === 'sell' || (draft.kind === 'buy' && typedTax)
              ? { tax: { label: `Tax withheld (${currency})`, value: draft.tax, onChange: (tax: string) => change({ tax }) } }
              : {})}
            past={{
              label: pastWord(side),
              on: draft.cashAccountId === '',
              set: goPast,
              info: 'Owned before using this app, so no account’s balance moves.',
            }}
          >
            {rateRow}
          </TradeDetailRows>
        </FormRows>
      )}
      {/* A missing rate is asked for in view, whether or not the details are open. */}
      {(!hasDetails || !detailsOpen) && rateRow && <FormRows>{rateRow}</FormRows>}
      {buyOrSell && detailsOpen && draft.goalId === SPLIT && (
        <GoalParts
          parts={draft.parts}
          onChange={(parts) => change({ parts })}
          goals={goals}
          whole={holding?.byMoney ? draft.gross : draft.units}
          byMoney={!!holding?.byMoney}
          currency={currency}
          unitLabel="units"
        />
      )}
      {hasDetails && <DetailsToggle open={detailsOpen} onToggle={() => setDetailsOpen((open) => !open)} />}

      {setAside.node}
      <ErrorBox error={error} />

      {picking && (
        <PaymentSheet
          title={payRowText(side).label}
          options={payers.map((account) => ({ accountId: account.id, cardId: null, accountName: account.name, last4: null, holderName: null }))}
          accounts={allAccounts}
          chosenAccountId={draft.cashAccountId}
          onPick={(option) => {
            change({ cashAccountId: option.accountId });
            // What was charged was charged to the account it was typed against.
            setCharged('');
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </form>
  );
}
