import { formatMinor, formatPriceMicro, formatUnits, isoDate, parseMajor, parsePriceMicro, type UnitKind, unitsValueMinor, type ValuationBasis } from '@expanses/core';
import { recordValuation, type TradeRow, upsertPrice } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { useGoals } from '../goals/queries';
import { BASIS_LABELS } from './labels';
import { usePositions } from './queries';
import { TradeForm } from './TradeForm';
import type { TradeDraft } from './trade-form';

/**
 * A bond is priced per unit of face, but read and typed as a share of it: 102 is a price of 1,02. Everything else is
 * typed as the price of one unit, in the holding's currency.
 */
const typedToMicro = (typed: string, currency: string, unitKind: UnitKind | null) => {
  const micro = parsePriceMicro(typed, currency);
  return unitKind === 'face' ? Math.round(micro / 100) : micro;
};
const microToTyped = (micro: number, currency: string, unitKind: UnitKind | null) =>
  formatPriceMicro(unitKind === 'face' ? micro * 100 : micro, currency).replace(/[^\d.,]/g, '');

/** The price to type, by what one unit is. */
export const PRICE_WORDS: Record<UnitKind, string> = {
  grams: 'Buyback price a gram',
  shares: 'Closing price',
  units: 'Price a unit',
  face: 'Price, % of face',
};

/**
 * Today's price, in a sheet over the page: the box opens on the last price saved, written with its thousands marks,
 * and says what the holding comes to at what is typed. ✓ saves it as today's.
 */
export function PriceSheet({
  accountId,
  currency,
  unitKind,
  unitsMicro,
  unitLabel,
  priceMicro,
  onClose,
}: {
  accountId: string;
  currency: string;
  unitKind: UnitKind | null;
  unitsMicro: number;
  unitLabel: string;
  priceMicro: number | null;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [typed, setTyped] = useState(priceMicro === null ? '' : microToTyped(priceMicro, currency, unitKind));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  let preview: number | null = null;
  try {
    preview = typed.trim() === '' ? null : unitsValueMinor(unitsMicro, typedToMicro(typed, currency, unitKind));
  } catch {
    preview = null;
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await upsertPrice(database, ws, { accountId, onDate: isoDate(), priceMicro: typedToMicro(typed, currency, unitKind) });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Price" onClose={onClose} confirm={{ label: 'Save price', disabled: busy || typed.trim() === '', run: () => void save() }}>
      <InsetGroup>
        <TextRow
          label={unitKind ? PRICE_WORDS[unitKind] : 'Price a unit'}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          inputMode="decimal"
          placeholder="Amount"
          hint={preview === null ? undefined : `${formatUnits(unitsMicro)} ${unitLabel} at that price is ${formatMinor(preview, currency)}`}
        />
      </InsetGroup>
      <ErrorBox error={error} />
    </Sheet>
  );
}

const BASES: ValuationBasis[] = ['estimate', 'appraisal', 'listing', 'njop'];

/**
 * A new value for a thing that has no market price. It opens empty every time — the last source is no guess about
 * the next one — and dated today, which can be changed for a letter that came last week.
 */
export function ValueSheet({ accountId, currency, onClose }: { accountId: string; currency: string; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [value, setValue] = useState('');
  const [basis, setBasis] = useState<ValuationBasis>('estimate');
  const [asOf, setAsOf] = useState(isoDate());
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await recordValuation(database, ws, { accountId, asOf, valueMinor: parseMajor(value, currency), basis, note: note.trim() || null });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Update value" onClose={onClose} confirm={{ label: 'Save value', disabled: busy || value.trim() === '', run: () => void save() }}>
      <InsetGroup>
        <TextRow label={`Value (${currency})`} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Amount" />
        <SelectRow
          label="From"
          value={basis}
          onChange={(e) => setBasis(e.target.value as ValuationBasis)}
          info="NJOP is kept for the tax report; the value uses the latest of the others."
        >
          {BASES.map((option) => (
            <option key={option} value={option}>
              {BASIS_LABELS[option]}
            </option>
          ))}
        </SelectRow>
        <TextRow label="Date" type="date" value={asOf} max={isoDate()} onChange={(e) => setAsOf(e.target.value)} />
        <TextRow label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </InsetGroup>
      <ErrorBox error={error} />
    </Sheet>
  );
}

/**
 * The Buy & sell form, in a sheet over the holding's own page, with the holding already chosen: a buy, a sale or a
 * payment, or an edit of one already recorded. The same form, the same checks, the same save as Buy & sell.
 */
export function TradeSheet({
  title,
  holding,
  initial,
  editing,
  onClose,
}: {
  title: string;
  holding: { accountId: string; name: string; currency: string };
  initial: Partial<TradeDraft>;
  editing: TradeRow | null;
  onClose: () => void;
}) {
  const accounts = useAccounts();
  const positions = usePositions();
  const goals = useGoals();
  // The cash side of a trade, as Buy & sell offers it: a buy is paid from money, a broker's cash included.
  const cashAccounts = moneyHolders(accounts.data ?? []).filter((account) => MONEY_SUBTYPES.includes(account.subtype));
  return (
    <Sheet grouped tall expanded title={title} onClose={onClose}>
      {accounts.isSuccess && positions.isSuccess && (
        <TradeForm
          holdings={[holding]}
          goals={(goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }))}
          cashAccounts={cashAccounts}
          positions={positions.data ?? {}}
          editing={editing}
          initial={{ accountId: holding.accountId, ...initial }}
          templateId={null}
          onSaved={onClose}
          onCancel={onClose}
        />
      )}
    </Sheet>
  );
}

/** What can be done with one recorded trade: open it in the form, or take it back. */
export function TradeActionsSheet({ title, onEdit, onDelete, onClose }: { title: string; onEdit: () => void; onDelete: () => void; onClose: () => void }) {
  return (
    <Sheet grouped title={title} onClose={onClose}>
      <InsetGroup>
        <InsetRow title="Edit" chevron={false} onClick={onEdit} />
        <InsetRow title="Delete" chevron={false} onClick={onDelete} />
      </InsetGroup>
    </Sheet>
  );
}
