import { averagePriceMicro, formatMinor, formatUnits, groupTypedAmount, idxCharge, idxTickSize, isIdxTick, isoDate, parseMajor, type Position, sellBasisMinor, stepIdxPrice } from '@expanses/core';
import { chargedAtBrokerOn, type RecordTradeInput, type SecurityRow } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { canTradeCashWith } from '../../lib/account-types';
import { moneyHolders, useAccounts } from '../../lib/queries';
import { useTrades } from './queries';
import { tradeCashDefault } from './trade-cash-default';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { dayLabel } from './asset-page';
import { useBrokerFees } from './BrokerFeesGroup';
import { feeRowText, lotsText, workedOut } from './listed-trade-model';
import { AmountRow, FeeRow, FigureRow, GoalBox, ReadRow, RecordRow, StepBar, TapRow } from './listed-trade-parts';
import { CardPointsBox, useTradeDetails, useTradeSave } from './trade-sheet-parts';

/** IDX trades in lots of 100 shares. */
const IDX_LOT = 100;

/** A whole-rupiah price as the box shows it: 6.150. */
const priceText = (price: number) => price.toLocaleString('id-ID', { maximumFractionDigits: 0 });

/** The typed price in whole rupiah, or null while it is not one. */
function typedPrice(text: string): number | null {
  try {
    const price = parseMajor(text, 'IDR');
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Buy or Sell of a listed IDX share, from its own page. The first box: the stock, the price on IDX's tick, whole lots,
 * the day and a past trade; Price and Lots are plain rows that are typed in when tapped, with a − / + bar over the
 * keyboard. A box for the goal (and the day's rate), then the total worked out from the broker's fees — what leaves
 * its cash account on a buy, what reaches it on a sell, with the gain on the lots sold — whose fee row folds open into
 * a fee and a tax in rupiah in place of the worked-out ones. The last box records, by `recordTrade`.
 */
export function ListedTradeSheet({
  kind,
  holding,
  security,
  lastPrice,
  position,
  brokerAccountId,
  onClose,
}: {
  kind: 'buy' | 'sell';
  holding: { accountId: string; name: string; currency: string };
  security: SecurityRow;
  lastPrice: { priceMicro: number; onDate: string } | null;
  position: Position | undefined;
  brokerAccountId: string | null;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const today = isoDate();
  const lotSize = security.lotSize ?? IDX_LOT;
  const lastRupiah = lastPrice ? Math.round(lastPrice.priceMicro / 1_000_000) : null;
  const [price, setPrice] = useState(lastRupiah && isIdxTick(lastRupiah) ? priceText(lastRupiah) : '');
  const [lots, setLots] = useState(1);
  const [occurredOn, setOccurredOn] = useState(today);
  // The field being typed in, which the bar over the keyboard steps.
  const [editing, setEditing] = useState<'price' | 'lots' | null>(null);
  const [feeOpen, setFeeOpen] = useState(false);
  // With no broker named, the cash side is asked for, from the accounts the full form offers.
  const cashChoices = moneyHolders(accounts.data ?? []).filter((account) => canTradeCashWith(account, kind));
  const [picked, setPicked] = useState('');
  // Owned before the app: recorded against Opening Balances, so neither the broker's cash nor any account moves.
  const [past, setPast] = useState(false);
  // The broker's cash when one is named; else the account picked, else the one the last buy or sell used, else none —
  // never the first account by itself (owner, 25 Nov 2026).
  const trades = useTrades(holding.accountId);
  const cashAccountId = past ? '' : (brokerAccountId ?? (picked || tradeCashDefault({ choices: cashChoices, trades: trades.data ?? [] }) || ''));
  const cashAccount = past ? undefined : (accounts.data ?? []).find((account) => account.id === cashAccountId);

  const fees = useBrokerFees(brokerAccountId);
  const chargedToday = useQuery({
    queryKey: ['broker-charged', ws.workspaceId, brokerAccountId, occurredOn],
    queryFn: () => chargedAtBrokerOn(database, ws, brokerAccountId!, occurredOn),
    enabled: brokerAccountId !== null,
  });
  // No broker, no broker's fees: the common 0,15% / 0,25%.
  const rates = brokerAccountId ? fees.data : { buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null };

  const rupiah = typedPrice(price);
  const onTick = rupiah !== null && isIdxTick(rupiah);
  const heldLots = Math.floor((position?.unitsMicro ?? 0) / (lotSize * 1_000_000));
  const shares = lots * lotSize;
  const unitsMicro = shares * 1_000_000;
  const grossMinor = onTick ? rupiah * shares : 0;
  const charge =
    onTick && rates && (brokerAccountId === null || chargedToday.data !== undefined)
      ? idxCharge({ kind, grossMinor, fees: rates, etf: security.kind === 'etf', chargedTodayMinor: chargedToday.data ?? 0 })
      : null;
  // A past trade starts with no fee: the broker's rates are for a trade made today. A fee typed below still replaces it.
  const worked = onTick ? workedOut(past, charge) : null;
  const tooMany = kind === 'sell' && lots > heldLots;
  // The worked-out fee and tax go on the trade; a fee or tax typed under the fee row takes their place.
  const typedInput: RecordTradeInput | null =
    worked && !tooMany && lots >= 1 && occurredOn <= today && (past || cashAccountId)
      ? { accountId: holding.accountId, kind, occurredOn, unitsMicro, grossMinor, feeMinor: worked.feeMinor, taxMinor: worked.taxMinor, cashAccountId, goalId: null }
      : null;
  const cashCurrency = cashAccount?.currency ?? undefined;
  const onCard = kind === 'buy' && cashAccount?.subtype === 'credit_card';
  const details = useTradeDetails({ holdingCurrency: holding.currency, cashCurrency, card: onCard });
  const { input, problem } = details.apply(typedInput);
  const saving = useTradeSave({ input, holdingCurrency: holding.currency, cashCurrency, details, onDone: onClose });
  const sold = kind === 'sell' && position && !tooMany && lots >= 1 ? { basis: sellBasisMinor(position, unitsMicro), average: averagePriceMicro(position) } : null;

  const step = (direction: 1 | -1) => {
    const from = rupiah ?? lastRupiah ?? 0;
    if (from <= 0 && direction === -1) return;
    setPrice(priceText(from <= 0 ? 1 : stepIdxPrice(from, direction)));
  };
  // What the total box reads: the trade as it will be recorded, the typed fee and tax included.
  const feeMinor = input?.feeMinor ?? worked?.feeMinor ?? 0;
  const taxMinor = input?.taxMinor ?? worked?.taxMinor ?? 0;
  const charged = feeMinor + taxMinor;
  const totalMinor = kind === 'buy' ? grossMinor + charged : grossMinor - charged;
  const typedCharge = details.draft.fee.trim() !== '' || details.draft.tax.trim() !== '';
  const taxApplies = kind === 'sell' && (past || charge === null || charge.taxMinor > 0 || details.draft.tax.trim() !== '');
  const tickNow = rupiah ?? lastRupiah;
  const minimumNote = !typedCharge && !past && charge?.minimumApplied && rates?.minDailyMinor ? `Minimum fee ${formatMinor(rates.minDailyMinor, 'IDR')} a day applies` : undefined;
  const amountWord = past ? 'None' : 'Automatic';
  const gainMinor = sold ? grossMinor - feeMinor - sold.basis : 0;

  return (
    <Sheet grouped tall closeOnly expanded={feeOpen} title={kind === 'buy' ? 'Buy' : 'Sell'} onClose={onClose}>
      <InsetGroup
        footer={
          !onTick && price.trim() !== ''
            ? `IDX prices move in steps of ${rupiah ? idxTickSize(Math.floor(rupiah)) : 1} at this price`
            : tooMany
              ? `Held: ${heldLots} ${heldLots === 1 ? 'lot' : 'lots'}; cannot sell more than that`
              : undefined
        }
      >
        <ReadRow label="Stock" value={security.ticker ? `${security.ticker} · ${security.name}` : security.name} />
        <TapRow
          label="Price"
          info={`${lastPrice && lastRupiah !== null ? `Last close ${priceText(lastRupiah)} · ${dayLabel(lastPrice.onDate)}` : 'No price yet'}${tickNow && tickNow > 0 ? ` · IDX prices move in steps of ${idxTickSize(Math.floor(tickNow))} at this price` : ''}`}
          shown={price}
          raw={price}
          onType={setPrice}
          onEdit={(on) => setEditing((now) => (on ? 'price' : now === 'price' ? null : now))}
          invalid={price.trim() !== '' && !onTick}
        />
        <TapRow
          label="Lots"
          info={`1 lot is ${lotSize.toLocaleString('id-ID')} ${lotSize === 1 ? 'share' : 'shares'}${kind === 'sell' ? ` · Held: ${heldLots} ${heldLots === 1 ? 'lot' : 'lots'}` : ''}`}
          shown={lotsText(lots, lotSize)}
          raw={lots > 0 ? String(lots) : ''}
          onType={(text) => setLots(Math.max(0, Math.floor(Number(text.replace(/\D/g, '')) || 0)))}
          onEdit={(on) => setEditing((now) => (on ? 'lots' : now === 'lots' ? null : now))}
          invalid={lots < 1 || tooMany}
        />
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
        <SwitchRow
          label={kind === 'buy' ? 'Past purchase' : 'Past sale'}
          checked={past}
          onChange={setPast}
          info={kind === 'buy' ? "Bought earlier, so no account's balance moves." : "Sold earlier, so no account's balance moves."}
        />
        {!brokerAccountId && !past ? (
          <SelectRow label={kind === 'buy' ? 'Paid from' : 'Paid into'} value={cashAccountId} onChange={(e) => setPicked(e.target.value)}>
            {cashAccountId === '' ? (
              <option value="" disabled>
                Account
              </option>
            ) : null}
            {cashChoices.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectRow>
        ) : null}
      </InsetGroup>

      <CardPointsBox details={details} accounts={accounts.data ?? []} show={onCard} />

      <GoalBox kind={kind} details={details} currency={holding.currency} whole={formatUnits(unitsMicro)} unitLabel="shares" baseCurrency={ws.baseCurrency} />

      {worked && (
        <InsetGroup footer={problem ?? undefined}>
          <FigureRow label="Value" testId="trade-value" value={formatMinor(grossMinor, 'IDR')} />
          <FeeRow
            label={kind === 'buy' ? 'Fee' : 'Fee and tax'}
            value={feeRowText({ past, typed: typedCharge, chargedMinor: charged, ratePpm: charge?.ratePpm ?? null, currency: 'IDR' })}
            open={feeOpen}
            onToggle={() => setFeeOpen((was) => !was)}
            info={minimumNote}
          />
          {feeOpen ? (
            <AmountRow
              label="Fee"
              value={details.draft.fee}
              onChange={(e) => details.change({ fee: groupTypedAmount(e.target.value, holding.currency) })}
              inputMode="numeric"
              placeholder={amountWord}
            />
          ) : null}
          {feeOpen && taxApplies ? (
            <AmountRow
              label="Tax withheld"
              value={details.draft.tax}
              onChange={(e) => details.change({ tax: groupTypedAmount(e.target.value, holding.currency) })}
              inputMode="numeric"
              placeholder={amountWord}
            />
          ) : null}
          <FigureRow
            label="Total"
            bold
            testId="trade-total"
            value={formatMinor(totalMinor, 'IDR')}
            valueClass={kind === 'buy' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]'}
          />
          {sold ? (
            <FigureRow
              label="Gain"
              testId="trade-gain"
              info={sold.average !== null ? `Bought at avg ${priceText(Math.round(sold.average / 1_000_000))}` : undefined}
              value={signed(gainMinor)}
              valueClass={gainMinor < 0 ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-up)]'}
            />
          ) : null}
        </InsetGroup>
      )}

      {saving.setAside.node}
      <ErrorBox error={saving.error} />
      <RecordRow label={kind === 'buy' ? 'Record buy' : 'Record sell'} disabled={!saving.canSave} onRecord={() => void saving.save()} />
      {/* Room for the bar over the keyboard, so the last box can be scrolled clear of it. */}
      {editing && <div aria-hidden style={{ height: 56 }} />}
      <StepBar
        open={editing !== null}
        label={editing === 'lots' ? 'lots' : 'price'}
        canDown={editing === 'lots' ? lots > 1 : (rupiah ?? 0) > 1}
        canUp={editing === 'lots' ? kind === 'buy' || lots < heldLots : true}
        onStep={editing === 'lots' ? (direction) => setLots((was) => Math.max(1, was + direction)) : step}
      />
    </Sheet>
  );
}

/** A gain with its sign, as the page writes one: +Rp 179.781, −Rp 12.000. */
const signed = (minor: number) => `${minor < 0 ? '−' : '+'}${formatMinor(Math.abs(minor), 'IDR')}`;
