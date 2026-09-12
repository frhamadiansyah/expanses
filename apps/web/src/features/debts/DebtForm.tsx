import { type DebtDirection, isoDate } from '@expanses/core';
import { recordLoan } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { CategoryOptions } from '../cards/options';
import { type DebtDraft, debtDraftToInput, emptyDebtDraft, personSuggestions } from './debts-form';
import { useDebtProfiles, usePeopleDebts } from './queries';

/** Records money handed to a person, or taken from one. */
export function DebtForm({ onDone }: { onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const people = usePeopleDebts();
  const profiles = useDebtProfiles();
  const today = isoDate();
  const [draft, setDraft] = useState<DebtDraft>(() => emptyDebtDraft(today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<DebtDraft>) => setDraft((current) => ({ ...current, ...patch }));
  // A loan comes from money you hold, or a card. Another person's account is not a source.
  const money = accounts.filter((account) => ['bank', 'cash', 'savings', 'credit_card'].includes(account.subtype) && account.archivedAt === null);
  const currency = money.find((account) => account.id === draft.moneyId)?.currency ?? ws.baseCurrency;
  const suggestions = people.data ? personSuggestions(people.data, draft.personName) : [];

  /** Typing a name the workspace already knows uses that account instead of opening a second one. */
  function nameTyped(personName: string) {
    const match = (profiles.data ?? []).find(
      (profile) => profile.direction === draft.direction && profile.personName.toLowerCase() === personName.trim().toLowerCase() && profile.status !== 'forgiven',
    );
    set({ personName, existingAccountId: match?.accountId ?? '' });
  }

  function directionChosen(direction: DebtDirection) {
    // The same name can exist on both sides, so the match is looked up again.
    set({ direction, existingAccountId: '' });
    nameTyped(draft.personName);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await recordLoan(database, ws, debtDraftToInput(draft, currency, today));
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['lent', 'borrowed'] as const).map((direction) => (
            <Button
              key={direction}
              variant={draft.direction === direction ? 'primary' : 'secondary'}
              aria-pressed={draft.direction === direction}
              onClick={() => directionChosen(direction)}
            >
              {direction === 'lent' ? 'I lent money' : 'I borrowed money'}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Person" hint={draft.existingAccountId ? 'Adding to what they already owe.' : 'A new person gets their own account.'}>
            <Input value={draft.personName} onChange={(e) => nameTyped(e.target.value)} list="debt-people" placeholder="Andi" required />
          </Field>
          <datalist id="debt-people">
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Field label="Date">
            <Input type="date" value={draft.occurredOn} max={today} onChange={(e) => set({ occurredOn: e.target.value })} />
          </Field>
          <Field label={`Amount (${currency})`}>
            <Input value={draft.amount} inputMode="decimal" onChange={(e) => set({ amount: e.target.value })} placeholder="10.000.000" required />
          </Field>
          <Field
            label={draft.direction === 'lent' ? 'Paid from' : 'Received into'}
            hint={draft.direction === 'lent' ? 'A credit card works: the card owes more, and the purchase still earns points.' : undefined}
          >
            <Select
              value={draft.moneyId}
              onChange={(e) => set({ moneyId: e.target.value, moneyIsCard: money.find((account) => account.id === e.target.value)?.subtype === 'credit_card' })}
            >
              <option value="">Choose…</option>
              <optgroup label="Accounts">
                {money.filter((account) => account.kind === 'asset').map((account) => (
                  <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                ))}
              </optgroup>
              {draft.direction === 'lent' && (
                <optgroup label="Credit cards">
                  {money.filter((account) => account.subtype === 'credit_card').map((account) => (
                    <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
          {draft.moneyIsCard && (
            <>
              <Field label="Category for points" hint="Not spending: it only tells the points engine what the card paid for.">
                <Select value={draft.spendCategoryId} onChange={(e) => set({ spendCategoryId: e.target.value })}>
                  <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
                </Select>
              </Field>
              <Field label="MCC">
                <Input value={draft.mcc} inputMode="numeric" onChange={(e) => set({ mcc: e.target.value })} placeholder="5311" />
              </Field>
            </>
          )}
          <Field label="What it is for" hint="Shown on their card, so you remember.">
            <Input value={draft.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Motorcycle repair" />
          </Field>
          <Field label="Due by" hint="Optional. You are warned three weeks before.">
            <Input type="date" value={draft.dueOn} onChange={(e) => set({ dueOn: e.target.value })} />
          </Field>
          {!draft.existingAccountId && (
            <Field label="NIK or NPWP" hint="Optional, and only needed when this reaches your SPT.">
              <Input value={draft.personIdNumber} inputMode="numeric" onChange={(e) => set({ personIdNumber: e.target.value })} />
            </Field>
          )}
        </div>

        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
