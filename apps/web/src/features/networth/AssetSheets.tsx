import { formatMinor, formatPriceMicro, formatUnits, groupedMajorString, groupTypedAmount, isoDate, parseGroupedMajor, parsePriceMicro, type UnitKind, unitsValueMinor } from '@expanses/core';
import { editValuation, recordValuation, type TradeRow, upsertPrice, type ValuationWithNote } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { canTradeCashWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { useGoals } from '../goals/queries';
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
  face: 'Price, % of par',
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

/**
 * A new value for a thing that has no market price: always the owner's estimate, whatever it was read from. It opens
 * empty every time, dated today, which can be changed for a letter that came last week. Given an estimate to change
 * it opens on that one, and saving changes it rather than adding another.
 */
export function ValueSheet({ accountId, currency, editing, onClose }: { accountId: string; currency: string; editing?: ValuationWithNote; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [value, setValue] = useState(editing ? groupedMajorString(editing.valueMinor, currency) : '');
  const [asOf, setAsOf] = useState(editing?.asOf ?? isoDate());
  const [note, setNote] = useState(editing?.note ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const valueMinor = parseGroupedMajor(value, currency);
      if (editing) await editValuation(database, ws, editing.id, { asOf, valueMinor, note: note.trim() || null });
      else await recordValuation(database, ws, { accountId, asOf, valueMinor, basis: 'estimate', note: note.trim() || null });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title={editing ? 'Edit value' : 'Update value'} onClose={onClose} confirm={{ label: 'Save value', disabled: busy || value.trim() === '', run: () => void save() }}>
      <InsetGroup>
        <TextRow label="Value" prefix={currency} value={value} onChange={(e) => setValue(groupTypedAmount(e.target.value, currency))} inputMode="decimal" placeholder="Amount" />
        <TextRow label="Date" type="date" value={asOf} max={isoDate()} onChange={(e) => setAsOf(e.target.value)} />
        <TextRow label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </InsetGroup>
      <ErrorBox error={error} />
    </Sheet>
  );
}

/**
 * The full trade form, in a sheet over the holding's own page (or its Settings), with the holding already chosen: a
 * buy, a sale, a payment or a change of units, or an edit of one already recorded.
 */
export function TradeSheet({
  title,
  holding,
  initial,
  editing,
  templateId = null,
  onClose,
}: {
  title: string;
  holding: { accountId: string; name: string; currency: string; byMoney?: boolean };
  initial: Partial<TradeDraft>;
  editing: TradeRow | null;
  /** A monthly plan this buy answers, so the plan stops being due. */
  templateId?: string | null;
  onClose: () => void;
}) {
  const accounts = useAccounts();
  const positions = usePositions();
  const goals = useGoals();
  // The cash side of a trade: a buy is paid from money, a broker's cash included, or a credit card (the form hides the
  // card on a sale); the account an edited trade already names is always kept.
  const cashAccounts = moneyHolders(accounts.data ?? []).filter((account) => canTradeCashWith(account, 'buy') || account.id === editing?.cashAccountId);
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
          templateId={templateId}
          onSaved={onClose}
          onCancel={onClose}
        />
      )}
    </Sheet>
  );
}

/**
 * What can be done with one recorded trade: open it in the form, or take it back — and, beside them, what only a
 * recorded trade has: the goal a buy or a sell counts toward (Goals…, with the goal it has now), and how much of a
 * payment was put back in (Reinvested…). Each of those two is offered only where the trade can carry it.
 */
export function TradeActionsSheet({
  title,
  onEdit,
  onDelete,
  goals,
  reinvested,
  onClose,
}: {
  title: string;
  onEdit: () => void;
  onDelete: () => void;
  goals?: { value: string; open: () => void };
  reinvested?: { value: string; open: () => void };
  onClose: () => void;
}) {
  return (
    <Sheet grouped title={title} onClose={onClose}>
      {(goals || reinvested) && (
        <InsetGroup>
          {goals ? <InsetRow title="Goals…" value={goals.value} onClick={goals.open} /> : null}
          {reinvested ? <InsetRow title="Reinvested…" value={reinvested.value} onClick={reinvested.open} /> : null}
        </InsetGroup>
      )}
      <InsetGroup>
        <InsetRow title="Edit" action onClick={onEdit} />
        <InsetRow title="Delete" destructive onClick={onDelete} />
      </InsetGroup>
    </Sheet>
  );
}

