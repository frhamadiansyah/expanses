import { evaluateAmount, formatMinor, isFxLotAccount } from '@expanses/core';
import type { AccountRow, ForeignCostPreview } from '@expanses/db';
import { useApp } from '../../app/context';
import { useForeignCostPreview } from '../../lib/withdrawal-queries';
import { exchangeOutPreview, exchangeResultLine, type ExchangeResultLine, transferRateText } from '../../lib/withdrawal-rate';
import { useHeldRates } from '../accounts/queries';
import { amountFields, type FormDraft, receivedField } from './tx-form';

/*
 * A transfer between currencies before Save (withdrawal rate §7, ruling R15), for the Transfer tab and the Move screen
 * alike: the Rate row, and — out of a foreign pocket — what the money cost and the gain or loss Save will record.
 */

export interface TransferPreview {
  rateText: string | null;
  costText: string | null;
  result: ExchangeResultLine | null;
  /** Read at rates held for an earlier day: the save fetches the day's own, so this is an estimate. */
  stale: boolean;
  gainLossBaseMinor: number | null;
}

const NOTHING: TransferPreview = { rateText: null, costText: null, result: null, stale: false, gainLossBaseMinor: null };

export function transferPreviewOf(input: {
  fromMinor: number | null;
  fromCurrency: string;
  toMinor: number | null;
  toCurrency: string;
  fromHoldsLots: boolean;
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
  stale: boolean;
  cost: ForeignCostPreview | null;
}): TransferPreview {
  const { fromMinor, toMinor } = input;
  if (fromMinor === null || toMinor === null || fromMinor <= 0 || toMinor <= 0) return NOTHING;
  const rateText = transferRateText({ fromMinor, fromCurrency: input.fromCurrency, toMinor, toCurrency: input.toCurrency, baseCurrency: input.baseCurrency, ratesToBase: input.ratesToBase });
  if (!input.fromHoldsLots || !input.cost) return { ...NOTHING, rateText, stale: input.stale };
  const out = exchangeOutPreview({ costBaseMinor: input.cost.costBaseMinor, receivedMinor: toMinor, receivedCurrency: input.toCurrency, baseCurrency: input.baseCurrency, ratesToBase: input.ratesToBase });
  return {
    rateText,
    costText: input.cost.costBaseMinor === null ? null : formatMinor(input.cost.costBaseMinor, input.baseCurrency),
    result: out ? exchangeResultLine(out.gainLossBaseMinor, input.baseCurrency) : null,
    stale: input.stale,
    gainLossBaseMinor: out?.gainLossBaseMinor ?? null,
  };
}

/** The same, read from a transfer draft: the two figures by the readers the save uses (`amountFields`, `receivedField`). */
export function useTransferPreview(draft: FormDraft, accounts: readonly AccountRow[], editingId: string | null): TransferPreview {
  const { ws } = useApp();
  const from = accounts.find((a) => a.id === draft.moneyId);
  const received = receivedField(draft, accounts);
  const leaves = amountFields(draft, accounts, ws.baseCurrency).amount;
  const fromMinor = received ? evaluateAmount(leaves.value, leaves.currency) : null;
  const toMinor = received ? evaluateAmount(received.value, received.currency) : null;
  const held = useHeldRates(received && from?.currency ? [from.currency, received.currency] : [], draft.occurredOn);
  const rates = held.data?.rates ?? {};
  const fromHoldsLots = !!from && !!received && isFxLotAccount(from, ws.baseCurrency);
  const cost = useForeignCostPreview({
    accountId: fromHoldsLots ? from!.id : '',
    amountMinor: fromMinor,
    occurredOn: draft.occurredOn,
    excludeTransactionId: editingId,
    dayRate: from?.currency ? (rates[from.currency] ?? null) : null,
  });
  if (!received || !from?.currency) return NOTHING;
  return transferPreviewOf({
    fromMinor,
    fromCurrency: from.currency,
    toMinor,
    toCurrency: received.currency,
    fromHoldsLots,
    baseCurrency: ws.baseCurrency,
    ratesToBase: rates,
    stale: (held.data?.stale ?? []).length > 0,
    cost: cost.data ?? null,
  });
}
