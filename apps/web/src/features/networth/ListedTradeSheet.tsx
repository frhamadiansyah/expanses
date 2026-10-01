import {
  averagePriceMicro, formatMinor, formatUnits, idxCharge, idxTickSize, isIdxTick, isoDate, parseMajor, type Position, ppmPercent, sellBasisMinor, stepIdxPrice,
} from '@expanses/core';
import { chargedAtBrokerOn, type RecordTradeInput, recordTrade, type SecurityRow } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, ROW_PAD_X, ROW_PAD_Y, SelectRow, TextRow } from '../../ui/native';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { dayLabel } from './asset-page';
import { useBrokerFees } from './BrokerFeesGroup';
import { type TradeDraft, typedAmount } from './trade-form';
import { tradeRatesForSave } from './trade-money';

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
 * sell, with the gain on the lots sold. Recorded by `recordTrade`, as the full form records it; "More options" opens
 * that form with these figures in it, for a fee in rupiah, another account, odd lots or a goal.
 */
export function ListedTradeSheet({
  kind,
  holding,
  security,
  lastPrice,
  position,
  brokerAccountId,
  onMore,
  onClose,
}: {
  kind: 'buy' | 'sell';
  holding: { accountId: string; name: string; currency: string };
  security: SecurityRow;
  lastPrice: { priceMicro: number; onDate: string } | null;
  position: Position | undefined;
  brokerAccountId: string | null;
  onMore: (initial: Partial<TradeDraft>) => void;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
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
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

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
  const input: RecordTradeInput | null =
    charge && !tooMany && lots >= 1 && occurredOn <= today && cashAccountId
      ? { accountId: holding.accountId, kind, occurredOn, unitsMicro, grossMinor, feeMinor: charge.feeMinor, taxMinor: charge.taxMinor, cashAccountId, goalId: null }
      : null;
  const door = input ? tradeDoor(input) : null;
  const setAside = useSetAside(door);
  const sold = kind === 'sell' && position && !tooMany && lots >= 1 ? { basis: sellBasisMinor(position, unitsMicro), average: averagePriceMicro(position) } : null;

  async function save() {
    if (!input || !setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const cashCurrency = cashAccount?.currency ?? ws.baseCurrency;
      const ratesToBase = await tradeRatesForSave({
        database, ws, input, holdingCurrency: holding.currency, cashCurrency, needsRate: null, manualRate: '', resolveRates,
        onMissing: () => undefined, where: 'Rate that day',
      });
      await recordTrade(database, ws, { ...input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const step = (direction: 1 | -1) => {
    const from = rupiah ?? lastRupiah ?? 0;
    if (from <= 0 && direction === -1) return;
    setPrice(priceText(from <= 0 ? 1 : stepIdxPrice(from, direction)));
  };
  const ticker = security.ticker ?? security.name;
  const where = cashAccount ? cashAccount.name : 'the account';
  const minimumNote = charge?.minimumApplied && rates?.minDailyMinor ? ` · minimum fee ${formatMinor(rates.minDailyMinor, 'IDR')} applies` : '';
  const charged = charge ? charge.feeMinor + charge.taxMinor : 0;

  return (
    <Sheet
      grouped
      tall
      title={`${kind === 'buy' ? 'Buy' : 'Sell'} ${ticker}`}
      onClose={onClose}
      confirm={{ label: kind === 'buy' ? 'Record buy' : 'Record sell', disabled: busy || !input || !setAside.ready, run: () => void save() }}
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
              ? `You hold ${heldLots} ${heldLots === 1 ? 'lot' : 'lots'}${tooMany ? '; you cannot sell more than that' : ''}`
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

      {charge && (
        <div className="mb-[18px] rounded-[11px] bg-[var(--ph-surface)] px-4 py-3" data-testid="trade-total">
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {kind === 'buy'
              ? `Total · ${formatUnits(shares * 1_000_000)} shares`
              : `You receive · ${formatUnits(shares * 1_000_000)} shares of ${formatUnits(position?.unitsMicro ?? 0)} held`}
          </p>
          <p className={cx('tabular text-[22px] leading-[28px] font-bold', kind === 'buy' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
            {formatMinor(charge.totalMinor, 'IDR')}
          </p>
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {formatMinor(grossMinor, 'IDR')} {kind === 'buy' ? '+' : '−'} fee {formatMinor(charged, 'IDR')} ({ppmPercent(charge.ratePpm)}
            {kind === 'sell' && charge.taxMinor > 0 ? ', tax included' : ''}) · {kind === 'buy' ? 'from' : 'into'} {where}
            {minimumNote}
          </p>
          {sold && (
            <p className="mt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="trade-gain">
              Gain on these {formatUnits(unitsMicro)}:{' '}
              <span className={cx('font-semibold', grossMinor - charge.feeMinor - sold.basis < 0 ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
                {signed(grossMinor - charge.feeMinor - sold.basis)}
              </span>
              {sold.average !== null && ` (bought at avg ${priceText(Math.round(sold.average / 1_000_000))})`}
            </p>
          )}
        </div>
      )}

      {setAside.node}
      <ErrorBox error={error} />
      <button
        type="button"
        onClick={() =>
          onMore({
            kind,
            occurredOn,
            units: formatUnits(unitsMicro),
            gross: onTick ? typedAmount(grossMinor, 'IDR') : '',
            fee: charge ? typedAmount(charge.feeMinor, 'IDR') : '0',
            tax: charge ? typedAmount(charge.taxMinor, 'IDR') : '0',
            cashAccountId,
          })
        }
        className="ph-focus flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-[var(--ph-tint)]"
      >
        More options
      </button>
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
        <span className="flex-1 text-[16px] leading-[20px] text-[var(--ph-ink)] md:text-[15px]">{label}</span>
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
