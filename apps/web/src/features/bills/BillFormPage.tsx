import { minorToMajorString, ordinal, parseMajor } from '@expanses/core';
import { saveExpenseTemplate } from '@expanses/db';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInOpenBook, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select } from '../../ui';
import { useExpenseTemplates } from '../transactions/queries';

const WALLET_SUBTYPES = ['bank', 'cash', 'savings', 'credit_card'];
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

  // A bill is recorded into the open book, so it picks from that book's categories.
  const categories = (accounts.data ?? []).filter((account) => account.kind === 'expense' && account.subtype === 'category' && inOpenBook(account));
  const wallets = (accounts.data ?? []).filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.archivedAt === null);

  // Filled once the bill being edited has arrived; not kept in sync after, so typing is never clobbered.
  useEffect(() => {
    if (!billId || loaded) return;
    const bill = (templates.data ?? []).find((t) => t.id === billId);
    if (!bill) return;
    setName(bill.name);
    setAmount(bill.amountMinor === null ? '' : minorToMajorString(bill.amountMinor, ws.baseCurrency));
    setCategoryAccountId(bill.categoryAccountId);
    setMoneyAccountId(bill.moneyAccountId);
    setOutDay(String(bill.dayOfMonth));
    setPayBy(String(bill.payByDay ?? ''));
    setLoaded(true);
  }, [billId, loaded, templates.data, ws.baseCurrency]);

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

  return (
    <div className="space-y-4">
      <PageHeader title={billId ? 'Edit bill' : 'New bill'} />
      <Card>
        <ErrorBox error={error ?? templates.error} />
        <form onSubmit={save} className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Phone, water, gas" />
          </Field>
          <Field label="Amount" hint="Leave it empty when it changes every month, like electricity. You'll be asked each time.">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="150000" />
          </Field>
          <Field label="Category">
            <Select value={categoryAccountId} onChange={(e) => setCategoryAccountId(e.target.value)}>
              <option value="">Choose a category</option>
              {categories.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Paid from">
            <Select value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)}>
              <option value="">Choose an account</option>
              {wallets.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>

          <h2 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">When</h2>

          <Field label="Repeats">
            <Select value="monthly" disabled>
              <option value="monthly">Every month</option>
            </Select>
          </Field>
          <Field label="Bill is out on">
            <Select value={outDay} onChange={(e) => setOutDay(e.target.value)}>
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {ordinal(day)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pay by" hint="Earlier than the out day means the next month: out on the 28th, pay by the 5th.">
            <Select value={payBy} onChange={(e) => setPayBy(e.target.value)}>
              <option value="">No pay-by day</option>
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {ordinal(day)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex gap-2">
            <Button type="submit">Save</Button>
            {/* Cancel goes back the way Save would: to the bill's own page for an edit, to the list for a new one. */}
            {billId ? (
              <Link
                to="/bills/$billId"
                params={{ billId }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100"
              >
                Cancel
              </Link>
            ) : (
              <Link
                to="/bills"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100"
              >
                Cancel
              </Link>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
