import {
  averagePriceMicro, formatMinor, formatUnits, idxCharge, idxTickSize, isIdxTick, isoDate, parseMajor, type Position, ppmPercent, sellBasisMinor, stepIdxPrice,
} from '@expanses/core';
import { chargedAtBrokerOn, type RecordTradeInput, type SecurityRow } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, ROW_PAD_X, ROW_PAD_Y, SelectRow, TextRow } from '../../ui/native';
import { dayLabel } from './asset-page';
import { useBrokerFees } from './BrokerFeesGroup';
import { TradeDetails, useTradeDetails, useTradeSave } from './trade-sheet-parts';

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
 * Buy or Sell of a listed IDX share, from its own page: the price on IDX's tick with − / +, whole lots with − / +, the
 * day, and the total worked out from the broker's fees — what leaves its cash account on a buy, what reaches it on a
 * sell, with the gain on the lots sold. "Add more details" opens a second box under the first, in the same sheet: a fee
 * or tax in rupiah in place of the worked-out one, the goal, and the rate that day for an account in another currency.
 * Recorded by `recordTrade`, as the full form records it.
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
  // With no broker named, the cash side is asked for, from the accounts the full form offers.
  const cashChoices = moneyHolders(accounts.data ?? []).filter((account) => MONEY_SUBTYPES.includes(account.subtype));
  const [picked, setPicked] = useState('');
  const cashAccountId = brokerAccountId ?? (picked || cashChoices[0]?.id || '');
  const cashAccount = (accounts.data ?? []).find((account) => account.id === cashAccountId);

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
  const tooMany = kind === 'sell' && lots > heldLots;
  // The broker's worked-out fee and tax go on the trade; a fee or tax typed in the details takes their place.
  const typedInput: RecordTradeInput | null =
    charge && !tooMany && lots >= 1 && occurredOn <= today && cashAccountId
      ? { accountId: holding.accountId, kind, occurredOn, unitsMicro, grossMinor, feeMinor: charge.feeMinor, taxMinor: charge.taxMinor, cashAccountId, goalId: null }
      : null;
  const cashCurrency = cashAccount?.currency ?? undefined;
  const details = useTradeDetails({ holdingCurrency: holding.currency, cashCurrency });
  const { input, problem } = details.apply(typedInput);
  const saving = useTradeSave({ input, holdingCurrency: holding.currency, cashCurrency, details, onDone: onClose });
  const sold = kind === 'sell' && position && !tooMany && lots >= 1 ? { basis: sellBasisMinor(position, unitsMicro), average: averagePriceMicro(position) } : null;

  const step = (direction: 1 | -1) => {
    const from = rupiah ?? lastRupiah ?? 0;
    if (from <= 0 && direction === -1) return;
    setPrice(priceText(from <= 0 ? 1 : stepIdxPrice(from, direction)));
  };
  const ticker = security.ticker ?? security.name;
  const where = cashAccount ? cashAccount.name : 'the account';
  // What the total box reads: the trade as it will be recorded, the details' fee and tax included.
  const feeMinor = input?.feeMinor ?? charge?.feeMinor ?? 0;
  const taxMinor = input?.taxMinor ?? charge?.taxMinor ?? 0;
  const charged = feeMinor + taxMinor;
  const totalMinor = kind === 'buy' ? grossMinor + charged : grossMinor - charged;
  const typedCharge = details.draft.fee.trim() !== '' || details.draft.tax.trim() !== '';
  const minimumNote = !typedCharge && charge?.minimumApplied && rates?.minDailyMinor ? ` · minimum fee ${formatMinor(rates.minDailyMinor, 'IDR')} applies` : '';
  const chargeNote = typedCharge
    ? kind === 'sell' && taxMinor > 0
      ? ' (tax included)'
      : ''
    : charge
      ? ` (${ppmPercent(charge.ratePpm)}${kind === 'sell' && charge.taxMinor > 0 ? ', tax included' : ''})`
      : '';

  return (
    <Sheet
      grouped
      tall
      expanded={details.open}
      title={`${kind === 'buy' ? 'Buy' : 'Sell'} ${ticker}`}
      onClose={onClose}
      confirm={{ label: kind === 'buy' ? 'Record buy' : 'Record sell', disabled: !saving.canSave, run: () => void saving.save() }}
    >
      <div className="flex items-center gap-3 px-[4px] pb-3">
        <span aria-hidden className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--ph-tint)] text-[11px] font-bold text-white">
          {ticker.slice(0, 4)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-[20px] font-semibold text-[var(--ph-ink)]">{security.name}</span>
          <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {lastPrice && lastRupiah !== null ? `Last close ${priceText(lastRupiah)} · ${dayLabel(lastPrice.onDate)}` : 'No price yet'}
          </span>
        </span>
      </div>

      <InsetGroup
        footer={
          !onTick && price.trim() !== ''
            ? `IDX prices move in steps of ${rupiah ? idxTickSize(Math.floor(rupiah)) : 1} at this price`
            : kind === 'sell'
              ? `Held: ${heldLots} ${heldLots === 1 ? 'lot' : 'lots'}${tooMany ? '; cannot sell more than that' : ''}`
              : undefined
        }
      >
        <StepperRow
          label="Price"
          value={price}
          onChange={setPrice}
          onStep={step}
          inputMode="numeric"
          invalid={price.trim() !== '' && !onTick}
          canDown={(rupiah ?? 0) > 1}
        />
        <StepperRow
          label="Lots"
          value={String(lots)}
          onChange={(text) => setLots(Math.max(0, Math.floor(Number(text.replace(/\D/g, '')) || 0)))}
          onStep={(direction) => setLots((was) => Math.max(1, was + direction))}
          inputMode="numeric"
          invalid={lots < 1 || tooMany}
          canDown={lots > 1}
          canUp={kind === 'buy' || lots < heldLots}
        />
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
        {!brokerAccountId ? (
          <SelectRow label={kind === 'buy' ? 'Paid from' : 'Paid into'} value={cashAccountId} onChange={(e) => setPicked(e.target.value)}>
            {cashChoices.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectRow>
        ) : null}
      </InsetGroup>

      <TradeDetails kind={kind} details={details} currency={holding.currency} emptyWord="Worked out" whole={formatUnits(unitsMicro)} unitLabel="shares" problem={problem} />

      {charge && (
        <div className="mb-[18px] rounded-[11px] bg-[var(--ph-surface)] px-4 py-3" data-testid="trade-total">
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {kind === 'buy'
              ? `Total · ${formatUnits(shares * 1_000_000)} shares`
              : `Selling · ${formatUnits(shares * 1_000_000)} shares of ${formatUnits(position?.unitsMicro ?? 0)} held`}
          </p>
          <p className={cx('tabular text-[22px] leading-[28px] font-bold', kind === 'buy' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
            {formatMinor(totalMinor, 'IDR')}
          </p>
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {formatMinor(grossMinor, 'IDR')} {kind === 'buy' ? '+' : '−'} fee {formatMinor(charged, 'IDR')}
            {chargeNote} · {kind === 'buy' ? 'from' : 'into'} {where}
            {minimumNote}
          </p>
          {sold && (
            <p className="mt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="trade-gain">
              Gain on these {formatUnits(unitsMicro)}:{' '}
              <span className={cx('font-semibold', grossMinor - feeMinor - sold.basis < 0 ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
                {signed(grossMinor - feeMinor - sold.basis)}
              </span>
              {sold.average !== null && ` (bought at avg ${priceText(Math.round(sold.average / 1_000_000))})`}
            </p>
          )}
        </div>
      )}

      {saving.setAside.node}
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

/** A gain with its sign, as the page writes one: +Rp 179.781, −Rp 12.000. */
const signed = (minor: number) => `${minor < 0 ? '−' : '+'}${formatMinor(Math.abs(minor), 'IDR')}`;

/** A row with a label, a box that can be typed in, and − / + either side of it. */
function StepperRow({
  label,
  value,
  onChange,
  onStep,
  inputMode,
  invalid,
  canDown = true,
  canUp = true,
  position,
}: GroupChild & {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onStep: (direction: 1 | -1) => void;
  inputMode: 'numeric' | 'decimal';
  invalid: boolean;
  canDown?: boolean;
  canUp?: boolean;
}) {
  const button = 'ph-focus flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-surface)] text-[var(--ph-tint)] disabled:opacity-40';
  return (
    <div className="relative">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: 0 }} />}
      <div className="flex items-center gap-3" style={{ padding: `${ROW_PAD_Y - 4}px ${ROW_PAD_X}px` }}>
        <span className="flex-1 text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{label}</span>
        <button type="button" aria-label={`Less ${label.toLowerCase()}`} disabled={!canDown} onClick={() => onStep(-1)} className={button}>
          <Minus size={16} aria-hidden />
        </button>
        <input
          aria-label={label}
          aria-invalid={invalid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          className={cx(
            'ph-focus tabular w-[84px] rounded bg-transparent text-center text-[17px] leading-[22px] font-semibold',
            invalid ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink)]',
          )}
        />
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={!canUp} onClick={() => onStep(1)} className={button}>
          <Plus size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
