import { formatMinor, formatUnits, fundBuy, fundSell, fundUnitsText, isoDate, moneySellBasis, type Position, sellBasisMinor } from '@expanses/core';
import type { RecordTradeInput } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup } from '../../ui/native';
import { FigureRow } from '../transactions/AmountRow';
import { pastWord, payRowText } from '../transactions/buy-rows';
import { DateRow } from '../transactions/CardRows';
import { FormRows } from '../transactions/FormRow';
import { TradeHoldingRow, TradeMoneyRow } from '../transactions/TradeRows';
import { currencyFlag } from '../transactions/tx-form';
import { keepsAll } from './sell-all';
import { typedAmount } from './trade-form';
import { CashSheet, ResultRow, SheetTradeDetails, signedMinor, typedMinor, useCashSide, useTradeDetails, useTradeSave } from './trade-sheet-parts';

const BUY_INFO =
  "Units = amount ÷ NAV. An order placed before 13:00 WIB gets that day's NAV, published in the evening; after 13:00, the next business day's. If the fund app confirms a slightly different number, correct it on the trade. A fee in the details is added to the cost, not taken from the units.";
const MONEY_SELL_INFO =
  "A sell takes out the same share of the money put in as it takes of the fund's value; the rest is gain. All takes everything.";
const SELL_INFO =
  "All sells every unit; its value is then units × NAV rather than a typed amount. A money market fund usually pays out within a few business days.";

/**
 * Buy or Sell of a mutual fund (reksadana) from its own page, in Trade's rows (owner, 13 Nov 2026): the account it
 * comes from or goes to, an amount of money, the fund and the day; the units it comes to at the last NAV are worked out, to four
 * places. No fee unless one is typed in the details. A sell can take All, which sells every unit so the holding ends at
 * zero. "Add more details" opens a second box under the first, in the same sheet: a fee, tax withheld, the goal, and the
 * rate that day for an account in another currency. Recorded by `recordTrade`, as the full form records it.
 */
export function FundTradeSheet({
  kind,
  holding,
  icon,
  lastPrice,
  position,
  defaultCashId,
  onClose,
  byMoney = null,
}: {
  kind: 'buy' | 'sell';
  holding: { accountId: string; name: string; currency: string };
  icon: ReactNode;
  lastPrice: { priceMicro: number; onDate: string } | null;
  position: Position | undefined;
  /** The account the fund's money normally comes from and goes to: the broker or fund app it is kept at. */
  defaultCashId: string | null;
  onClose: () => void;
  /**
   * A fund tracked by money (spec 2026-10-19-fund-by-amount): what it is worth now. Buy and sell are amounts alone, no
   * NAV and no units; a sell can take up to the value, and All takes all of it.
   */
  byMoney?: { valueMinor: number } | null;
}) {
  const today = isoDate();
  const currency = holding.currency;
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [occurredOn, setOccurredOn] = useState(today);
  const [picking, setPicking] = useState(false);
  const side = useCashSide(defaultCashId, kind);
  const heldMicro = position?.unitsMicro ?? 0;
  const priceMicro = lastPrice?.priceMicro ?? null;
  const amountMinor = typedMinor(amount, currency);

  const moneyGross = byMoney ? (kind === 'sell' && all ? byMoney.valueMinor : amountMinor) : null;
  const buy = byMoney
    ? kind === 'buy' && moneyGross !== null && moneyGross > 0 ? { unitsMicro: 0, grossMinor: moneyGross } : null
    : kind === 'buy' ? fundBuy({ amountMinor, priceMicro }) : null;
  const sell = byMoney
    ? kind === 'sell' && moneyGross !== null && moneyGross > 0 ? { unitsMicro: 0, grossMinor: moneyGross, tooMany: moneyGross > byMoney.valueMinor } : null
    : kind === 'sell' ? fundSell({ amountMinor, all, priceMicro, heldMicro }) : null;
  const trade = buy ?? (sell && !sell.tooMany ? sell : null);
  const typedInput: RecordTradeInput | null =
    trade && occurredOn <= today && side.ready
      ? { accountId: holding.accountId, kind, occurredOn, unitsMicro: trade.unitsMicro, grossMinor: trade.grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: side.cashAccountId, goalId: null }
      : null;
  const cashCurrency = side.cashAccount?.currency ?? undefined;
  const details = useTradeDetails({ holdingCurrency: currency, card: side.isCard && kind === 'buy', cashCurrency, byMoney: byMoney !== null });
  const { input, problem } = details.apply(typedInput);
  const saving = useTradeSave({ input, holdingCurrency: currency, cashCurrency, details, onDone: onClose });
  // The fee comes off the gain, as the ledger books it; tax withheld is filed as tax, not taken from the gain.
  const gain =
    kind === 'sell' && position && sell && !sell.tooMany
      ? sell.grossMinor -
        (input?.feeMinor ?? 0) -
        (byMoney ? moneySellBasis(position.costMinor, byMoney.valueMinor, sell.grossMinor) : sellBasisMinor(position, sell.unitsMicro))
      : null;

  // All shows what it sells for; typing an amount again turns All off.
  const shownAmount = all && sell ? typedAmount(sell.grossMinor, currency) : amount;
  const worked = buy ?? sell;

  return (
    <Sheet
      grouped
      tall
      expanded={details.open}
      title={kind === 'buy' ? 'Buy' : 'Sell'}
      onClose={onClose}
      confirm={{ label: kind === 'buy' ? 'Record buy' : 'Record sell', disabled: !saving.canSave, run: () => void saving.save() }}
    >
      <div className="mb-[18px] flex flex-col gap-[10px]">
        {/* Trade's rows (owner, 13 Nov 2026): Paid with, the amount with All on a sell, the fund, the day. A fund is
            bought by money, so there is no units row: what the amount comes to at the NAV is worked out under it. */}
        <FormRows>
          <TradeMoneyRow kind={kind} value={side.past ? pastWord(kind) : (side.cashAccount?.name ?? '')} onClick={() => setPicking(true)} />
          <FigureRow
            field={{ which: 'amount', label: 'Amount', value: shownAmount, currency }}
            flag={currencyFlag(currency)}
            invalid={Boolean(sell?.tooMany)}
            onChange={(text) => {
              // Leaving the row writes All's own figure back, tidied: still All, so every unit is still sold.
              if (keepsAll(all, text, all && sell ? sell.grossMinor : null, currency)) return;
              setAll(false);
              setAmount(text);
            }}
            pill={
              kind === 'sell'
                ? {
                    label: 'All',
                    on: all,
                    run: () => {
                      setAll((was) => !was);
                      setAmount('');
                    },
                  }
                : undefined
            }
          />
          <TradeHoldingRow glyph={icon} name={holding.name} />
          <DateRow on={occurredOn} onChange={setOccurredOn} max={today} />
        </FormRows>

        <SheetTradeDetails
          past={{ on: side.past, set: side.setPast }}
          kind={kind}
          details={details}
          currency={currency}
          whole={byMoney ? (worked ? typedAmount(worked.grossMinor, currency) : '') : worked ? formatUnits(worked.unitsMicro) : ''}
          byMoney={byMoney !== null}
          unitLabel="units"
          problem={problem}
          {...(side.isCard && kind === 'buy' ? { points: { accounts: side.accounts } } : {})}
        />
      </div>

      {worked && byMoney && gain !== null && (
        <InsetGroup>
          <ResultRow
            testId="fund-gain"
            label="Gain"
            info={MONEY_SELL_INFO}
            value={signedMinor(gain, currency)}
            valueClass={gain > 0 ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]'}
          />
        </InsetGroup>
      )}
      {worked && byMoney && sell?.tooMany && (
        <InsetGroup footer="A sell can take up to what the fund is worth. If the fund app shows more, update its value first.">
          <ResultRow testId="fund-worth" label="Worth" value={formatMinor(byMoney.valueMinor, currency)} />
        </InsetGroup>
      )}

      {worked && !byMoney && (
        <InsetGroup footer={sell?.tooMany ? `More than the ${fundUnitsText(heldMicro)} units held` : undefined}>
          <ResultRow
            testId="fund-units"
            label={kind === 'buy' ? 'Units' : 'Units sold'}
            info={kind === 'buy' ? BUY_INFO : SELL_INFO}
            value={`≈ ${fundUnitsText(worked.unitsMicro)}`}
          />
          {gain !== null && (
            <ResultRow
              testId="fund-gain"
              label="Gain"
              value={signedMinor(gain, currency)}
              valueClass={gain > 0 ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]'}
            />
          )}
        </InsetGroup>
      )}

      {saving.setAside.node}
      <ErrorBox error={saving.error} />
      {picking && <CashSheet title={payRowText(kind).label} side={side} onClose={() => setPicking(false)} />}
    </Sheet>
  );
}
