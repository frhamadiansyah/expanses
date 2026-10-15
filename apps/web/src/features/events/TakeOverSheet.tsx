import { ownerScope, type SharedEventView, takeOverRecords } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SubmitRow } from '../../ui/native';
import { moneyAccounts, possessive, waitingLine } from './shared-view';

/**
 * Ruling R6: what this person paid or received that is not in their books yet — recorded for them before they joined,
 * or before a new phone — is taken over from one account. The day's rates are fetched first, so a figure in another
 * currency converts on this phone.
 */
export function TakeOverSheet({ view, onClose }: { view: SharedEventView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = moneyAccounts(useAccounts().data ?? []);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const recordIds = view.waiting.filter((w) => w.reason === 'choose-account').map((w) => w.recordId);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw new Error(`Choose the account ${possessive(view.myName)} money came from`);
      for (const id of recordIds) {
        const expense = view.expenses.find((e) => e.expenseId === id);
        const settlement = view.settlements.find((s) => s.settlementId === id);
        const on = expense?.occurredOn ?? settlement?.occurredOn;
        if (on) await resolveRates([expense?.currency ?? view.currency, view.currency, account.currency!], on).catch(() => undefined);
      }
      await takeOverRecords(database, ownerScope(ws), view.eventId, { accountId: account.id, recordIds });
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Into the books" onClose={onClose}>
      <form aria-label="Take over" onSubmit={(event) => void save(event)}>
        <InsetGroup footer={waitingLine(view) ?? undefined}>
          <SelectRow label="From" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </SelectRow>
          <SubmitRow label={busy ? 'Saving…' : 'Add to the books'} disabled={busy || !accountId} />
        </InsetGroup>
        <ErrorBox error={error} />
      </form>
    </Sheet>
  );
}
