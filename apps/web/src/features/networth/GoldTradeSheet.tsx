import {
  averagePriceMicro, formatMinor, formatUnits, goldBarSizes, goldGainMinor, goldSellGrams, gramsText, groupTypedAmount, isoDate, type Position, typedGramsMicro,
} from '@expanses/core';
import type { RecordTradeInput } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, TextRow } from '../../ui/native';
import { KeyboardStrip } from '../../ui/native/KeyboardStrip';
import { dayLabel } from './asset-page';
import { type TradeDraft, typedAmount } from './trade-form';
import { CashRow, CashSheet, HoldingRow, MoreOptionsRow, ResultRow, signedMinor, TypedRow, typedMinor, useCashSide, useTradeSave } from './trade-sheet-parts';

const PAID_INFO =
  "Type the receipt's total, including any tax on it, so the cost is what actually left the account. The sizes above the keyboard are the brand's own bar sizes; any other weight can be typed.";
const RECEIVED_INFO =
  'Type what actually arrived, after any tax the buyer withheld. A buyback price is usually below the selling price, so a quick sale often shows a loss.';

/** A price per gram in whole minor units, as the holding line writes it: Rp 1.950.000/g. */
const perGram = (priceMicro: number, currency: string) => `${formatMinor(Math.round(priceMicro / 1_000_000), currency)}/g`;

/**
 * Buy or Sell of gold bars from their own page, as a dealer's receipt reads: grams, the total paid or received, the
 * account and the day. While Grams is being typed on a phone the brand's bar sizes ride above the keyboard, one tap
 * each. A sell can take All, every gram, so the holding ends at exactly 0 g, and shows its gain against the average
 * cost. Recorded by `recordTrade`, as the full form records it; More options opens that form with these figures in it.
 */
export function GoldTradeSheet({
  kind,
  holding,
  icon,
  lastPrice,
  position,
  onMore,
  onClose,
}: {
  kind: 'buy' | 'sell';
  holding: { accountId: string; name: string; currency: string };
  icon: ReactNode;
  lastPrice: { priceMicro: number; onDate: string } | null;
  position: Position | undefined;
  onMore: (initial: Partial<TradeDraft>) => void;
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
  const side = useCashSide(null);
  const heldMicro = position?.unitsMicro ?? 0;
  const moneyMinor = typedMinor(money, currency);
  const typed = typedGramsMicro(grams);

  const sold = kind === 'sell' ? goldSellGrams({ typedMicro: typed, all, heldMicro }) : null;
  const unitsMicro = kind === 'buy' ? typed : sold && !sold.tooMany ? sold.unitsMicro : null;
  const input: RecordTradeInput | null =
    unitsMicro && moneyMinor && occurredOn <= today && side.cashAccountId
      ? { accountId: holding.accountId, kind, occurredOn, unitsMicro, grossMinor: moneyMinor, feeMinor: 0, taxMinor: 0, cashAccountId: side.cashAccountId, goalId: null }
      : null;
  const saving = useTradeSave({ input, holdingCurrency: currency, cashCurrency: side.cashAccount?.currency ?? undefined, onDone: onClose });
  const gain = kind === 'sell' && position && unitsMicro && moneyMinor ? goldGainMinor(position, unitsMicro, moneyMinor) : null;

  const average = position ? averagePriceMicro(position) : null;
  const subtitle = [
    `${formatUnits(heldMicro)} g`,
    kind === 'buy'
      ? lastPrice
        ? `last ${perGram(lastPrice.priceMicro, currency)} · ${dayLabel(lastPrice.onDate)}`
        : 'no price yet'
      : average !== null
        ? `cost ${perGram(average, currency)}`
        : null,
  ]
    .filter(Boolean)
    .join(' · ');
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
      title={kind === 'buy' ? 'Buy' : 'Sell'}
      onClose={onClose}
      confirm={{ label: kind === 'buy' ? 'Record buy' : 'Record sell', disabled: !saving.canSave, run: () => void saving.save() }}
    >
      <InsetGroup>
        <HoldingRow icon={icon} name={holding.name} subtitle={subtitle} />
      </InsetGroup>

      <InsetGroup footer={sold?.tooMany ? `More than the ${formatUnits(heldMicro)} g held` : undefined}>
        <TypedRow
          label="Grams"
          value={shownGrams}
          onChange={(e) => {
            setAll(false);
            setGrams(e.target.value.replace(/[^\d.,]/g, ''));
          }}
          onFocus={() => setTypingGrams(true)}
          onBlur={() => setTypingGrams(false)}
          inputMode="decimal"
          placeholder="Grams"
          aria-invalid={Boolean(sold?.tooMany)}
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
        <TypedRow
          label={kind === 'buy' ? 'Total paid' : 'Received'}
          info={kind === 'buy' ? PAID_INFO : RECEIVED_INFO}
          value={money}
          onChange={(e) => setMoney(groupTypedAmount(e.target.value, currency))}
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          placeholder="Amount"
        />
        <CashRow label={kind === 'buy' ? 'Paid from' : 'To'} side={side} onOpen={() => setPicking(true)} />
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
      </InsetGroup>

      {gain !== null && (
        <InsetGroup>
          <ResultRow testId="gold-gain" label="Gain" value={signedMinor(gain, currency)} valueClass={gain > 0 ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-ink)]'} />
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
              units: kind === 'sell' && all ? formatUnits(heldMicro) : typed ? formatUnits(typed) : '',
              gross: moneyMinor ? typedAmount(moneyMinor, currency) : '',
              fee: '0',
              tax: '0',
              cashAccountId: side.cashAccountId,
            })
          }
        />
      </InsetGroup>
      {typingGrams && (
        <KeyboardStrip
          label="Bar sizes"
          scroll
          cells={sizes.map((size) => ({ key: String(size), label: `${gramsText(size)} g`, title: gramsText(size), detail: 'g', onPick: () => pickSize(size) }))}
        />
      )}
      {picking && <CashSheet title={kind === 'buy' ? 'Paid from' : 'To'} side={side} onClose={() => setPicking(false)} />}
    </Sheet>
  );
}
