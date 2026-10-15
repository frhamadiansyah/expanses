import { ownerScope, type SharedEventView, takeOverRecords } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SubmitRow } from '../../ui/native';
import { moneyAccounts, takeOverBatches, takeOverChoice, takeOverRows, waitingLine } from './shared-view';

/**
 * Ruling R6: what this person paid or received that is not in their books yet — recorded for them before they joined,
 * or before a new phone — is taken over. Each record names its own account: two dinners paid in cash and a hotel on a
 * card are three different purses, and posting all three from one would leave both balances and the card's statement
 * wrong (I4). A record not picked yet takes the last account picked, so one pick still covers the common case. What
 * this person received asks "Into", what they paid "From". The day's rates are fetched first, so a figure in another
 * currency converts on this phone.
 */
export function TakeOverSheet({ view, onClose }: { view: SharedEventView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = moneyAccounts(useAccounts().data ?? []);
  const rows = takeOverRows(view);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [lastPicked, setLastPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = rows.length > 0 && rows.every((row) => takeOverChoice(row.recordId, picks, lastPicked) !== null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // One call per account: each is one db transaction, so a refusal for one account leaves the others' done.
      for (const batch of takeOverBatches(rows, picks, lastPicked)) {
        const account = accounts.find((a) => a.id === batch.accountId);
        if (!account) throw new Error('Choose an account');
        for (const id of batch.recordIds) {
          const expense = view.expenses.find((e) => e.expenseId === id);
          const settlement = view.settlements.find((s) => s.settlementId === id);
          const on = expense?.occurredOn ?? settlement?.occurredOn;
          if (on) await resolveRates([expense?.currency ?? view.currency, view.currency, account.currency!], on).catch(() => undefined);
        }
        await takeOverRecords(database, ownerScope(ws), view.eventId, batch);
      }
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
      // What did go in before the refusal is in the books now: read again, so the sheet lists only what still waits.
      await invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Into the books" onClose={onClose}>
      <form aria-label="Take over" onSubmit={(event) => void save(event)}>
        <ErrorBox error={error} />
        {rows.map((row) => (
          <InsetGroup key={row.recordId} header={`${row.title} · ${row.amount}`}>
            <SelectRow
              label={row.direction}
              value={takeOverChoice(row.recordId, picks, lastPicked) ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                setPicks((current) => ({ ...current, [row.recordId]: id }));
                if (id) setLastPicked(id);
              }}
            >
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </SelectRow>
          </InsetGroup>
        ))}
        <InsetGroup footer={waitingLine(view) ?? undefined}>
          <SubmitRow label={busy ? 'Saving…' : 'Add to the books'} disabled={busy || !ready} />
        </InsetGroup>
      </form>
    </Sheet>
  );
}
