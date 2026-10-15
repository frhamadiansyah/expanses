import { convertMinor, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { type NamedPayment, ownerScope, recordSettlement, type SharedEventView } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { moneyAccounts, paymentLine, possessive } from './shared-view';

/**
 * Settle up (shared events §6): records one suggested payment, in the event currency. When this person pays or
 * receives it, the sheet asks which account, and — for an account in another currency — what it moved there, filled in
 * at the day's rate and editable (a settle-up in rupiah for a lira trip).
 */
export function SettleUpSheet({ view, payment, onClose }: { view: SharedEventView; payment: NamedPayment; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = moneyAccounts(useAccounts().data ?? []);
  const party = payment.fromPersonId === view.me || payment.toPersonId === view.me;
  const [amount, setAmount] = useState(minorToMajorString(payment.amountMinor, view.currency));
  const [accountId, setAccountId] = useState('');
  const [moved, setMoved] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const foreign = account !== null && account.currency !== view.currency;

  async function pick(id: string) {
    setAccountId(id);
    const chosen = accounts.find((a) => a.id === id);
    if (!chosen?.currency || chosen.currency === view.currency) return setMoved('');
    const { rates } = await resolveRates([view.currency, chosen.currency], isoDate());
    const from = view.currency === ws.baseCurrency ? 1 : rates[view.currency];
    const to = chosen.currency === ws.baseCurrency ? 1 : rates[chosen.currency];
    if (from && to) setMoved(minorToMajorString(convertMinor(parseMajor(amount, view.currency), view.currency, chosen.currency, from / to), chosen.currency));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (party && !account) throw new Error(`Choose the account ${possessive(view.myName)} money ${payment.fromPersonId === view.me ? 'left' : 'arrived in'}`);
      const amountMinor = parseMajor(amount, view.currency);
      await recordSettlement(database, ownerScope(ws), view.eventId, {
        occurredOn: isoDate(),
        fromPersonId: payment.fromPersonId,
        toPersonId: payment.toPersonId,
        amountMinor,
        account: party && account ? { accountId: account.id, amountMinor: foreign ? parseMajor(moved, account.currency!) : null } : null,
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
          {foreign ? <TextRow label={`In ${account!.currency}`} inputMode="decimal" value={moved} onChange={(e) => setMoved(e.target.value)} /> : null}
          <SubmitRow label={busy ? 'Saving…' : 'Record'} disabled={busy} />
        </InsetGroup>
        <ErrorBox error={error} />
      </form>
    </Sheet>
  );
}
