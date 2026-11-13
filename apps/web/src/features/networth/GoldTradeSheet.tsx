import { formatUnits, goldBarSizes, goldGainMinor, goldSellGrams, gramsText, isoDate, type Position, typedGramsMicro } from '@expanses/core';
import type { RecordTradeInput } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { ErrorBox, RowHint } from '../../ui';
import { InsetGroup } from '../../ui/native';
import { KeyboardStrip } from '../../ui/native/KeyboardStrip';
import { FigureRow } from '../transactions/AmountRow';
import { pastWord, payRowText } from '../transactions/buy-rows';
import { DateRow } from '../transactions/CardRows';
import { FormRows } from '../transactions/FormRow';
import { TradeHoldingRow, TradeMoneyRow, TradeUnitsRow } from '../transactions/TradeRows';
import { currencyFlag } from '../transactions/tx-form';
import { CashSheet, ResultRow, SheetTradeDetails, signedMinor, typedMinor, useCashSide, useTradeDetails, useTradeSave } from './trade-sheet-parts';

/**
 * Buy or Sell of gold bars from their own page, in Trade's rows (owner, 13 Nov 2026): the account, the receipt's
 * total, the holding, its grams and the day. While Grams is being typed on a phone the brand's bar sizes ride above the keyboard, one tap
 * each. A sell can take All, every gram, so the holding ends at exactly 0 g, and shows its gain against the average
 * cost. "Add more details" opens a second box under the first, in the same sheet: a fee, tax withheld, the goal, and
 * the rate that day for an account in another currency. Recorded by `recordTrade`, as the full form records it.
 */
export function GoldTradeSheet({
  kind,
  holding,
  icon,
  position,
  onClose,
}: {
  kind: 'buy' | 'sell';
  holding: { accountId: string; name: string; currency: string };
  icon: ReactNode;
  /** The last price saved; the sheet names the holding alone now, so it is not drawn. */
  lastPrice: { priceMicro: number; onDate: string } | null;
  position: Position | undefined;
  onClose: () => void;
}) {
  const today = isoDate();
  const currency = holding.currency;
  const [grams, setGrams] = useState('');
  const [all, setAll] = useState(false);
  const [money, setMoney] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [picking, setPicking] = useState(false);
  const [typingGrams, setTypingGrams] = useState(false);
  const side = useCashSide(null, kind);
  const heldMicro = position?.unitsMicro ?? 0;
  const moneyMinor = typedMinor(money, currency);
  const typed = typedGramsMicro(grams);

  const sold = kind === 'sell' ? goldSellGrams({ typedMicro: typed, all, heldMicro }) : null;
  const unitsMicro = kind === 'buy' ? typed : sold && !sold.tooMany ? sold.unitsMicro : null;
  const typedInput: RecordTradeInput | null =
    unitsMicro && moneyMinor && occurredOn <= today && side.ready
      ? { accountId: holding.accountId, kind, occurredOn, unitsMicro, grossMinor: moneyMinor, feeMinor: 0, taxMinor: 0, cashAccountId: side.cashAccountId, goalId: null }
      : null;
  const cashCurrency = side.cashAccount?.currency ?? undefined;
  const details = useTradeDetails({ holdingCurrency: currency, card: side.isCard && kind === 'buy', cashCurrency });
  const { input, problem } = details.apply(typedInput);
  const saving = useTradeSave({ input, holdingCurrency: currency, cashCurrency, details, onDone: onClose });
  // The fee comes off the gain, as the ledger books it; tax withheld is filed as tax, not taken from the gain.
  const gain = kind === 'sell' && position && unitsMicro && moneyMinor ? goldGainMinor(position, unitsMicro, moneyMinor - (input?.feeMinor ?? 0)) : null;

  const shownGrams = all ? formatUnits(heldMicro) : grams;
  const sizes = goldBarSizes(holding.name);
  const pickSize = (size: number) => {
    setAll(false);
    setGrams(gramsText(size));
  };

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
        {/* Trade's rows (owner, 13 Nov 2026): Paid with, the receipt's total, the holding, Grams, the day. */}
        <FormRows>
          <TradeMoneyRow kind={kind} value={side.past ? pastWord(kind) : (side.cashAccount?.name ?? '')} onClick={() => setPicking(true)} />
          <FigureRow field={{ which: 'amount', label: kind === 'buy' ? 'Total paid' : 'Received', value: money, currency }} flag={currencyFlag(currency)} onChange={setMoney} />
          <TradeHoldingRow glyph={icon} name={holding.name} />
          <TradeUnitsRow
            label="Grams"
            value={shownGrams}
            onChange={(text) => {
              setAll(false);
              setGrams(text.replace(/[^\d.,]/g, ''));
            }}
            onFocus={() => setTypingGrams(true)}
            onBlur={() => setTypingGrams(false)}
            invalid={Boolean(sold?.tooMany)}
            pill={
              kind === 'sell'
                ? {
                    label: 'All',
                    on: all,
                    run: () => {
                      setAll((was) => !was);
                      setGrams('');
                    },
                  }
                : undefined
            }
          />
          <DateRow on={occurredOn} onChange={setOccurredOn} max={today} />
        </FormRows>
        {sold?.tooMany && <RowHint>{`More than the ${formatUnits(heldMicro)} g held`}</RowHint>}

        <SheetTradeDetails
          past={{ on: side.past, set: side.setPast }}
          kind={kind}
          details={details}
          currency={currency}
          whole={unitsMicro ? formatUnits(unitsMicro) : ''}
          unitLabel="g"
          problem={problem}
          {...(side.isCard && kind === 'buy' ? { points: { accounts: side.accounts } } : {})}
        />
      </div>

      {gain !== null && (
        <InsetGroup>
          <ResultRow testId="gold-gain" label="Gain" value={signedMinor(gain, currency)} valueClass={gain > 0 ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]'} />
        </InsetGroup>
      )}

      {saving.setAside.node}
      <ErrorBox error={saving.error} />
      {typingGrams && (
        <KeyboardStrip
          label="Bar sizes"
          scroll
          cells={sizes.map((size) => ({ key: String(size), label: `${gramsText(size)} g`, title: gramsText(size), detail: 'g', onPick: () => pickSize(size) }))}
        />
      )}
      {picking && <CashSheet title={payRowText(kind).label} side={side} onClose={() => setPicking(false)} />}
    </Sheet>
  );
}
