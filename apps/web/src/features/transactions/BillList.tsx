import { deleteExpenseTemplate } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Money } from '../../ui';
import { useExpenseTemplates } from './queries';

const SECONDARY_LINK = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100';

/** The bills that come round every month: what they are, what they cost, and what pays them. */
export function BillList() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const templates = useExpenseTemplates();
  const accounts = useAccounts();
  const [error, setError] = useState<unknown>(null);

  const bills = templates.data ?? [];
  const nameOf = (id: string) => (accounts.data ?? []).find((account) => account.id === id)?.name ?? '';

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

      {bills.length === 0 && <p className="text-xs text-slate-500">No bills set up. The phone, the water, the gas — whatever comes round.</p>}

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
            <Link to="/bills/$billId/edit" params={{ billId: bill.id }} className={SECONDARY_LINK}>
              Edit
            </Link>
            <Button variant="danger" onClick={() => void remove(bill.id)}>
              Remove
            </Button>
          </span>
        </div>
      ))}

      <Link to="/bills/new" className={SECONDARY_LINK}>
        Add a bill
      </Link>
    </Card>
  );
}
