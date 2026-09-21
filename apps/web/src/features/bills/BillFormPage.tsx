import { ordinal, parseMajor } from '@expanses/core';
import { saveExpenseTemplate } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { WALLET_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInOpenBook, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SelectRow, TextRow } from '../../ui/native';
import { SCREEN } from '../networth/Panel';
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
  const inOpenBook = useInOpenBook();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryAccountId, setCategoryAccountId] = useState('');
  const [moneyAccountId, setMoneyAccountId] = useState('');
  const [outDay, setOutDay] = useState('1');
  const [payBy, setPayBy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  // The amount's hint sits under the whole card, so the field has to say out loud which sentence explains it.
  const amountHint = useId();
  const form = useRef<HTMLFormElement>(null);

  // A bill is recorded into the open book, so it picks from that book's categories.
  const categories = (accounts.data ?? []).filter((account) => account.kind === 'expense' && account.subtype === 'category' && inOpenBook(account));
  const wallets = (accounts.data ?? []).filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.archivedAt === null);

  // Filled once the bill being edited has arrived; not kept in sync after, so typing is never clobbered.
  useEffect(() => {
    if (!billId || loaded || !accounts.data) return;
    const bill = (templates.data ?? []).find((t) => t.id === billId);
    if (!bill) return;
    setName(bill.name);
    // Written in the paying account's currency, the one save parses it back in: a USD bill must not read as rupiah.
    const payer = accounts.data.find((account) => account.id === bill.moneyAccountId);
    setAmount(amountInput(bill.amountMinor, payer?.currency ?? ws.baseCurrency));
    setCategoryAccountId(bill.categoryAccountId);
    setMoneyAccountId(bill.moneyAccountId);
    setOutDay(String(bill.dayOfMonth));
    setPayBy(String(bill.payByDay ?? ''));
    setLoaded(true);
  }, [billId, loaded, templates.data, accounts.data, ws.baseCurrency]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const wallet = (accounts.data ?? []).find((account) => account.id === moneyAccountId);
      await saveExpenseTemplate(database, ws, {
        id: billId,
        name,
        categoryAccountId,
        moneyAccountId,
        amountMinor: amount.trim() === '' ? null : parseMajor(amount.trim(), wallet?.currency ?? ws.baseCurrency),
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
        actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, run: () => form.current?.requestSubmit() }]}
      />
      <form ref={form} onSubmit={save}>
        <ErrorBox error={error ?? templates.error} />
        <InsetGroup>
          <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Phone, water, gas" />
          <TextRow
            label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="150000"
            aria-describedby={amountHint}
            /* The sentence keeps its id, so the box still says out loud which line explains it. */
            hint={<span id={amountHint}>Leave it empty when it changes every month, like electricity. You'll be asked each time.</span>}
          />
          <SelectRow label="Category" value={categoryAccountId} onChange={(e) => setCategoryAccountId(e.target.value)}>
            <option value="">Choose a category</option>
            {categories.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectRow>
          <SelectRow label="Paid from" value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {wallets.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>

        <InsetGroup header="When" footer="Earlier than the out day means the next month: out on the 28th, pay by the 5th.">
          <SelectRow label="Repeats" value="monthly" disabled>
            <option value="monthly">Every month</option>
          </SelectRow>
          <SelectRow label="Bill is out on" value={outDay} onChange={(e) => setOutDay(e.target.value)}>
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {ordinal(day)}
              </option>
            ))}
          </SelectRow>
          <SelectRow label="Pay by" value={payBy} onChange={(e) => setPayBy(e.target.value)}>
            <option value="">No pay-by day</option>
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {ordinal(day)}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>

        <InsetGroup>
          <InsetRow title="Cancel" chevron={false} to={backTo} params={backParams} />
        </InsetGroup>
      </form>
    </div>
  );
}
