import { flatToEffectiveBps, isoDate, type LoanMethod, periodOn } from '@expanses/core';
import { saveLoanTerms } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { HelpCircle, Plus } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Hero, InsetGroup, InsetRow, LargeTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { NetWorthTabs } from '../networth/NetWorthTabs';
import { emptyLoanTermsDraft, type LoanTermsDraft, loanTermsDraftToInput } from './loan-form';
import { useLoans, useScheduledPayments } from './queries';

const METHOD_LABELS: Record<LoanMethod, string> = {
  annuity: 'Annuity — interest on what is left',
  flat: 'Flat — interest on the original amount',
  zero: 'No interest',
};

/** Adds the terms of a loan already running, so its schedule can be worked out. */
function TermsForm({ onDone }: { onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const loans = useLoans();
  const today = isoDate();
  const known = new Set((loans.data ?? []).map((loan) => loan.accountId));
  const loanAccounts = accounts.filter((account) => account.subtype === 'loan' && account.archivedAt === null && !known.has(account.id));
  const assets = accounts.filter((account) => ['property', 'vehicle'].includes(account.subtype) && account.archivedAt === null);

  const [draft, setDraft] = useState<LoanTermsDraft>(() => emptyLoanTermsDraft(loanAccounts[0]?.id ?? '', today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const set = (patch: Partial<LoanTermsDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const currency = accounts.find((account) => account.id === draft.accountId)?.currency ?? ws.baseCurrency;
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

  if (loanAccounts.length === 0) {
    return (
      <InsetGroup
        footer={
          <>
            Every loan account already has its terms. Add another on{' '}
            <Link to="/accounts" className="text-[var(--ph-tint)] underline">
              Accounts
            </Link>{' '}
            first, with what you still owe as its balance.
          </>
        }
      >
        <InsetRow title="Close" chevron={false} onClick={onDone} />
      </InsetGroup>
    );
  }

  return (
    <form ref={form} onSubmit={submit}>
      <InsetGroup header="Which loan" footer="Its balance is what you still owe today.">
        <SelectRow label="Which loan" value={draft.accountId} onChange={(e) => set({ accountId: e.target.value })}>
          {loanAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
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

export function LoansPage() {
  const { ws } = useApp();
  const loans = useLoans();
  const payments = useScheduledPayments();
  const accounts = useAccounts().data ?? [];
  const [adding, setAdding] = useState(false);
  const today = isoDate();

  const open = (loans.data ?? []).filter((loan) => loan.status === 'open');
  const paidOff = (loans.data ?? []).filter((loan) => loan.status === 'paid_off');
  const nameOf = (accountId: string) => accounts.find((account) => account.id === accountId)?.name ?? 'Loan';
  // The instalment, worked out from what the ledger says is owed — not `periods[].paymentMinor`, which is
  // the figure the bank named *if it named one* and is 0 for a loan onboarded without typing it.
  const paymentOf = (accountId: string) => payments.data?.[accountId] ?? 0;
  const monthlyMinor = open.reduce((total, loan) => total + paymentOf(loan.accountId), 0);

  // While the inline form is open there is no action to show, and an empty corner would still take its gap.
  const actions: CornerAction[] = adding
    ? []
    : [
        { key: 'terms', label: 'Add loan terms', glyph: <Plus size={20} aria-hidden />, run: () => setAdding(true) },
        // Terms go on a loan account that already exists; the picker is for the loan that does not yet.
        { key: 'pick', label: 'What do you owe?', glyph: <HelpCircle size={20} aria-hidden />, to: '/debts/new' },
      ];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Loans" actions={actions} />
      <NetWorthTabs />
      <ErrorBox error={loans.error ?? payments.error} />

      {adding && <TermsForm onDone={() => setAdding(false)} />}

      {loans.isSuccess && open.length === 0 && paidOff.length === 0 && !adding && (
        <Empty>
          No loan terms yet. Add the loan account on{' '}
          <Link to="/accounts" className="font-medium underline">
            Accounts
          </Link>{' '}
          with what you still owe, then add its terms here to see the schedule.
        </Empty>
      )}

      {monthlyMinor > 0 && <Hero minor={monthlyMinor} currency={ws.baseCurrency} caption="The instalments the banks ask for each month" />}

      {open.length > 0 && (
        <InsetGroup header="Still being paid">
          {open.map((loan) => (
            <InsetRow
              key={loan.accountId}
              to="/net-worth/loans/$accountId"
              params={{ accountId: loan.accountId }}
              title={nameOf(loan.accountId)}
              subtitle={`${loan.lenderName} · ${(periodOn(loan.periods, today)?.rateBps ?? 0) / 100}% · ${loan.tenorMonths} months from ${loan.firstPaymentOn}${loan.isHomeLoan ? ' · mortgage' : ''}`}
              value={<Money minor={paymentOf(loan.accountId)} currency={ws.baseCurrency} />}
              valueTone="ink"
            />
          ))}
        </InsetGroup>
      )}

      {paidOff.length > 0 && (
        <InsetGroup header="Paid off">
          {paidOff.map((loan) => (
            <InsetRow key={loan.accountId} title={nameOf(loan.accountId)} subtitle={`cleared ${loan.statusOn}`} chevron={false} />
          ))}
        </InsetGroup>
      )}
    </div>
  );
}
