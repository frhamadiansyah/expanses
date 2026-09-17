import { extraPaymentEffect, flatToEffectiveBps, formatMinor, isoDate, minorToMajorString } from '@expanses/core';
import { addRatePeriod, recordExtraPayment, recordLoanPayment } from '@expanses/db';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { CategoryOptions } from '../cards/options';
import { type PaymentDraft, paymentDraftFrom, paymentDraftToInput } from './loan-form';
import { useLoan, useNextPayment, useSchedule } from './queries';

/** Records the instalment the schedule says is next, with anything riding along on it. */
function PaymentForm({
  accountId,
  loanName,
  currency,
  balanceMinor,
  onDone,
}: {
  accountId: string;
  loanName: string;
  currency: string;
  balanceMinor: number;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const money = accounts.filter((account) => ['bank', 'cash', 'savings'].includes(account.subtype) && account.archivedAt === null);
  const today = isoDate();
  const next = useNextPayment(accountId, today);
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // The form fills itself in from the next scheduled row, once that row is known.
  const filled = draft ?? paymentDraftFrom(next.data, today, money[0]?.id ?? '', currency);
  const set = (patch: Partial<PaymentDraft>) => setDraft({ ...filled, ...patch });

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await recordLoanPayment(database, ws, paymentDraftToInput(filled, accountId, currency, balanceMinor, loanName, today));
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">Record a payment</h3>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Date">
          <Input type="date" value={filled.occurredOn} max={today} onChange={(e) => set({ occurredOn: e.target.value })} />
        </Field>
        <Field label={`Principal (${currency})`}>
          <Input value={filled.principal} inputMode="decimal" onChange={(e) => set({ principal: e.target.value })} />
        </Field>
        <Field label={`Interest (${currency})`}>
          <Input value={filled.interest} inputMode="decimal" onChange={(e) => set({ interest: e.target.value })} />
        </Field>
        <Field label="Paid from">
          <Select value={filled.moneyId} onChange={(e) => set({ moneyId: e.target.value })}>
            {money.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        {filled.extras.map((extra, index) => (
          <div key={index} className="grid grid-cols-[1fr_10rem] gap-2">
            <Select
              aria-label={`Extra ${index + 1} category`}
              value={extra.categoryId}
              onChange={(e) => set({ extras: filled.extras.map((row, i) => (i === index ? { ...row, categoryId: e.target.value } : row)) })}
            >
              <CategoryOptions ownerWide accounts={accounts} kind="expense" parentSuffix="(general)" />
            </Select>
            <Input
              aria-label={`Extra ${index + 1} amount`}
              value={extra.amount}
              inputMode="decimal"
              onChange={(e) => set({ extras: filled.extras.map((row, i) => (i === index ? { ...row, amount: e.target.value } : row)) })}
            />
          </div>
        ))}
        <Button variant="secondary" onClick={() => set({ extras: [...filled.extras, { categoryId: '', amount: '' }] })}>
          Add insurance or admin charge
        </Button>
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          Save payment
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/** A new rate period. Nothing is posted: no money moved. */
function RateChangeForm({ accountId, currency, onDone }: { accountId: string; currency: string; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [fromOn, setFromOn] = useState(isoDate());
  const [rate, setRate] = useState('');
  const [payment, setPayment] = useState('');
  const [kind, setKind] = useState<'fixed' | 'floating'>('floating');
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setError(null);
    try {
      const rateBps = Math.round((Number(rate.replace(',', '.')) || 0) * 100);
      if (!(rateBps > 0)) throw new Error('Enter the new rate');
      await addRatePeriod(database, ws, {
        accountId,
        fromOn,
        rateBps,
        kind,
        paymentMinor: payment.trim() === '' ? 0 : Number(payment.replace(/\./g, '')),
      });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">Rate change</h3>
      <p className="text-xs text-slate-500">The months before this keep the rate they had. Nothing is posted, because no money moved.</p>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="From">
          <Input type="date" value={fromOn} onChange={(e) => setFromOn(e.target.value)} />
        </Field>
        <Field label="New rate a year (%)">
          <Input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} placeholder="11" />
        </Field>
        <Field label="Rate kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'fixed' | 'floating')}>
            <option value="fixed">Fixed</option>
            <option value="floating">Floating</option>
          </Select>
        </Field>
        <Field label={`New payment (${currency})`} hint="Leave empty to work it out.">
          <Input value={payment} inputMode="decimal" onChange={(e) => setPayment(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button onClick={save}>Save rate change</Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/** Extra principal, with what it would do shown before anything is written. */
function ExtraPaymentForm({
  accountId,
  currency,
  balanceMinor,
  terms,
  onDone,
}: {
  accountId: string;
  currency: string;
  balanceMinor: number;
  terms: { originalMinor: number; firstPaymentOn: string; tenorMonths: number; method: 'annuity' | 'flat' | 'zero'; paymentDay: number; periods: { fromOn: string; rateBps: number; kind: 'fixed' | 'floating'; paymentMinor: number }[] };
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const money = accounts.filter((account) => ['bank', 'cash', 'savings'].includes(account.subtype) && account.archivedAt === null);
  const today = isoDate();
  const [amount, setAmount] = useState('');
  const [penalty, setPenalty] = useState('');
  const [keep, setKeep] = useState<'payment' | 'tenor'>('payment');
  const [repeat, setRepeat] = useState<'once' | 'monthly'>('once');
  const [moneyId, setMoneyId] = useState(money[0]?.id ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const amountMinor = amount.trim() === '' ? 0 : Number(amount.replace(/\./g, ''));
  const effect =
    amountMinor > 0
      ? extraPaymentEffect(
          balanceMinor,
          { originalMinor: terms.originalMinor, firstPaymentOn: terms.firstPaymentOn, tenorMonths: terms.tenorMonths, method: terms.method, paymentDay: terms.paymentDay },
          terms.periods,
          today,
          { amountMinor, onDate: today, repeat, keep },
        )
      : null;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (!(amountMinor > 0)) throw new Error('Enter how much extra to pay');
      await recordExtraPayment(database, ws, {
        accountId,
        occurredOn: today,
        moneyAccountId: moneyId,
        amountMinor,
        penaltyMinor: penalty.trim() === '' ? 0 : Number(penalty.replace(/\./g, '')),
        keep,
      });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">Pay extra off the principal</h3>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label={`How much (${currency})`}>
          <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="50.000.000" />
        </Field>
        <Field label="Then" hint="Finish sooner, or pay less each month.">
          <Select value={keep} onChange={(e) => setKeep(e.target.value as 'payment' | 'tenor')}>
            <option value="payment">Keep paying the same, finish sooner</option>
            <option value="tenor">Keep the tenor, pay less each month</option>
          </Select>
        </Field>
        <Field label="How often" hint="Only the once, or every month from now.">
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value as 'once' | 'monthly')}>
            <option value="once">Just this once</option>
            <option value="monthly">Every month</option>
          </Select>
        </Field>
        <Field label="Paid from">
          <Select value={moneyId} onChange={(e) => setMoneyId(e.target.value)}>
            {money.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Penalty the bank charges (${currency})`} hint="Leave empty when there is none.">
          <Input value={penalty} inputMode="decimal" onChange={(e) => setPenalty(e.target.value)} />
        </Field>
      </div>

      {effect && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="what-if">
          {keep === 'payment' ? (
            <>
              This pays off in {effect.payoffMonth}, {effect.monthsEarlier} months earlier, and saves {formatMinor(effect.interestSavedMinor, currency)} of interest.
            </>
          ) : (
            <>
              The payment falls to {formatMinor(effect.newPaymentMinor ?? 0, currency)}, and this saves {formatMinor(effect.interestSavedMinor, currency)} of interest.
            </>
          )}
          {effect.penaltyMinor > 0 && <> The bank charges {formatMinor(effect.penaltyMinor, currency)} for it.</>}
        </div>
      )}

      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>
          Save extra payment
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function LoanDetailPage() {
  const { ws } = useApp();
  const params = useParams({ strict: false }) as { accountId?: string };
  const accountId = params.accountId ?? '';
  const loan = useLoan(accountId);
  const schedule = useSchedule(accountId);
  const accounts = useAccounts().data ?? [];
  const balances = useBalances();
  const [open, setOpen] = useState<'payment' | 'rate' | 'extra' | null>(null);
  const [showRows, setShowRows] = useState(false);

  const account = accounts.find((row) => row.id === accountId);
  const currency = account?.currency ?? ws.baseCurrency;
  const balanceMinor = Math.abs(balances.data?.[accountId] ?? 0);
  const rows = schedule.data ?? [];
  const interestLeft = rows.reduce((total, row) => total + row.interestMinor, 0);
  const terms = loan.data;
  const rateBps = terms?.periods.at(-1)?.rateBps ?? 0;
  const effective = terms?.method === 'flat' && terms.tenorMonths > 1 ? flatToEffectiveBps(rateBps, terms.tenorMonths) : null;
  const repaidMinor = terms ? terms.originalMinor - balanceMinor : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={account?.name ?? 'Loan'}
        action={
          <Link to="/net-worth/loans" className="text-sm text-slate-600 hover:text-slate-900">
            Back to loans
          </Link>
        }
      />
      <ErrorBox error={loan.error ?? schedule.error} />
      {!terms && !loan.isPending && <Empty>This loan has no terms yet. Add them on the Loans tab to see its schedule.</Empty>}

      {terms && (
        <Card className="space-y-3">
          <div>
            <div className="text-xs text-slate-500">Still owed</div>
            <div className="text-3xl font-semibold">
              <Money minor={balanceMinor} currency={currency} />
            </div>
            <div className="text-sm text-slate-600">
              {terms.lenderName} · {rateBps / 100}% {terms.periods.at(-1)?.kind === 'floating' ? 'floating' : 'fixed'}
              {effective && ` · about ${(effective / 100).toFixed(2)}% effective`}
            </div>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">Payment</div>
              <Money minor={rows[0]?.paymentMinor ?? 0} currency={currency} className="font-medium" />
            </div>
            <div>
              <div className="text-xs text-slate-500">Next payment</div>
              <div className="font-medium">{rows[0]?.onDate ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Interest still to pay</div>
              <Money minor={interestLeft} currency={currency} className="font-medium" />
            </div>
            <div>
              <div className="text-xs text-slate-500">Pays off</div>
              <div className="font-medium">
                {rows.at(-1)?.onDate.slice(0, 7) ?? '—'} · {rows.length} months left
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Principal repaid</div>
              <Money minor={repaidMinor} currency={currency} className="font-medium" />
            </div>
          </div>

          {!open && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setOpen('payment')}>Record payment</Button>
              <Button variant="secondary" onClick={() => setOpen('rate')}>
                Rate change
              </Button>
              <Button variant="secondary" onClick={() => setOpen('extra')}>
                Extra payment
              </Button>
            </div>
          )}
        </Card>
      )}

      {open === 'payment' && terms && (
        <PaymentForm accountId={accountId} loanName={account?.name ?? 'This loan'} currency={currency} balanceMinor={balanceMinor} onDone={() => setOpen(null)} />
      )}
      {open === 'rate' && <RateChangeForm accountId={accountId} currency={currency} onDone={() => setOpen(null)} />}
      {open === 'extra' && terms && (
        <ExtraPaymentForm accountId={accountId} currency={currency} balanceMinor={balanceMinor} terms={terms} onDone={() => setOpen(null)} />
      )}

      {rows.length > 0 && (
        <Card className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">What is still to come</h2>
            <button type="button" className="text-xs text-slate-600 underline" onClick={() => setShowRows((shown) => !shown)}>
              {showRows ? 'Show the next twelve' : 'Show every month'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Due</th>
                  <th className="py-1 text-right">Payment</th>
                  <th className="py-1 text-right">Principal</th>
                  <th className="py-1 text-right">Interest</th>
                  <th className="py-1 text-right">Left after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(showRows ? rows : rows.slice(0, 12)).map((row) => (
                  <tr key={row.onDate}>
                    <td className="py-1">{row.onDate}</td>
                    <td className="tabular py-1 text-right">{minorToMajorString(row.paymentMinor, currency)}</td>
                    <td className="tabular py-1 text-right">{minorToMajorString(row.principalMinor, currency)}</td>
                    <td className="tabular py-1 text-right">{minorToMajorString(row.interestMinor, currency)}</td>
                    <td className="tabular py-1 text-right">{minorToMajorString(row.balanceMinor, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Worked out from what you still owe today. The payments you record are the truth; these rows are only what the terms imply from here.
          </p>
        </Card>
      )}
    </div>
  );
}
