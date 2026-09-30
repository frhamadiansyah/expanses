import { formatUnits, fundBuy, fundNavText, fundSell, fundUnitsText, groupTypedAmount, isoDate, type Position, sellBasisMinor } from '@expanses/core';
import type { RecordTradeInput } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, TextRow } from '../../ui/native';
import { dayLabel } from './asset-page';
import { type TradeDraft, typedAmount } from './trade-form';
import { CashRow, CashSheet, HoldingRow, MoreOptionsRow, ResultRow, signedMinor, TypedRow, typedMinor, useCashSide, useTradeSave } from './trade-sheet-parts';

const BUY_INFO =
  "Units = amount ÷ NAV. An order placed before 13:00 WIB gets that day's NAV, published in the evening; after 13:00, the next business day's. If the fund app confirms a slightly different number, correct it on the trade.";
const SELL_INFO =
  "All sells every unit; its value is then units × NAV rather than a typed amount. A reksadana gain isn't taxed for the holder (UU PPh Pasal 4(3) huruf i), but the fund still sits in the tax report's asset list. A money market fund usually pays out in T+1 to T+2; the law allows up to T+7.";

/**
 * Buy or Sell of a mutual fund (reksadana) from its own page, the way a fund app takes the order: an amount of money,
 * the account it comes from or goes to, and the day; the units it comes to at the last NAV are worked out, to four
 * places. No fee. A sell can take All, which sells every unit so the holding ends at zero. Recorded by `recordTrade`,
 * as the full form records it; More options opens that form with these figures in it.
 */
export function FundTradeSheet({
  kind,
  holding,
  icon,
  lastPrice,
  position,
  defaultCashId,
  onMore,
  onClose,
}: {
  kind: 'buy' | 'sell';
  holding: { accountId: string; name: string; currency: string };
  icon: ReactNode;
  lastPrice: { priceMicro: number; onDate: string } | null;
  position: Position | undefined;
  /** The account the fund's money normally comes from and goes to: the broker or fund app it is kept at. */
  defaultCashId: string | null;
  onMore: (initial: Partial<TradeDraft>) => void;
  onClose: () => void;
}) {
  const today = isoDate();
  const currency = holding.currency;
  const [amount, setAmount] = useState('');
  const [all, setAll] = useState(false);
  const [occurredOn, setOccurredOn] = useState(today);
  const [picking, setPicking] = useState(false);
  const side = useCashSide(defaultCashId);
  const heldMicro = position?.unitsMicro ?? 0;
  const priceMicro = lastPrice?.priceMicro ?? null;
  const amountMinor = typedMinor(amount, currency);

  const buy = kind === 'buy' ? fundBuy({ amountMinor, priceMicro }) : null;
  const sell = kind === 'sell' ? fundSell({ amountMinor, all, priceMicro, heldMicro }) : null;
  const trade = buy ?? (sell && !sell.tooMany ? sell : null);
  const input: RecordTradeInput | null =
    trade && occurredOn <= today && side.cashAccountId
      ? { accountId: holding.accountId, kind, occurredOn, unitsMicro: trade.unitsMicro, grossMinor: trade.grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: side.cashAccountId, goalId: null }
      : null;
  const saving = useTradeSave({ input, holdingCurrency: currency, cashCurrency: side.cashAccount?.currency ?? undefined, onDone: onClose });
  const gain = kind === 'sell' && position && sell && !sell.tooMany ? sell.grossMinor - sellBasisMinor(position, sell.unitsMicro) : null;

  const subtitle = [
    `${fundUnitsText(heldMicro)} units`,
    lastPrice ? `NAV ${fundNavText(lastPrice.priceMicro, currency)} · ${dayLabel(lastPrice.onDate)}` : 'No NAV yet',
  ].join(' · ');
  // All shows what it sells for; typing an amount again turns All off.
  const shownAmount = all && sell ? typedAmount(sell.grossMinor, currency) : amount;
  const worked = buy ?? sell;

  return (
    <Sheet
      grouped
      tall
      title={kind === 'buy' ? 'Buy' : 'Sell'}
      onClose={onClose}
      confirm={{ label: kind === 'buy' ? 'Record buy' : 'Record sell', disabled: !saving.canSave, run: () => void saving.save() }}
    >
      <InsetGroup>
        <HoldingRow icon={icon} name={holding.name} subtitle={subtitle} />
      </InsetGroup>

      <InsetGroup>
        <TypedRow
          label="Amount"
          value={shownAmount}
          onChange={(e) => {
            setAll(false);
            setAmount(groupTypedAmount(e.target.value, currency));
          }}
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          placeholder="Amount"
          aria-invalid={Boolean(sell?.tooMany)}
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
        <CashRow label={kind === 'buy' ? 'Paid from' : 'To'} side={side} onOpen={() => setPicking(true)} />
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
      </InsetGroup>

      {worked && (
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
              valueClass={gain > 0 ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-ink)]'}
            />
          )}
        </InsetGroup>
      )}

      {saving.setAside.node}
      <ErrorBox error={saving.error} />
      <InsetGroup>
        <MoreOptionsRow
          run={() =>
            onMore({
              kind,
              occurredOn,
              units: worked ? formatUnits(worked.unitsMicro) : '',
              gross: worked ? typedAmount(worked.grossMinor, currency) : '',
              fee: '0',
              tax: '0',
              cashAccountId: side.cashAccountId,
            })
          }
        />
      </InsetGroup>
      {picking && <CashSheet title={kind === 'buy' ? 'Paid from' : 'To'} side={side} onClose={() => setPicking(false)} />}
    </Sheet>
  );
}
