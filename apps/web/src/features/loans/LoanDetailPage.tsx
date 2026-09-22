import { extraPaymentEffect, flatToEffectiveBps, formatMinor, isoDate, minorToMajorString, periodOn, utangLabel } from '@expanses/core';
import { addRatePeriod, type LoanTermsRow, recordExtraPayment, recordLoanPayment, setLoanCode } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { useSuggestedDraft } from '../../lib/suggested-draft';
import { Empty, ErrorBox } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle, Panel, ReadOnlyRow, RecordTable, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { useHeldRates } from '../accounts/queries';
import { CategoryOptions } from '../cards/options';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { UTANG_CHOICES } from '../ownables/catalogue-view';
import { type PaymentDraft, extraPaymentMinor, paymentDraftFrom, paymentDraftToInput } from './loan-form';
import { useLoan, useNextPayment, useSchedule } from './queries';

/**
 * What this loan files as in Bagian B, changed here rather than only where it was opened.
 *
 * The picker never showed a code — a mortgage is a mortgage — but the four kode utang are not interchangeable,
 * and only the borrower knows whether the money came from a bank or from an uncle. Only the code is written,
 * so that changing it changes the code and nothing else — the rate periods stay exactly as they stand.
 */
function LoanCodeField({ terms }: { terms: LoanTermsRow }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);

  async function choose(coretaxCode: string) {
    setError(null);
    try {
      // The code alone: rewriting the terms to carry it would drag the opening rate period to the first payment.
      await setLoanCode(database, ws, terms.accountId, coretaxCode);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <InsetGroup header="For the tax report" footer={utangLabel(terms.coretaxCode) || 'Not a code the form knows.'}>
        <SelectRow label="Tax report code" value={terms.coretaxCode} onChange={(e) => void choose(e.target.value)}>
          {UTANG_CHOICES.map((choice) => (
            <option key={choice.code} value={choice.code}>
              {choice.label}
            </option>
          ))}
        </SelectRow>
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}

/**
 * The rate a payment on this loan is posted at, and the row that asks for it while the day has none.
 *
 * The ledger values every line in the base currency, so a payment on a dollar loan cannot be written without the
 * dollar's rate for its day — and both of this page's doors (a recorded payment, and an extra one) posted with no
 * rate at all, so the ledger refused them with "No USD→IDR rate" and the screen held no way to hand one over. This
 * is the same reading Lend & borrow and every account form goes through: a typed rate is checked and stored for the
 * day, a blank one is resolved, and a missing one puts this row on screen rather than a refusal after the fact.
 */
function useRateForPayment(currency: string, onDate: string) {
  const { database, ws } = useApp();
  const resolveRates = useResolveRates();
  const [typed, setTyped] = useState('');
  const [needs, setNeeds] = useState<string | null>(null);
  const foreign = currency !== ws.baseCurrency;
  // Read from what this device already holds, never fetched just because the form opened (see `useStoredRates`).
  const held = useHeldRates(foreign ? [currency] : [], onDate);
  // Asked for when no rate is stored for the day, or when a save found none; left out while one is known.
  const asking = foreign && (needs === currency || (held.data?.missing ?? []).includes(currency));
  return {
    /** What the posting needs for this day and this figure — the map `recordLoanPayment` and `recordExtraPayment` take. */
    ratesToBase: (amountMinor: number) =>
      ratesForSave({ database, ws, currency, occurredOn: onDate, amountMinor, typed: asking ? typed : '', resolveRates, onMissing: setNeeds }),
    node: asking ? (
      <TextRow
        label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
        hint={ratePreview(typed, currency, ws.baseCurrency) ?? `No ${currency} rate is stored for this day. Leave empty to fetch it.`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        inputMode="decimal"
        placeholder="16250"
      />
    ) : null,
  };
}

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
  const money = moneyHolders(accounts).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype));
  const today = isoDate();
  const next = useNextPayment(accountId, today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // The form fills itself in from the next scheduled row and the first paying account, each once it is known, and
  // only in the fields nobody has touched: a row landing while the principal is being typed must not join the keys.
  const scheduled = next.isSuccess ? paymentDraftFrom(next.data, today, '', currency) : null;
  const suggestion: Partial<PaymentDraft> = {
    ...(scheduled && { occurredOn: scheduled.occurredOn, principal: scheduled.principal, interest: scheduled.interest }),
    ...(money[0] && { moneyId: money[0].id }),
  };
  const { value: filled, set, touch } = useSuggestedDraft(paymentDraftFrom(undefined, today, '', currency), suggestion);
  // What leaves the paying account, read off the input `save()` sends: principal, interest and every extra riding
  // along. An incomplete draft throws there, and asks nothing yet.
  const outflowMinor = (() => {
    try {
      const input = paymentDraftToInput(filled, accountId, currency, balanceMinor, loanName, today);
      return input.principalMinor + input.interestMinor + (input.extras ?? []).reduce((sum, extra) => sum + extra.amountMinor, 0);
    } catch {
      return 0;
    }
  })();
  const setAside = useSetAside(spendingDoor(filled.moneyId, outflowMinor));
  const rate = useRateForPayment(currency, filled.occurredOn);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const input = paymentDraftToInput(filled, accountId, currency, balanceMinor, loanName, today);
      const outflow = input.principalMinor + input.interestMinor + (input.extras ?? []).reduce((sum, extra) => sum + extra.amountMinor, 0);
      const ratesToBase = await rate.ratesToBase(outflow);
      await recordLoanPayment(database, ws, { ...input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <InsetGroup header="Record a payment">
        <TextRow label="Date" type="date" value={filled.occurredOn} onFocus={touch('occurredOn')} max={today} onChange={(e) => set({ occurredOn: e.target.value })} />
        <TextRow label={`Principal (${currency})`} value={filled.principal} inputMode="decimal" onFocus={touch('principal')} onChange={(e) => set({ principal: e.target.value })} />
        <TextRow label={`Interest (${currency})`} value={filled.interest} inputMode="decimal" onFocus={touch('interest')} onChange={(e) => set({ interest: e.target.value })} />
        <SelectRow label="Paid from" value={filled.moneyId} onFocus={touch('moneyId')} onChange={(e) => set({ moneyId: e.target.value })}>
          {money.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        {/* The rate, and only while the day has none: a loan in the base currency draws nothing here. */}
        {rate.node}
      </InsetGroup>

      <InsetGroup header="Riding along on it">
        {filled.extras.flatMap((extra, index) => [
          <SelectRow
            key={`category-${index}`}
            label="Category"
            aria-label={`Extra ${index + 1} category`}
            value={extra.categoryId}
            onChange={(e) => set({ extras: filled.extras.map((row, i) => (i === index ? { ...row, categoryId: e.target.value } : row)) })}
          >
            <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
          </SelectRow>,
          <TextRow
            key={`amount-${index}`}
            label="Amount"
            aria-label={`Extra ${index + 1} amount`}
            value={extra.amount}
            inputMode="decimal"
            onChange={(e) => set({ extras: filled.extras.map((row, i) => (i === index ? { ...row, amount: e.target.value } : row)) })}
          />,
        ])}
        <InsetRow title="Add insurance or admin charge" chevron={false} onClick={() => set({ extras: [...filled.extras, { categoryId: '', amount: '' }] })} />
      </InsetGroup>

      {setAside.node}
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow
          title="Save payment"
          chevron={false}
          disabled={!setAside.ready}
          onClick={() => !busy && setAside.ready && void save()}
          className={busy ? 'opacity-40' : undefined}
        />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </>
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
    <>
      <InsetGroup header="Rate change" footer="The months before this keep the rate they had. Nothing is posted, because no money moved.">
        <TextRow label="From" type="date" value={fromOn} onChange={(e) => setFromOn(e.target.value)} />
        <TextRow label="New rate a year (%)" value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} placeholder="11" />
        <SelectRow label="Rate kind" value={kind} onChange={(e) => setKind(e.target.value as 'fixed' | 'floating')}>
          <option value="fixed">Fixed</option>
          <option value="floating">Floating</option>
        </SelectRow>
        <TextRow
          label={`New payment (${currency})`}
          hint="Leave empty to work it out."
          value={payment}
          inputMode="decimal"
          onChange={(e) => setPayment(e.target.value)}
        />
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Save rate change" chevron={false} onClick={() => void save()} />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </>
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
  const money = moneyHolders(accounts).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype));
  const today = isoDate();
  const [amount, setAmount] = useState('');
  const [penalty, setPenalty] = useState('');
  const [keep, setKeep] = useState<'payment' | 'tenor'>('payment');
  const [repeat, setRepeat] = useState<'once' | 'monthly'>('once');
  const [moneyId, setMoneyId] = useState(money[0]?.id ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Both boxes read through the app's own reader, in the loan's own money — one reader for the extra and the
   * penalty alike. Read leniently here, where the figure only measures the question the door asks; `save` reads
   * the same boxes strictly, so a figure nothing can read is refused by name rather than posted as nothing.
   */
  const readMinor = (typed: string): number => {
    try {
      return extraPaymentMinor(typed, currency);
    } catch {
      return 0;
    }
  };
  const amountMinor = readMinor(amount);
  const penaltyMinor = readMinor(penalty);
  const setAside = useSetAside(spendingDoor(moneyId, amountMinor + penaltyMinor));
  const rate = useRateForPayment(currency, today);
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
      // Read strictly here, so the figure the repository posts is the one the reader read: blank is refused in the
      // door's own words, and a figure it cannot read at all is refused in the reader's.
      const paidMinor = extraPaymentMinor(amount, currency);
      if (!(paidMinor > 0)) throw new Error('Enter how much extra to pay');
      const feeMinor = extraPaymentMinor(penalty, currency);
      const ratesToBase = await rate.ratesToBase(paidMinor + Math.max(feeMinor, 0));
      await recordExtraPayment(database, ws, {
        accountId,
        occurredOn: today,
        moneyAccountId: moneyId,
        amountMinor: paidMinor,
        penaltyMinor: feeMinor,
        ratesToBase,
        keep,
        setAside: setAside.choice,
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
    <>
      <InsetGroup header="Pay extra off the principal">
        <TextRow label={`How much (${currency})`} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="50.000.000" />
        <SelectRow label="Then" hint="Finish sooner, or pay less each month." value={keep} onChange={(e) => setKeep(e.target.value as 'payment' | 'tenor')}>
          <option value="payment">Keep paying the same, finish sooner</option>
          <option value="tenor">Keep the tenor, pay less each month</option>
        </SelectRow>
        <SelectRow label="How often" hint="Only the once, or every month from now." value={repeat} onChange={(e) => setRepeat(e.target.value as 'once' | 'monthly')}>
          <option value="once">Just this once</option>
          <option value="monthly">Every month</option>
        </SelectRow>
        <SelectRow label="Paid from" value={moneyId} onChange={(e) => setMoneyId(e.target.value)}>
          {money.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label={`Penalty the bank charges (${currency})`}
          hint="Leave empty when there is none."
          value={penalty}
          inputMode="decimal"
          onChange={(e) => setPenalty(e.target.value)}
        />
        {/* The rate, and only while the day has none: a loan in the base currency draws nothing here. */}
        {rate.node}
      </InsetGroup>

      {effect && (
        <Panel testId="what-if" className="text-[13px] leading-[17px] text-[var(--ph-tint)]">
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
        </Panel>
      )}

      {setAside.node}
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow
          title="Save extra payment"
          chevron={false}
          disabled={!setAside.ready}
          onClick={() => !busy && setAside.ready && void save()}
          className={busy ? 'opacity-40' : undefined}
        />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </>
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
  // The period running today, not the latest one recorded: a rate change dated next year is not this year's rate.
  const current = terms ? periodOn(terms.periods, isoDate()) : undefined;
  const rateBps = current?.rateBps ?? 0;
  const effective = terms?.method === 'flat' && terms.tenorMonths > 1 ? flatToEffectiveBps(rateBps, terms.tenorMonths) : null;
  const repaidMinor = terms ? terms.originalMinor - balanceMinor : 0;

  return (
    <div className={SCREEN}>
      <LargeTitle title={account?.name ?? 'Loan'} back="Debts" backTo="/net-worth/loans" />
      <ErrorBox error={loan.error ?? schedule.error} />
      {!terms && !loan.isPending && <Empty>This loan has no terms yet. Add them on Debts to see its schedule.</Empty>}

      {terms && (
        <>
          <Hero
            minor={balanceMinor}
            currency={currency}
            caption={
              <>
                Still owed · {terms.lenderName} · {rateBps / 100}% {current?.kind === 'floating' ? 'floating' : 'fixed'}
                {effective && ` · about ${(effective / 100).toFixed(2)}% effective`}
              </>
            }
          />
          {/* The five figures were a grid of tiles that collapsed into a column at 390 px; they are lines now. */}
          <InsetGroup header="Where this loan stands">
            <ReadOnlyRow label="Payment" value={formatMinor(rows[0]?.paymentMinor ?? 0, currency)} />
            <ReadOnlyRow label="Next payment" value={rows[0]?.onDate ?? '—'} />
            <ReadOnlyRow label="Interest still to pay" value={formatMinor(interestLeft, currency)} />
            <ReadOnlyRow label="Pays off" value={`${rows.at(-1)?.onDate.slice(0, 7) ?? '—'} · ${rows.length} months left`} />
            <ReadOnlyRow label="Principal repaid" value={formatMinor(repaidMinor, currency)} />
          </InsetGroup>

          <LoanCodeField terms={terms} />

          {!open && (
            <InsetGroup>
              <InsetRow title="Record payment" chevron={false} onClick={() => setOpen('payment')} />
              <InsetRow title="Rate change" chevron={false} onClick={() => setOpen('rate')} />
              <InsetRow title="Extra payment" chevron={false} onClick={() => setOpen('extra')} />
            </InsetGroup>
          )}
        </>
      )}

      {open === 'payment' && terms && (
        <PaymentForm accountId={accountId} loanName={account?.name ?? 'This loan'} currency={currency} balanceMinor={balanceMinor} onDone={() => setOpen(null)} />
      )}
      {open === 'rate' && <RateChangeForm accountId={accountId} currency={currency} onDone={() => setOpen(null)} />}
      {open === 'extra' && terms && (
        <ExtraPaymentForm accountId={accountId} currency={currency} balanceMinor={balanceMinor} terms={terms} onDone={() => setOpen(null)} />
      )}

      {rows.length > 0 && (
        <>
          {/*
           * Five numeric columns that overlapped illegibly at 390 px. The kit's rule: a real table on desktop,
           * where every column stays, and one row a month on a phone — due date, what it costs, and the split
           * of it under the date.
           */}
          <RecordTable
            header="What is still to come"
            records={showRows ? rows : rows.slice(0, 12)}
            columns={[
              { key: 'due', heading: 'Due', cell: (row) => row.onDate },
              { key: 'payment', heading: 'Payment', numeric: true, cell: (row) => minorToMajorString(row.paymentMinor, currency) },
              { key: 'principal', heading: 'Principal', numeric: true, cell: (row) => minorToMajorString(row.principalMinor, currency) },
              { key: 'interest', heading: 'Interest', numeric: true, cell: (row) => minorToMajorString(row.interestMinor, currency) },
              { key: 'left', heading: 'Left after', numeric: true, cell: (row) => minorToMajorString(row.balanceMinor, currency) },
            ]}
            /* A schedule line opens nothing, so "Left after" has nowhere to wait: the table stays a table here too. */
            detail={{ kind: 'none' }}
            shape={{
              key: (row) => row.onDate,
              title: (row) => row.onDate,
              subtitle: (row) => `${minorToMajorString(row.principalMinor, currency)} principal · ${minorToMajorString(row.interestMinor, currency)} interest`,
              value: (row) => minorToMajorString(row.paymentMinor, currency),
              valueTone: () => 'ink',
            }}
          />
          <InsetGroup footer="Worked out from what you still owe today. The payments you record are the truth; these rows are only what the terms imply from here.">
            <InsetRow title={showRows ? 'Show the next twelve' : 'Show every month'} chevron={false} onClick={() => setShowRows((shown) => !shown)} />
          </InsetGroup>
        </>
      )}
    </div>
  );
}
