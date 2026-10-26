import { categoryPath, CURRENCIES, ordinal, parseMajor } from '@expanses/core';
import { saveExpenseTemplate } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, PickerRow, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { CategoryPicker } from '../transactions/CategoryPicker';
import { useExpenseTemplates } from '../transactions/queries';
import { amountInput } from './bill-view';
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

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

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryAccountId, setCategoryAccountId] = useState('');
  const [moneyAccountId, setMoneyAccountId] = useState('');
  // '' follows the account that pays: the bill is then written in that account's money, as every bill was before this.
  const [currency, setCurrency] = useState('');
  const [outDay, setOutDay] = useState('');
  const [payBy, setPayBy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const chosen = (accounts.data ?? []).find((account) => account.id === categoryAccountId);
  // What a bill is paid with: money kept for spending, or a card — the same answer every "Paid with" gives.
  const wallets = moneyHolders(accounts.data ?? []).filter((account) => canPayWith(account));
  // What the Currency row shows and the amount is read in: the one picked, else the payer's, else the workspace's.
  const payerCurrency = (accounts.data ?? []).find((account) => account.id === moneyAccountId)?.currency ?? ws.baseCurrency;
  const billCurrency = currency || payerCurrency;

  // Filled once the bill being edited has arrived; not kept in sync after, so typing is never clobbered.
  useEffect(() => {
    if (!billId || loaded || !accounts.data) return;
    const bill = (templates.data ?? []).find((t) => t.id === billId);
    if (!bill) return;
    setName(bill.name);
    // Written in the bill's own currency (else the paying account's), the one save parses it back in: a USD bill must not read as rupiah.
    const payer = accounts.data.find((account) => account.id === bill.moneyAccountId);
    setAmount(amountInput(bill.amountMinor, bill.currency ?? payer?.currency ?? ws.baseCurrency));
    setCurrency(bill.currency ?? '');
    setCategoryAccountId(bill.categoryAccountId);
    setMoneyAccountId(bill.moneyAccountId);
    setOutDay(String(bill.dayOfMonth));
    setPayBy(String(bill.payByDay ?? ''));
    setLoaded(true);
  }, [billId, loaded, templates.data, accounts.data, ws.baseCurrency]);
  // Until the bill has loaded there is nothing to type into: a field typed in first would be overwritten by the
  // bill as it lands, and a Save would write the blank form over it. A bill that is no longer there opens blank.
  const waiting = Boolean(billId) && !loaded && !templates.isError && !(templates.isSuccess && !(templates.data ?? []).some((t) => t.id === billId));

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (outDay === '') {
      setError(new Error('Choose the bill date'));
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
        dayOfMonth: Number(outDay),
        payByDay: payBy === '' ? null : Number(payBy),
      });
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
            <SelectRow label="Repeats" value="monthly" disabled>
              <option value="monthly">Every month</option>
            </SelectRow>
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
