import { flatToEffectiveBps, isoDate, type LoanMethod, periodOn } from '@expanses/core';
import { saveLoanTerms } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
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
  const set = (patch: Partial<LoanTermsDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const currency = accounts.find((account) => account.id === draft.accountId)?.currency ?? ws.baseCurrency;
  const tenor = Number(draft.tenorMonths) || 0;
  const rateBps = Math.round((Number(draft.rate.replace(',', '.')) || 0) * 100);
  const effective = draft.method === 'flat' && tenor > 1 && rateBps > 0 ? flatToEffectiveBps(rateBps, tenor) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
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
      <Card>
        <p className="text-sm text-slate-600">
          Every loan account already has its terms. Add another on{' '}
          <Link to="/accounts" className="underline">
            Accounts
          </Link>{' '}
          first, with what you still owe as its balance.
        </p>
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Which loan" hint="Its balance is what you still owe today.">
            <Select value={draft.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              {loanAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lender">
            <Input value={draft.lenderName} onChange={(e) => set({ lenderName: e.target.value })} placeholder="Bank BTN" required />
          </Field>
          <Field label={`Amount borrowed (${currency})`} hint="The original amount, not what is left.">
            <Input value={draft.originalAmount} inputMode="decimal" onChange={(e) => set({ originalAmount: e.target.value })} placeholder="700.000.000" required />
          </Field>
          <Field label="How interest is worked out">
            <Select value={draft.method} onChange={(e) => set({ method: e.target.value as LoanMethod })}>
              {Object.entries(METHOD_LABELS).map(([method, label]) => (
                <option key={method} value={method}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rate a year (%)" hint={effective ? `A flat ${draft.rate}% is about ${(effective / 100).toFixed(2)}% effective.` : 'Type 9 or 9,25.'}>
            <Input value={draft.rate} inputMode="decimal" onChange={(e) => set({ rate: e.target.value })} placeholder="9" />
          </Field>
          <Field label="Rate kind" hint="A floating rate changes; you record each change as it comes.">
            <Select value={draft.rateKind} onChange={(e) => set({ rateKind: e.target.value as 'fixed' | 'floating' })}>
              <option value="fixed">Fixed</option>
              <option value="floating">Floating</option>
            </Select>
          </Field>
          <Field label="First payment on">
            <Input type="date" value={draft.firstPaymentOn} onChange={(e) => set({ firstPaymentOn: e.target.value })} required />
          </Field>
          <Field label="Tenor in months" hint="180 months is 15 years.">
            <Input value={draft.tenorMonths} inputMode="numeric" onChange={(e) => set({ tenorMonths: e.target.value })} placeholder="180" required />
          </Field>
          <Field label="Payment day" hint="1 to 28, so every month has it.">
            <Input value={draft.paymentDay} inputMode="numeric" onChange={(e) => set({ paymentDay: e.target.value })} />
          </Field>
          <Field label={`Payment each month (${currency})`} hint="Leave empty to work it out from the rate.">
            <Input value={draft.payment} inputMode="decimal" onChange={(e) => set({ payment: e.target.value })} />
          </Field>
          <Field label="What it bought" hint="A property makes this a mortgage, which the debt ratios treat apart.">
            <Select value={draft.assetAccountId} onChange={(e) => set({ assetAccountId: e.target.value })}>
              <option value="">Nothing in particular</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What it is for">
            <Input value={draft.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="House in Bintaro" />
          </Field>
        </div>
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save terms
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          The schedule is worked out from what the ledger says you owe, so the payments you record are always the truth. Nothing here is stored as a projection.
        </p>
      </form>
    </Card>
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Loans"
        action={
          // While the inline form is open there is no action to show, and an empty row would still take its gap.
          !adding && (
            <div className="flex items-center gap-4">
              {/* Terms go on a loan account that already exists; the picker is for the loan that does not yet. */}
              <Link to="/debts/new" className="text-sm font-medium text-slate-600 underline-offset-4 hover:underline">
                What do you owe?
              </Link>
              <Button onClick={() => setAdding(true)}>Add loan terms</Button>
            </div>
          )
        }
      />
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

      {monthlyMinor > 0 && (
        <Card className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-sm text-slate-600">The instalments the banks ask for each month</span>
          <Money minor={monthlyMinor} currency={ws.baseCurrency} className="text-xl font-semibold" />
        </Card>
      )}

      {open.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Still being paid</h2>
          <div className="divide-y divide-slate-100">
            {open.map((loan) => (
              <div key={loan.accountId} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <Link to="/net-worth/loans/$accountId" params={{ accountId: loan.accountId }} className="font-medium underline">
                    {nameOf(loan.accountId)}
                  </Link>
                  <span className="block text-xs text-slate-500">
                    {loan.lenderName} · {(periodOn(loan.periods, today)?.rateBps ?? 0) / 100}% · {loan.tenorMonths} months from {loan.firstPaymentOn}
                    {loan.isHomeLoan && ' · mortgage'}
                  </span>
                </span>
                <Money minor={paymentOf(loan.accountId)} currency={ws.baseCurrency} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {paidOff.length > 0 && (
        <Card className="space-y-1">
          <h2 className="text-sm font-semibold">Paid off</h2>
          {paidOff.map((loan) => (
            <div key={loan.accountId} className="text-sm text-slate-600">
              {nameOf(loan.accountId)} · cleared {loan.statusOn}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
