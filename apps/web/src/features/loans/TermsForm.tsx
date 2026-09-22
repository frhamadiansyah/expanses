import { flatToEffectiveBps, isoDate, type LoanMethod } from '@expanses/core';
import { saveLoanTerms, type LoanTermsRow } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { emptyLoanTermsDraft, type LoanTermsDraft, loanTermsDraftFromTerms, loanTermsDraftToInput } from './loan-form';

const METHOD_LABELS: Record<LoanMethod, string> = {
  annuity: 'Annuity — interest on what is left',
  flat: 'Flat — interest on the original amount',
  zero: 'No interest',
};

/**
 * The terms of one loan: what was agreed, so its schedule can be worked out.
 *
 * Opened from the loan's own page, which already knows which loan this is — so there is no `Which loan` picker to
 * answer a second time, and no state in which the form has nothing to do. Given the terms on file it amends them;
 * given none it writes them.
 */
export function TermsForm({ accountId, terms, onDone }: { accountId: string; terms?: LoanTermsRow; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const today = isoDate();
  const account = accounts.find((row) => row.id === accountId);
  const currency = account?.currency ?? ws.baseCurrency;
  const assets = accounts.filter((row) => ['property', 'vehicle'].includes(row.subtype) && row.archivedAt === null);

  const [draft, setDraft] = useState<LoanTermsDraft>(() => (terms ? loanTermsDraftFromTerms(terms, currency, today) : emptyLoanTermsDraft(accountId, today)));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const set = (patch: Partial<LoanTermsDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const tenor = Number(draft.tenorMonths) || 0;
  const rateBps = Math.round((Number(draft.rate.replace(',', '.')) || 0) * 100);
  const effective = draft.method === 'flat' && tenor > 1 && rateBps > 0 ? flatToEffectiveBps(rateBps, tenor) : null;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await saveLoanTerms(database, ws, loanTermsDraftToInput(draft, currency));
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit}>
      <InsetGroup
        header={account?.name ?? 'This loan'}
        footer={terms ? 'Changing what was agreed moves no money: the balance and its payments are as they are.' : 'Its balance is what you still owe today.'}
      >
        <TextRow label="Lender" value={draft.lenderName} onChange={(e) => set({ lenderName: e.target.value })} placeholder="Bank BTN" required />
        <TextRow
          label={`Amount borrowed (${currency})`}
          hint="The original amount, not what is left."
          value={draft.originalAmount}
          inputMode="decimal"
          onChange={(e) => set({ originalAmount: e.target.value })}
          placeholder="700.000.000"
          required
        />
      </InsetGroup>

      <InsetGroup header="The interest">
        <SelectRow label="How interest is worked out" value={draft.method} onChange={(e) => set({ method: e.target.value as LoanMethod })}>
          {Object.entries(METHOD_LABELS).map(([method, label]) => (
            <option key={method} value={method}>
              {label}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label="Rate a year (%)"
          hint={effective ? `A flat ${draft.rate}% is about ${(effective / 100).toFixed(2)}% effective.` : 'Type 9 or 9,25.'}
          value={draft.rate}
          inputMode="decimal"
          onChange={(e) => set({ rate: e.target.value })}
          placeholder="9"
        />
        <SelectRow
          label="Rate kind"
          hint="A floating rate changes; you record each change as it comes."
          value={draft.rateKind}
          onChange={(e) => set({ rateKind: e.target.value as 'fixed' | 'floating' })}
        >
          <option value="fixed">Fixed</option>
          <option value="floating">Floating</option>
        </SelectRow>
      </InsetGroup>

      <InsetGroup header="The schedule">
        <TextRow label="First payment on" type="date" value={draft.firstPaymentOn} onChange={(e) => set({ firstPaymentOn: e.target.value })} required />
        <TextRow
          label="Tenor in months"
          hint="180 months is 15 years."
          value={draft.tenorMonths}
          inputMode="numeric"
          onChange={(e) => set({ tenorMonths: e.target.value })}
          placeholder="180"
          required
        />
        <TextRow
          label="Payment day"
          hint="1 to 28, so every month has it."
          value={draft.paymentDay}
          inputMode="numeric"
          onChange={(e) => set({ paymentDay: e.target.value })}
        />
        <TextRow
          label={`Payment each month (${currency})`}
          hint="Leave empty to work it out from the rate."
          value={draft.payment}
          inputMode="decimal"
          onChange={(e) => set({ payment: e.target.value })}
        />
      </InsetGroup>

      <InsetGroup header="What it is for">
        <SelectRow
          label="What it bought"
          hint="A property makes this a mortgage, which the debt ratios treat apart."
          value={draft.assetAccountId}
          onChange={(e) => set({ assetAccountId: e.target.value })}
        >
          <option value="">Nothing in particular</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </SelectRow>
        <TextRow label="What it is for" value={draft.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="House in Bintaro" />
      </InsetGroup>

      <ErrorBox error={error} />
      <InsetGroup footer="The schedule is worked out from what the ledger says you owe, so the payments you record are always the truth. Nothing here is stored as a projection.">
        <InsetRow title="Save terms" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </form>
  );
}
