import { debtItem, extraPaymentEffect, flatToEffectiveBps, formatMinor, isoDate, minorToMajorString, payoffQuote, periodOn } from '@expanses/core';
import { addRatePeriod, type LoanTermsRow, payOffLoan, recordExtraPayment, recordLoanPayment, setLoanCode } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { Banknote, CircleCheck, CirclePlus, FileText, MoreHorizontal, Pencil, Percent } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { useSuggestedDraft } from '../../lib/suggested-draft';
import { Empty, ErrorBox } from '../../ui';
import { ActionButtons, type CornerAction, InsetGroup, InsetRow, Panel, PushedTitle, RecordTable, type RoundAction, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { useHeldRates, useRecentTransactions } from '../accounts/queries';
import { CategoryOptions } from '../cards/options';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { dayLabel } from '../networth/asset-page';
import { CashRow, CashSheet, ResultRow, TypedRow, useCashSide } from '../networth/trade-sheet-parts';
import { UTANG_CHOICES } from '../ownables/catalogue-view';
import { ShareWithHouseholdRow } from '../sharing/ShareWithHousehold';
import { type PaymentDraft, extraPaymentMinor, paymentDraftFrom, paymentDraftToInput } from './loan-form';
import { loanPayments, monthYearLabel, percentBps, rateText, repaidPercent, soonerText } from './loan-view';
import { TermsForm } from './TermsForm';
import { useLoan, useLoanItems, useNextPayment, useSchedule } from './queries';

/**
 * What this loan files as in Bagian B, changed here rather than only where it was opened.
 *
 * The picker never showed a code — a mortgage is a mortgage — but the four kode utang are not interchangeable,
 * and only the borrower knows whether the money came from a bank or from an uncle. Only the code is written,
 * so that changing it changes the code and nothing else — the rate periods stay exactly as they stand.
 *
 * It lives behind the page's ⋯, in a sheet of its own: it is set once in a loan's life, never on the way to a payment.
 */
function LoanCodeSheet({ terms, onClose }: { terms: LoanTermsRow; onClose: () => void }) {
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
    <Sheet grouped title="Tax report code" onClose={onClose}>
      <InsetGroup>
        <SelectRow
          label="Tax report code"
          info="The kode utang this loan is filed under in the tax report's list of debts. A bank's loan and a loan from family file under different codes."
          value={terms.coretaxCode}
          onChange={(e) => void choose(e.target.value)}
        >
          {UTANG_CHOICES.map((choice) => (
            <option key={choice.code} value={choice.code}>
              {choice.label}
            </option>
          ))}
        </SelectRow>
      </InsetGroup>
      <ErrorBox error={error} />
    </Sheet>
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

/** The accounts a loan is paid from: the ones money is spent from. */
function usePayingAccounts() {
  const accounts = useAccounts().data ?? [];
  return { accounts, money: moneyHolders(accounts).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype)) };
}

/** A sheet's save: the error it ended in, whether it is under way, and the run itself. */
function useSave(onDone: () => void) {
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run(write: () => Promise<unknown>) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await write();
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { run, error, busy };
}

/** Pay: records the instalment the schedule says is next, with anything riding along on it. */
function PaySheet({
  accountId,
  loanName,
  currency,
  balanceMinor,
  onClose,
}: {
  accountId: string;
  loanName: string;
  currency: string;
  balanceMinor: number;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const { accounts, money } = usePayingAccounts();
  const today = isoDate();
  const next = useNextPayment(accountId, today);
  const saving = useSave(onClose);

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

  const save = () =>
    saving.run(async () => {
      const input = paymentDraftToInput(filled, accountId, currency, balanceMinor, loanName, today);
      const outflow = input.principalMinor + input.interestMinor + (input.extras ?? []).reduce((sum, extra) => sum + extra.amountMinor, 0);
      const ratesToBase = await rate.ratesToBase(outflow);
      await recordLoanPayment(database, ws, { ...input, ratesToBase, setAside: setAside.choice });
    });

  return (
    <Sheet grouped tall title="Pay" onClose={onClose} confirm={{ label: 'Save payment', disabled: saving.busy || !setAside.ready, run: () => void save() }}>
      <InsetGroup>
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
        <InsetRow
          title={<span className="font-normal text-[var(--ph-tint)]">Add insurance or admin charge</span>}
          label="Add insurance or admin charge"
          chevron={false}
          onClick={() => set({ extras: [...filled.extras, { categoryId: '', amount: '' }] })}
        />
      </InsetGroup>

      {setAside.node}
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

/** Rate change: a new rate period. Nothing is posted: no money moved. */
function RateChangeSheet({ accountId, currency, onClose }: { accountId: string; currency: string; onClose: () => void }) {
  const { database, ws } = useApp();
  const [fromOn, setFromOn] = useState(isoDate());
  const [rate, setRate] = useState('');
  const [payment, setPayment] = useState('');
  const [kind, setKind] = useState<'fixed' | 'floating'>('floating');
  const saving = useSave(onClose);

  const save = () =>
    saving.run(async () => {
      const rateBps = Math.round((Number(rate.replace(',', '.')) || 0) * 100);
      if (!(rateBps > 0)) throw new Error('Enter the new rate');
      await addRatePeriod(database, ws, {
        accountId,
        fromOn,
        rateBps,
        kind,
        paymentMinor: payment.trim() === '' ? 0 : Number(payment.replace(/\./g, '')),
      });
    });

  return (
    <Sheet grouped tall title="Rate change" onClose={onClose} confirm={{ label: 'Save rate change', disabled: saving.busy, run: () => void save() }}>
      <InsetGroup>
        <TextRow
          label="From"
          type="date"
          info="The months before this keep the rate they had. Nothing is posted, because no money moved."
          value={fromOn}
          onChange={(e) => setFromOn(e.target.value)}
        />
        <TextRow label="New rate a year (%)" value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} placeholder="11" />
        <SelectRow label="Rate kind" value={kind} onChange={(e) => setKind(e.target.value as 'fixed' | 'floating')}>
          <option value="fixed">Fixed</option>
          <option value="floating">Floating</option>
        </SelectRow>
        <TextRow
          label={`New payment (${currency})`}
          info="Left empty, it is worked out from the new rate."
          value={payment}
          inputMode="decimal"
          onChange={(e) => setPayment(e.target.value)}
          placeholder="Worked out"
        />
      </InsetGroup>
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

const WHAT_IF_INFO =
  'Worked out from today\'s balance and the terms. Saving records this one extra payment only: "Every year" and "Every month" are a what-if, and each later extra is recorded when it is paid.';

/** Pay extra: extra principal, with what it would do — once, every year or every month — shown before anything is written. */
function PayExtraSheet({
  accountId,
  currency,
  balanceMinor,
  terms,
  onClose,
}: {
  accountId: string;
  currency: string;
  balanceMinor: number;
  terms: LoanTermsRow;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const { money } = usePayingAccounts();
  const today = isoDate();
  const [amount, setAmount] = useState('');
  const [penalty, setPenalty] = useState('');
  const [keep, setKeep] = useState<'payment' | 'tenor'>('payment');
  const [repeat, setRepeat] = useState<'once' | 'yearly' | 'monthly'>('once');
  const [moneyId, setMoneyId] = useState(money[0]?.id ?? '');
  const saving = useSave(onClose);

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
  const paidFrom = moneyId || money[0]?.id || '';
  const setAside = useSetAside(spendingDoor(paidFrom, amountMinor + penaltyMinor));
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
  const sooner = effect ? soonerText(effect.monthsEarlier) : null;

  const save = () =>
    saving.run(async () => {
      // Read strictly here, so the figure the repository posts is the one the reader read: blank is refused in the
      // door's own words, and a figure it cannot read at all is refused in the reader's.
      const paidMinor = extraPaymentMinor(amount, currency);
      if (!(paidMinor > 0)) throw new Error('Enter how much extra to pay');
      const feeMinor = extraPaymentMinor(penalty, currency);
      const ratesToBase = await rate.ratesToBase(paidMinor + Math.max(feeMinor, 0));
      await recordExtraPayment(database, ws, {
        accountId,
        occurredOn: today,
        moneyAccountId: paidFrom,
        amountMinor: paidMinor,
        penaltyMinor: feeMinor,
        ratesToBase,
        keep,
        setAside: setAside.choice,
      });
    });

  return (
    <Sheet grouped tall title="Pay extra" onClose={onClose} confirm={{ label: 'Save extra payment', disabled: saving.busy || !setAside.ready, run: () => void save() }}>
      <InsetGroup>
        <TextRow label={`How much (${currency})`} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="50.000.000" />
        <SelectRow label="How often" value={repeat} onChange={(e) => setRepeat(e.target.value as 'once' | 'yearly' | 'monthly')}>
          <option value="once">Once</option>
          <option value="yearly">Every year</option>
          <option value="monthly">Every month</option>
        </SelectRow>
        <SelectRow label="Then" value={keep} onChange={(e) => setKeep(e.target.value as 'payment' | 'tenor')}>
          <option value="payment">Shorter loan</option>
          <option value="tenor">Lower payment</option>
        </SelectRow>
      </InsetGroup>

      {effect && (
        <div data-testid="what-if">
          <InsetGroup>
            <ResultRow testId="what-if-saved" label="Interest saved" info={WHAT_IF_INFO} value={formatMinor(effect.interestSavedMinor, currency)} />
            {keep === 'tenor' && effect.newPaymentMinor !== null && effect.monthsEarlier === 0 ? (
              <ResultRow testId="what-if-payment" label="New payment" value={formatMinor(effect.newPaymentMinor, currency)} />
            ) : (
              <ResultRow testId="what-if-finish" label="Finishes" value={`${monthYearLabel(effect.payoffMonth)}${sooner ? ` (${sooner})` : ''}`} />
            )}
          </InsetGroup>
        </div>
      )}

      <InsetGroup>
        <SelectRow label="Paid from" value={paidFrom} onChange={(e) => setMoneyId(e.target.value)}>
          {money.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label={`Penalty the bank charges (${currency})`}
          info="What the bank charges for paying early, booked as a fee and never as principal. Left empty when there is none."
          value={penalty}
          inputMode="decimal"
          onChange={(e) => setPenalty(e.target.value)}
          placeholder="None"
        />
        {/* The rate, and only while the day has none: a loan in the base currency draws nothing here. */}
        {rate.node}
      </InsetGroup>

      {setAside.node}
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

const STILL_OWED_INFO =
  "The principal the ledger holds today. Interest since the last instalment is not worked out here: when the bank's figure includes it, the difference goes in the fee.";

/** Pay off: everything still owed and the bank's fee for settling early, in one payment that clears the loan. */
function PayOffSheet({ accountId, currency, balanceMinor, onClose }: { accountId: string; currency: string; balanceMinor: number; onClose: () => void }) {
  const { database, ws } = useApp();
  const { money } = usePayingAccounts();
  const today = isoDate();
  const side = useCashSide(money[0]?.id ?? null);
  const [picking, setPicking] = useState(false);
  const [fee, setFee] = useState('');
  const [asShare, setAsShare] = useState(false);
  const [occurredOn, setOccurredOn] = useState(today);
  const saving = useSave(onClose);

  const feeAmount = (() => {
    try {
      return extraPaymentMinor(fee, currency);
    } catch {
      return 0;
    }
  })();
  const shareBps = asShare ? percentBps(fee) : null;
  const quote = payoffQuote(
    balanceMinor,
    asShare ? (shareBps === null ? null : { kind: 'percent', bps: shareBps }) : feeAmount > 0 ? { kind: 'amount', amountMinor: feeAmount } : null,
  );
  const setAside = useSetAside(spendingDoor(side.cashAccountId, quote.totalMinor));
  const rate = useRateForPayment(currency, occurredOn);

  const save = () =>
    saving.run(async () => {
      if (!side.cashAccountId) throw new Error('Choose the account it is paid from');
      const ratesToBase = await rate.ratesToBase(quote.totalMinor);
      await payOffLoan(database, ws, { accountId, occurredOn, moneyAccountId: side.cashAccountId, feeMinor: quote.feeMinor, ratesToBase, setAside: setAside.choice });
    });

  return (
    <Sheet
      grouped
      tall
      title="Pay off"
      onClose={onClose}
      confirm={{ label: 'Record pay off', disabled: saving.busy || !setAside.ready || !(balanceMinor > 0) || !side.cashAccountId || occurredOn > today, run: () => void save() }}
    >
      <InsetGroup>
        <ResultRow testId="pay-off-owed" label="Still owed" info={STILL_OWED_INFO} value={formatMinor(quote.owedMinor, currency)} valueClass="text-[var(--ph-ink)]" />
        <TypedRow
          label="Early settlement fee"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          inputMode="decimal"
          placeholder={asShare ? '% of owed' : 'None'}
          pill={{ label: '%', on: asShare, run: () => setAsShare((was) => !was) }}
        />
        {asShare && quote.feeMinor > 0 && <ResultRow testId="pay-off-fee" label="Fee" value={formatMinor(quote.feeMinor, currency)} />}
        <ResultRow testId="pay-off-total" label="Total" value={formatMinor(quote.totalMinor, currency)} valueClass="font-semibold text-[var(--ph-ink)]" />
      </InsetGroup>

      <InsetGroup>
        <CashRow label="Paid from" side={side} onOpen={() => setPicking(true)} />
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
        {/* The rate, and only while the day has none: a loan in the base currency draws nothing here. */}
        {rate.node}
      </InsetGroup>

      {setAside.node}
      <ErrorBox error={saving.error} />
      {picking && <CashSheet title="Paid from" side={side} onClose={() => setPicking(false)} />}
    </Sheet>
  );
}

const SCHEDULE_INFO = "Worked out from today's balance. The payments recorded are the truth; these rows are only what the terms imply from here.";

/** Schedule: every month still to come, twelve at first and every one on asking. */
function ScheduleSheet({ rows, currency, onClose }: { rows: { onDate: string; paymentMinor: number; principalMinor: number; interestMinor: number; balanceMinor: number }[]; currency: string; onClose: () => void }) {
  const [showRows, setShowRows] = useState(false);
  return (
    <Sheet grouped tall expanded title="Schedule" onClose={onClose}>
      <InsetGroup>
        <ResultRow label="Months left" info={SCHEDULE_INFO} value={String(rows.length)} valueClass="text-[var(--ph-ink)]" />
      </InsetGroup>
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
      {rows.length > 12 && (
        <InsetGroup>
          <InsetRow
            title={<span className="font-normal text-[var(--ph-tint)]">{showRows ? 'Show the next twelve' : 'Show every month'}</span>}
            label={showRows ? 'Show the next twelve' : 'Show every month'}
            chevron={false}
            onClick={() => setShowRows((shown) => !shown)}
          />
        </InsetGroup>
      )}
    </Sheet>
  );
}

/** A figure grouped as money is, without the currency's sign: "1.860.396". */
const bare = (minor: number, currency: string) => formatMinor(minor, currency).replace(/^[^\d]+/, '');

/** Payments: the last two recorded against the loan, each split into what came off it and what it paid for, and the rest. */
function RecentPayments({ accountId, currency }: { accountId: string; currency: string }) {
  const recent = useRecentTransactions([accountId]);
  const payments = loanPayments(recent.data ?? [], accountId).slice(0, 2);
  if (!recent.isSuccess) return null;
  return (
    <>
      <ErrorBox error={recent.error} />
      <InsetGroup header="Payments">
        {payments.length === 0 && <InsetRow title={<span className="font-normal text-[var(--ph-ink-3)]">No payments yet</span>} label="No payments yet" chevron={false} />}
        {payments.map((payment) => (
          <InsetRow
            key={payment.id}
            testId="loan-payment"
            title={dayLabel(payment.occurredOn)}
            subtitle={[
              // Without the currency, which the amount beside it already says, so the split fits a phone's line.
              `${bare(payment.principalMinor, currency)} principal`,
              ...payment.charges.map((charge) => `${bare(charge.minor, currency)} ${charge.name.toLowerCase()}`),
            ].join(' · ')}
            value={formatMinor(payment.totalMinor, currency)}
            valueTone="ink"
            to="/transactions/$transactionId"
            params={{ transactionId: payment.id }}
          />
        ))}
        <InsetRow
          key="all"
          title={<span className="font-normal text-[var(--ph-tint)]">See all</span>}
          label="See all"
          to="/transactions"
          search={{ account: accountId }}
        />
      </InsetGroup>
    </>
  );
}

/** The 6 px bar of principal repaid, with how much of it on the left and when the loan ends on the right. */
function RepaidBar({ percent, end }: { percent: number; end: string }) {
  return (
    <div className="space-y-[6px] pt-1">
      <div
        role="progressbar"
        aria-label="Principal repaid"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="w-full overflow-hidden rounded-full bg-[var(--ph-track)]"
        style={{ height: 6 }}
      >
        <div className="h-full rounded-full bg-[var(--ph-tint)]" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex justify-between text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
        <span data-testid="loan-repaid">{percent}% repaid</span>
        <span data-testid="loan-end">{end}</span>
      </div>
    </div>
  );
}

type Opened = 'pay' | 'extra' | 'rate' | 'pay-off' | 'schedule' | 'terms' | 'code' | null;

const TERMS_FORM = 'loan-edit-terms';

/**
 * `/net-worth/loans/$accountId` — one bank loan: a mortgage, a car loan, a KTA.
 *
 * Drawn as an account's page is: the name in the bar with its ⋯, a card with what is still owed and how much of it is
 * repaid, four round actions under it, when the next payment falls, and the last payments with the way to the rest.
 * Each action opens a sheet over the page, so saving lands back on the loan with its figures already moved.
 */
export function LoanDetailPage() {
  const { ws } = useApp();
  const params = useParams({ strict: false }) as { accountId?: string };
  const accountId = params.accountId ?? '';
  const loan = useLoan(accountId);
  const schedule = useSchedule(accountId);
  const kinds = useLoanItems();
  const accounts = useAccounts().data ?? [];
  const balances = useBalances();
  const [opened, setOpened] = useState<Opened>(null);
  /** The terms of a loan that has none yet are written on the page itself: there is nothing else to show. */
  const [adding, setAdding] = useState(false);
  const close = () => setOpened(null);

  const account = accounts.find((row) => row.id === accountId);
  const name = account?.name ?? 'Loan';
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
  const itemId = kinds.data?.[accountId] ?? '';
  const kindLabel = (() => {
    try {
      return itemId ? debtItem(itemId).label : null;
    } catch {
      return null;
    }
  })();
  const paidOff = terms?.status === 'paid_off' || (terms !== null && terms !== undefined && balances.isSuccess && balanceMinor === 0);
  const next = rows[0];

  const menu: CornerAction[] = terms
    ? [
        {
          key: 'more',
          label: 'More',
          glyph: <MoreHorizontal size={20} aria-hidden />,
          menu: [
            { key: 'terms', label: 'Edit terms', glyph: <Pencil size={18} aria-hidden />, run: () => setOpened('terms') },
            { key: 'code', label: 'Tax report code', glyph: <FileText size={18} aria-hidden />, run: () => setOpened('code') },
          ],
        },
      ]
    : [];

  const actions: RoundAction[] = paidOff
    ? []
    : [
        { key: 'pay', label: 'Pay', glyph: <Banknote size={20} aria-hidden />, run: () => setOpened('pay') },
        { key: 'extra', label: 'Pay extra', glyph: <CirclePlus size={20} aria-hidden />, run: () => setOpened('extra') },
        { key: 'rate', label: 'Rate change', glyph: <Percent size={20} aria-hidden />, run: () => setOpened('rate') },
        { key: 'pay-off', label: 'Pay off', glyph: <CircleCheck size={20} aria-hidden />, run: () => setOpened('pay-off') },
      ];

  return (
    <div className={SCREEN}>
      <PushedTitle title={name} back="Liabilities" backTo="/net-worth/loans" actions={menu} />
      <ErrorBox error={loan.error ?? schedule.error} />

      {!terms && !loan.isPending && (adding ? (
        <TermsForm accountId={accountId} itemId={itemId} onDone={() => setAdding(false)} />
      ) : (
        <>
          <Empty>This loan has no terms yet. Its schedule is worked out from them.</Empty>
          <InsetGroup>
            <InsetRow title="Add loan terms" chevron={false} onClick={() => setAdding(true)} />
          </InsetGroup>
        </>
      ))}

      {terms && (
        <>
          <Panel className="space-y-3" testId="loan-card">
            <div>
              <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Still owed</p>
              <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="card-figure">
                {formatMinor(balanceMinor, currency)}
              </p>
              <p className="mt-[2px] text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="loan-line">
                {[terms.lenderName, `${rateText(rateBps)} ${current?.kind === 'floating' ? 'floating' : 'fixed'}`, kindLabel].filter(Boolean).join(' · ')}
                {effective !== null && ` · about ${rateText(effective)} effective`}
              </p>
            </div>
            <RepaidBar
              percent={paidOff ? 100 : repaidPercent(terms.originalMinor, balanceMinor)}
              end={paidOff ? (terms.statusOn ? `Paid off ${dayLabel(terms.statusOn)}` : 'Paid off') : rows.length > 0 ? `Pays off ${monthYearLabel(rows.at(-1)!.onDate)}` : ''}
            />
          </Panel>

          <ActionButtons actions={actions} />

          {next && (
            <InsetGroup header="Next payment">
              <InsetRow title="Due" value={dayLabel(next.onDate)} valueTone="ink" chevron={false} />
              <InsetRow title="Amount" value={formatMinor(next.paymentMinor, currency)} valueTone="ink" chevron={false} />
              <InsetRow title="Months left" value={String(rows.length)} valueTone="ink" chevron={false} />
              <InsetRow title="Interest still to pay" value={formatMinor(interestLeft, currency)} valueTone="ink" chevron={false} />
              <InsetRow title="Principal repaid" value={formatMinor(repaidMinor, currency)} valueTone="ink" chevron={false} />
              <InsetRow title="Schedule" onClick={() => setOpened('schedule')} />
            </InsetGroup>
          )}
          {!next && (
            <InsetGroup>
              <InsetRow title="Principal repaid" value={formatMinor(repaidMinor, currency)} valueTone="ink" chevron={false} />
            </InsetGroup>
          )}

          <RecentPayments accountId={accountId} currency={currency} />
        </>
      )}

      {/* Joint net worth (§8.1): what the household sees of it. Nothing while this person is in no group. */}
      <ShareWithHouseholdRow accountId={accountId} />

      {terms && opened === 'pay' && <PaySheet accountId={accountId} loanName={name} currency={currency} balanceMinor={balanceMinor} onClose={close} />}
      {terms && opened === 'extra' && <PayExtraSheet accountId={accountId} currency={currency} balanceMinor={balanceMinor} terms={terms} onClose={close} />}
      {terms && opened === 'rate' && <RateChangeSheet accountId={accountId} currency={currency} onClose={close} />}
      {terms && opened === 'pay-off' && <PayOffSheet accountId={accountId} currency={currency} balanceMinor={balanceMinor} onClose={close} />}
      {opened === 'schedule' && <ScheduleSheet rows={rows} currency={currency} onClose={close} />}
      {terms && opened === 'code' && <LoanCodeSheet terms={terms} onClose={close} />}
      {terms && opened === 'terms' && (
        <Sheet
          grouped
          tall
          expanded
          title="Edit terms"
          onClose={close}
          confirm={{ label: 'Save terms', run: () => (document.getElementById(TERMS_FORM) as HTMLFormElement | null)?.requestSubmit() }}
        >
          {/* The agreement itself, correctable from the loan it belongs to rather than only writable once. */}
          <TermsForm accountId={accountId} terms={terms} itemId={itemId} formId={TERMS_FORM} onDone={close} />
        </Sheet>
      )}
    </div>
  );
}
