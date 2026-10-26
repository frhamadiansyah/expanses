import { categoryPath, CURRENCIES, isoDate, minorToMajorString, monthName, ordinal, parseMajor, sinkingPlan } from '@expanses/core';
import { saveExpenseTemplate } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith, SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, PickerRow, SCREEN, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { CategoryPicker } from '../transactions/CategoryPicker';
import { useExpenseTemplates } from '../transactions/queries';
import { amountInput } from './bill-view';
import { useSinkingFunds } from './queries';

const FUND_ACCOUNT_KEY = 'expanses.sinking-account';
const lastFundAccount = (): string => {
  try {
    return localStorage.getItem(FUND_ACCOUNT_KEY) ?? '';
  } catch {
    return '';
  }
};
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function EditBillRoute() {
  const { billId } = useParams({ from: '/bills/$billId/edit' });
  return <BillFormPage billId={billId} />;
}

/**
 * A bill's own page, for adding one or changing it: what it is, what it costs, and when it is out and due.
 *
 * Its own page rather than inline in a list — the schedule (out day, pay-by day) needs room the list row does not
 * have, and the same form serves an edit by loading the bill it was given.
 */
export function BillFormPage({ billId }: { billId?: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const templates = useExpenseTemplates();
  const funds = useSinkingFunds(isoDate());

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryAccountId, setCategoryAccountId] = useState('');
  const [moneyAccountId, setMoneyAccountId] = useState('');
  // '' follows the account that pays: the bill is then written in that account's money, as every bill was before this.
  const [currency, setCurrency] = useState('');
  // Every month, or once a year in the month chosen below.
  const [repeat, setRepeat] = useState<'monthly' | 'yearly'>('monthly');
  const [month, setMonth] = useState('');
  // A yearly bill can save up each month in an account already held; '' monthly follows the worked-out figure.
  const [fundOn, setFundOn] = useState(false);
  const [fundAccountId, setFundAccountId] = useState('');
  const [fundMonthly, setFundMonthly] = useState('');
  const [outDay, setOutDay] = useState('');
  const [payBy, setPayBy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const chosen = (accounts.data ?? []).find((account) => account.id === categoryAccountId);
  // What a bill is paid with: money kept for spending, or a card — the same answer every "Paid with" gives.
  const wallets = moneyHolders(accounts.data ?? []).filter((account) => canPayWith(account, moneyAccountId));
  // What the Currency row shows and the amount is read in: the one picked, else the payer's, else the workspace's.
  const payerCurrency = (accounts.data ?? []).find((account) => account.id === moneyAccountId)?.currency ?? ws.baseCurrency;
  const billCurrency = currency || payerCurrency;

  // Money the fund can be set aside in: spendable accounts (savings included) in the bill's money; the saved one is kept.
  const fundAccounts = moneyHolders(accounts.data ?? []).filter(
    (account) => account.id === fundAccountId || (account.kind === 'asset' && SPENDABLE_SUBTYPES.includes(account.subtype) && (account.currency ?? ws.baseCurrency) === billCurrency),
  );
  const parsedAmount = (() => {
    try {
      return amount.trim() ? parseMajor(amount.trim(), billCurrency) : null;
    } catch {
      return null;
    }
  })();
  // What each month comes to, from the amount and the months left; the field shows it until another is typed.
  const worked =
    parsedAmount !== null && parsedAmount > 0 && month !== '' && outDay !== ''
      ? sinkingPlan({ targetMinor: parsedAmount, today: isoDate(), repeatMonth: Number(month), dayOfMonth: Number(outDay), currency: billCurrency }).monthlyMinor
      : null;

  // Filled once the bill being edited has arrived; not kept in sync after, so typing is never clobbered.
  useEffect(() => {
    if (!billId || loaded || !accounts.data || funds.isPending) return;
    const bill = (templates.data ?? []).find((t) => t.id === billId);
    if (!bill) return;
    setName(bill.name);
    // Written in the bill's own currency (else the paying account's), the one save parses it back in: a USD bill must not read as rupiah.
    const payer = accounts.data.find((account) => account.id === bill.moneyAccountId);
    setAmount(amountInput(bill.amountMinor, bill.currency ?? payer?.currency ?? ws.baseCurrency));
    setCurrency(bill.currency ?? '');
    setCategoryAccountId(bill.categoryAccountId);
    setMoneyAccountId(bill.moneyAccountId);
    setRepeat(bill.repeat);
    setMonth(bill.repeatMonth === null ? '' : String(bill.repeatMonth));
    setOutDay(String(bill.dayOfMonth));
    setPayBy(String(bill.payByDay ?? ''));
    const fund = (funds.data ?? []).find((f) => f.billId === billId);
    if (fund) {
      setFundOn(true);
      setFundAccountId(fund.accountId);
      setFundMonthly(minorToMajorString(fund.monthlyMinor, fund.currency));
    }
    setLoaded(true);
  }, [billId, loaded, templates.data, accounts.data, funds.data, ws.baseCurrency]);

  // A new fund starts on the account last used, else the first savings account, else the first account that can hold it.
  useEffect(() => {
    if (!fundOn || fundAccountId || !accounts.data) return;
    const saved = lastFundAccount();
    const pick = fundAccounts.find((a) => a.id === saved) ?? fundAccounts.find((a) => a.subtype === 'savings') ?? fundAccounts[0];
    if (pick) setFundAccountId(pick.id);
  }, [fundOn, fundAccountId, accounts.data, fundAccounts]);
  // Until the bill has loaded there is nothing to type into: a field typed in first would be overwritten by the
  // bill as it lands, and a Save would write the blank form over it. A bill that is no longer there opens blank.
  const waiting = Boolean(billId) && !loaded && !templates.isError && !(templates.isSuccess && !(templates.data ?? []).some((t) => t.id === billId));

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (repeat === 'yearly' && month === '') {
      setError(new Error('Choose the month'));
      return;
    }
    if (outDay === '') {
      setError(new Error('Choose the bill date'));
      return;
    }
    const saving = repeat === 'yearly' && fundOn;
    if (saving && parsedAmount === null) {
      setError(new Error('A sinking fund needs a fixed amount'));
      return;
    }
    try {
      await saveExpenseTemplate(database, ws, {
        id: billId,
        name,
        categoryAccountId,
        moneyAccountId,
        amountMinor: amount.trim() === '' ? null : parseMajor(amount.trim(), billCurrency),
        currency: currency || null,
        repeat,
        repeatMonth: repeat === 'yearly' ? Number(month) : null,
        dayOfMonth: Number(outDay),
        payByDay: payBy === '' ? null : Number(payBy),
        fund: saving ? { accountId: fundAccountId, monthlyMinor: fundMonthly.trim() === '' ? null : parseMajor(fundMonthly.trim(), billCurrency) } : null,
      });
      if (saving) {
        try {
          localStorage.setItem(FUND_ACCOUNT_KEY, fundAccountId);
        } catch {
          // Private windows may refuse storage; the account is then simply not remembered.
        }
      }
      await invalidate();
      // A new bill has no page yet to land on; an edit came from one, so Save returns to it.
      if (billId) await navigate({ to: '/bills/$billId', params: { billId } });
      else await navigate({ to: '/bills' });
    } catch (e) {
      setError(e);
    }
  }

  /*
   * Save is the corner button, as it is on every form in the kit — a glyph at every width, the user's choice.
   * Cancel is where it already went: an edit came from the bill's own page, a new bill from the list, and that
   * is exactly what the named back line above the title says. It stays a row of its own as well, because
   * "Cancel" is an action this screen has always offered by that name.
   */
  const backTo = billId ? ('/bills/$billId' as const) : ('/bills' as const);
  const backParams = billId ? { billId } : undefined;

  return (
    <div className={SCREEN}>
      <LargeTitle
        title={billId ? 'Edit bill' : 'New bill'}
        back={billId ? 'Bill' : 'Bills'}
        backTo={backTo}
        backParams={backParams}
        actions={[{ key: 'save', label: 'Save', glyph: <Check size={22} aria-hidden />, run: () => form.current?.requestSubmit() }]}
      />
      {waiting ? (
        <p className="text-sm text-[var(--ph-ink-3)]">Loading…</p>
      ) : (
        <form ref={form} onSubmit={save}>
          <ErrorBox error={error ?? templates.error} />
          <InsetGroup>
            <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bill name" />
            <SelectRow
              label="Currency"
              value={billCurrency}
              // Picking the paying account's own currency goes back to following it, so a later change of account carries the bill along.
              onChange={(e) => setCurrency(e.target.value === payerCurrency ? '' : e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </SelectRow>
            <TextRow
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Amount"
              info="Leave it empty when it changes every month, like electricity. It will be asked for each time."
            />
            <PickerRow
              label="Category"
              value={chosen ? categoryPath(accounts.data ?? [], chosen.id) : ''}
              placeholder="Choose a category"
              onOpen={() => setPickingCategory(true)}
            />
            <SelectRow label="Paid from" value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)}>
              <option value="">Choose an account</option>
              {wallets.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </SelectRow>
          </InsetGroup>

          <InsetGroup>
            <SelectRow label="Repeats" value={repeat} onChange={(e) => setRepeat(e.target.value === 'yearly' ? 'yearly' : 'monthly')}>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
            </SelectRow>
            {repeat === 'yearly' && (
              <SelectRow label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Choose a month</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {monthName(`2026-${String(m).padStart(2, '0')}`, 'long')}
                  </option>
                ))}
              </SelectRow>
            )}
            <SelectRow label="Bill date" value={outDay} onChange={(e) => setOutDay(e.target.value)}>
              <option value="">Choose a day</option>
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {ordinal(day)}
                </option>
              ))}
            </SelectRow>
            <SelectRow label="Due by" value={payBy} onChange={(e) => setPayBy(e.target.value)}>
              <option value="">No due day</option>
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {ordinal(day)}
                </option>
              ))}
            </SelectRow>
          </InsetGroup>

          {repeat === 'yearly' && (
            <InsetGroup header="Sinking fund">
              <SwitchRow label="Save up for it" checked={fundOn} onChange={setFundOn} />
              {fundOn && (
                <TextRow
                  label="Each month"
                  value={fundMonthly}
                  onChange={(e) => setFundMonthly(e.target.value)}
                  inputMode="decimal"
                  placeholder={worked === null ? 'Amount' : minorToMajorString(worked, billCurrency)}
                  info="Worked out from the amount and the months left. Type another amount to override."
                />
              )}
              {fundOn && (
                <SelectRow label="Set aside in" value={fundAccountId} onChange={(e) => setFundAccountId(e.target.value)}>
                  <option value="">Choose an account</option>
                  {fundAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </SelectRow>
              )}
            </InsetGroup>
          )}

          <InsetGroup>
            <InsetRow title="Cancel" action to={backTo} params={backParams} />
          </InsetGroup>
        </form>
      )}
      {/* The same searchable tree as Add transaction; a bill is recorded into the open book, which the picker already honours. */}
      {pickingCategory && (
        <CategoryPicker kind="expense" lockKind title="Category" value={categoryAccountId || undefined} onPick={setCategoryAccountId} onClose={() => setPickingCategory(false)} />
      )}
    </div>
  );
}
