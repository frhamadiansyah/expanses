import { minorToMajorString, parseMajor } from '@expanses/core';
import { deleteExpenseTemplate, saveExpenseTemplate } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Money, Select } from '../../ui';
import { useExpenseTemplates } from './queries';

const WALLET_SUBTYPES = ['bank', 'cash', 'savings', 'credit_card'];

/** The bills that come round every month: what they are, what they cost, and what pays them. */
export function BillList() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const templates = useExpenseTemplates();
  const accounts = useAccounts();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [categoryAccountId, setCategoryAccountId] = useState('');
  const [moneyAccountId, setMoneyAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const [error, setError] = useState<unknown>(null);

  const categories = (accounts.data ?? []).filter((account) => account.kind === 'expense' && account.subtype === 'category');
  const wallets = (accounts.data ?? []).filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.archivedAt === null);
  const bills = templates.data ?? [];
  const nameOf = (id: string) => (accounts.data ?? []).find((account) => account.id === id)?.name ?? '';

  function reset() {
    setEditingId(null);
    setName('');
    setCategoryAccountId('');
    setMoneyAccountId('');
    setAmount('');
    setDay('1');
    setOpen(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const wallet = (accounts.data ?? []).find((account) => account.id === moneyAccountId);
      const currency = wallet?.currency ?? ws.baseCurrency;
      await saveExpenseTemplate(database, ws, {
        id: editingId ?? undefined,
        name,
        categoryAccountId,
        moneyAccountId,
        amountMinor: amount.trim() === '' ? null : parseMajor(amount, currency),
        dayOfMonth: Number(day),
      });
      await invalidate();
      reset();
    } catch (e) {
      setError(e);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteExpenseTemplate(database, ws, id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Bills every month</h2>
        <span className="text-xs text-slate-500">Set one up and it is offered on the day, instead of being retyped</span>
      </div>

      <ErrorBox error={error ?? templates.error} />

      {bills.length === 0 && !open && <p className="text-xs text-slate-500">No bills set up. The phone, the water, the gas — whatever comes round.</p>}

      {bills.map((bill) => (
        <div key={bill.id} data-testid="bill-row" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm first:border-t-0">
          <span>
            <span className="font-medium">{bill.name}</span>{' '}
            <span className="text-xs text-slate-500">
              {nameOf(bill.categoryAccountId)} · day {bill.dayOfMonth} · from {nameOf(bill.moneyAccountId)}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {bill.amountMinor === null ? (
              <span className="text-xs text-slate-500">amount differs</span>
            ) : (
              <Money minor={bill.amountMinor} currency={ws.baseCurrency} />
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setEditingId(bill.id);
                setName(bill.name);
                setCategoryAccountId(bill.categoryAccountId);
                setMoneyAccountId(bill.moneyAccountId);
                setAmount(bill.amountMinor === null ? '' : minorToMajorString(bill.amountMinor, ws.baseCurrency));
                setDay(String(bill.dayOfMonth));
                setOpen(true);
              }}
            >
              Edit
            </Button>
            <Button variant="danger" onClick={() => void remove(bill.id)}>
              Remove
            </Button>
          </span>
        </div>
      ))}

      {!open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add a bill
        </Button>
      )}

      {open && (
        <form onSubmit={save} className="space-y-3 border-t border-slate-100 pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="What is it">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Phone, water, gas" />
            </Field>
            <Field label="Day of the month">
              <Input value={day} onChange={(e) => setDay(e.target.value)} inputMode="numeric" placeholder="20" />
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
            <Field label="Amount" hint="Leave it empty when it differs every month, like electricity. You will be asked on the day.">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="150000" />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit">Save bill</Button>
            <Button type="button" variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
