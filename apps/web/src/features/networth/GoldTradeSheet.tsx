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
import { CardPointsBox, CashRow, CashSheet, HoldingRow, ResultRow, signedMinor, TradeDetails, TypedRow, typedMinor, useCashSide, useTradeDetails, useTradeSave } from './trade-sheet-parts';

const PAID_INFO =
  "The receipt's total, with any tax on it. A fee charged on top of it goes under Fee in the details; the cost is the two together, which is what left the account. The sizes above the keyboard are the brand's own bar sizes; any other weight can be typed.";
const RECEIVED_INFO =
  'What the sale brought. With no fee or tax in the details, that is what arrived; a fee or tax withheld typed there comes off it before it reaches the account. A buyback price is usually below the selling price, so a quick sale often shows a loss.';

/** A price per gram in whole minor units, as the holding line writes it: Rp 1.950.000/g. */
const perGram = (priceMicro: number, currency: string) => `${formatMinor(Math.round(priceMicro / 1_000_000), currency)}/g`;

/**
 * Buy or Sell of gold bars from their own page, as a dealer's receipt reads: grams, the total paid or received, the
 * account and the day. While Grams is being typed on a phone the brand's bar sizes ride above the keyboard, one tap
 * each. A sell can take All, every gram, so the holding ends at exactly 0 g, and shows its gain against the average
 * cost. "Add more details" opens a second box under the first, in the same sheet: a fee, tax withheld, the goal, and
 * the rate that day for an account in another currency. Recorded by `recordTrade`, as the full form records it.
 */
export function GoldTradeSheet({
  kind,
  holding,
  icon,
  lastPrice,
  position,
  onClose,
}: {
  kind: 'buy' | 'sell';
  holding: { accountId: string; name: string; currency: string };
  icon: ReactNode;
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
      expanded={details.open}
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

      <CardPointsBox details={details} accounts={side.accounts} show={side.isCard && kind === 'buy'} />

      <TradeDetails past={{ on: side.past, set: side.setPast }} kind={kind} details={details} currency={currency} emptyWord="None" whole={unitsMicro ? formatUnits(unitsMicro) : ''} unitLabel="g" problem={problem} />

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
      {picking && <CashSheet title={kind === 'buy' ? 'Paid from' : 'To'} side={side} onClose={() => setPicking(false)} />}
    </Sheet>
  );
}
