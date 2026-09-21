import { formatPriceMicro, isoDate, type Position, type TradeKind } from '@expanses/core';
import { type AccountRow, recordTrade, replaceTrade, type TradeRow } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input, Money, Select } from '../../ui';
import { useSetAsideChoiceOf } from '../goals/queries';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { draftToInput, emptyTradeDraft, pricePreview, sellPreview, type TradeDraft } from './trade-form';

const KINDS: { value: TradeKind; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'income', label: 'Dividend or coupon' },
  { value: 'unit_change', label: 'Unit change (split or bonus units)' },
];

export interface TradeFormProps {
  holdings: { accountId: string; name: string; currency: string }[];
  goals: { id: string; name: string }[];
  cashAccounts: AccountRow[];
  positions: Record<string, Position>;
  /** Set when editing an existing trade; saving replaces it. */
  editing?: TradeRow | null;
  initial?: Partial<TradeDraft>;
  /** Set when the trade comes from a monthly buy, so the template counts as done this month. */
  templateId?: string | null;
  onSaved: (message: string) => void;
  onCancel?: () => void;
}

export function TradeForm({ holdings, goals, cashAccounts, positions, editing, initial, templateId, onSaved, onCancel }: TradeFormProps) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [draft, setDraft] = useState<TradeDraft>({
    ...emptyTradeDraft(holdings[0]?.accountId ?? '', cashAccounts[0]?.id ?? '', today),
    ...initial,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const holding = holdings.find((row) => row.accountId === draft.accountId);
  const currency = holding?.currency ?? ws.baseCurrency;
  const position = positions[draft.accountId];
  const price = pricePreview(draft, currency);
  const sell = sellPreview(draft, position, currency);
  const change = (patch: Partial<TradeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  // The one buy rule (`tradeDoor`), read off the input `submit` sends; an incomplete draft asks nothing yet. An edit
  // asks about the cash account as if the old trade's payment were not there, and opens on its saved answer.
  const door = (() => {
    try {
      return tradeDoor(draftToInput(draft, currency, today));
    } catch {
      return null;
    }
  })();
  const editedTransactionId = editing?.transactionId ?? null;
  const saved = useSetAsideChoiceOf(editedTransactionId);
  const setAside = useSetAside(door, { excludeTransactionId: editedTransactionId, initial: saved.data ?? null });

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Enter submits too: the question is a condition on it.
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const input = { ...draftToInput(draft, currency, today), templateId: templateId ?? null, setAside: setAside.choice };
      const result = editing ? await replaceTrade(database, ws, editing.id, input) : await recordTrade(database, ws, input);
      await invalidate();
      const changed = result.recalculatedSells.length;
      onSaved(changed === 0 ? 'Recorded.' : `Recorded. ${changed === 1 ? '1 later sell was' : `${changed} later sells were`} worked out again at the new average cost.`);
      setDraft({ ...emptyTradeDraft(draft.accountId, draft.cashAccountId, today) });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="What happened">
          <Select value={draft.kind} onChange={(e) => change({ kind: e.target.value as TradeKind })}>
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Holding">
          <Select value={draft.accountId} onChange={(e) => change({ accountId: e.target.value })}>
            {holdings.map((row) => (
              <option key={row.accountId} value={row.accountId}>
                {row.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={draft.occurredOn} max={today} onChange={(e) => change({ occurredOn: e.target.value })} />
        </Field>
        <Field label="Money account" hint="Opening balance is for holdings you owned before using this app.">
          <Select value={draft.cashAccountId} onChange={(e) => change({ cashAccountId: e.target.value })}>
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            <option value="">Opening balance</option>
          </Select>
        </Field>
        {draft.kind !== 'income' && (
          <Field label="Units, shares or grams" hint={position ? `You hold ${(position.unitsMicro / 1_000_000).toLocaleString('id-ID')}` : undefined}>
            <Input value={draft.units} onChange={(e) => change({ units: e.target.value })} inputMode="decimal" placeholder="2" />
          </Field>
        )}
        {draft.kind !== 'unit_change' && (
          <Field
            label={draft.kind === 'buy' ? `What it cost, before fees (${currency})` : draft.kind === 'sell' ? `Proceeds, before fees (${currency})` : `Amount before tax (${currency})`}
          >
            <Input value={draft.gross} onChange={(e) => change({ gross: e.target.value })} inputMode="decimal" placeholder="3.980.000" />
          </Field>
        )}
        {draft.kind !== 'unit_change' && draft.kind !== 'income' && (
          <Field label={`Fee (${currency})`}>
            <Input value={draft.fee} onChange={(e) => change({ fee: e.target.value })} inputMode="decimal" />
          </Field>
        )}
        {(draft.kind === 'buy' || draft.kind === 'sell') && (
          <Field
            label={draft.kind === 'sell' ? 'Sell from goal' : 'For goal'}
            hint={draft.kind === 'sell' ? 'Units come out of this goal only.' : 'Each purchase can fund a different goal.'}
          >
            <Select value={draft.goalId} onChange={(e) => change({ goalId: e.target.value })}>
              <option value="">No goal</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {draft.kind !== 'unit_change' && (
          <Field label={`Tax withheld (${currency})`}>
            <Input value={draft.tax} onChange={(e) => change({ tax: e.target.value })} inputMode="decimal" />
          </Field>
        )}
      </div>

      {price !== null && draft.kind !== 'income' && <p className="text-xs text-slate-500">That is {formatPriceMicro(price, currency)} per unit.</p>}
      {sell && (
        <p className="text-xs text-slate-500">
          Gives up <Money minor={sell.basisMinor} currency={currency} /> of cost, so the gain is <Money minor={sell.realizedMinor} currency={currency} tone="auto" />.
        </p>
      )}

      {setAside.node}
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !setAside.ready}>
          {editing ? 'Save changes' : 'Record'}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
