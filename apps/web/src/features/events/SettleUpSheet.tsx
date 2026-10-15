import { isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { type NamedPayment, ownerScope, recordSettlement, type SharedEventView } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { type SettleRate, settleFigure, suggestedFigure } from './settle-up';
import { moneyAccounts, paymentLine, possessive } from './shared-view';

/**
 * Settle up (shared events §6): records one suggested payment, in the event currency. When this person pays or
 * receives it, the sheet asks which account, and — for an account in another currency — what it moved there, filled in
 * at the day's rate from the amount as it stands and editable (a settle-up in rupiah for a lira trip).
 */
export function SettleUpSheet({ view, payment, onClose }: { view: SharedEventView; payment: NamedPayment; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = moneyAccounts(useAccounts().data ?? []);
  const party = payment.fromPersonId === view.me || payment.toPersonId === view.me;
  const [amount, setAmount] = useState(minorToMajorString(payment.amountMinor, view.currency));
  const [accountId, setAccountId] = useState('');
  // The rate held for the account picked, and the figure typed over the suggestion (null until typed): the suggestion
  // follows the amount as it is edited, and Save works it out again from the amount it saves (I3).
  const [rate, setRate] = useState<{ accountId: string; rate: SettleRate } | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  // The account the latest pick asked a rate for: an answer for an earlier pick arriving late is dropped.
  const picking = useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const foreign = account !== null && account.currency !== view.currency;
  const held = rate && rate.accountId === accountId ? rate.rate : null;

  async function rateFor(currency: string): Promise<SettleRate | null> {
    const { rates } = await resolveRates([view.currency, currency], isoDate());
    const from = view.currency === ws.baseCurrency ? 1 : rates[view.currency];
    const to = currency === ws.baseCurrency ? 1 : rates[currency];
    return from && to ? { from, to } : null;
  }

  async function pick(id: string) {
    setAccountId(id);
    setTyped(null);
    picking.current = id;
    const chosen = accounts.find((a) => a.id === id);
    if (!chosen?.currency || chosen.currency === view.currency) return;
    // A failed lookup is not an error yet: Save asks again, and says so then if there is still no rate.
    const found = await rateFor(chosen.currency).catch(() => null);
    if (found && picking.current === id) setRate({ accountId: id, rate: found });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (party && !account) throw new Error(`Choose the account ${possessive(view.myName)} money ${payment.fromPersonId === view.me ? 'left' : 'arrived in'}`);
      const amountMinor = parseMajor(amount, view.currency);
      let figure: number | null = null;
      if (party && account && foreign) {
        const currency = account.currency!;
        // A field typed and then cleared is the suggestion again, not a figure of nought.
        const own = typed?.trim() ? typed : null;
        const atSave = own !== null ? null : (held ?? (await rateFor(currency).catch(() => null)));
        figure = settleFigure({ amountMinor, eventCurrency: view.currency, accountCurrency: currency, typed: own, rate: atSave });
      }
      await recordSettlement(database, ownerScope(ws), view.eventId, {
        occurredOn: isoDate(),
        fromPersonId: payment.fromPersonId,
        toPersonId: payment.toPersonId,
        amountMinor,
        account: party && account ? { accountId: account.id, amountMinor: figure } : null,
      });
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Settle up" onClose={onClose}>
      <form aria-label="Settle up" onSubmit={(event) => void save(event)} data-testid="settle-up">
        <InsetGroup>
          <ReadOnlyRow label="Payment" value={paymentLine(payment, view.currency)} />
          <TextRow label={`Amount (${view.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {party ? (
            <SelectRow label={payment.fromPersonId === view.me ? 'Paid from' : 'Received into'} value={accountId} onChange={(e) => void pick(e.target.value)}>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </SelectRow>
          ) : null}
          {foreign ? (
            <TextRow
              label={`In ${account!.currency}`}
              inputMode="decimal"
              value={typed ?? suggestedFigure(amount, view.currency, account!.currency!, held)}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="At today’s rate"
            />
          ) : null}
          <SubmitRow label={busy ? 'Saving…' : 'Record'} disabled={busy} />
        </InsetGroup>
        <ErrorBox error={error} />
      </form>
    </Sheet>
  );
}
