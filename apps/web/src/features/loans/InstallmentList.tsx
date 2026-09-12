import { installmentSplit, isoDate } from '@expanses/core';
import { deleteInstallment, saveInstallment } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Money } from '../../ui';
import { useInstallments } from './queries';

/**
 * Instalment plans on one card. The purchase was spending on the day it happened; these rows only
 * say how much of it the card has billed so far, and how much is still to come.
 */
export function InstallmentList({ cardAccountId, currency }: { cardAccountId: string; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const plans = useInstallments(cardAccountId);
  const today = isoDate();
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [months, setMonths] = useState('12');
  const [firstBilledMonth, setFirstBilledMonth] = useState(today.slice(0, 7));
  const [earnsPoints, setEarnsPoints] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await saveInstallment(database, ws, {
        cardAccountId,
        description: description.trim() || 'Instalment plan',
        totalMinor: Number(total.replace(/\./g, '')),
        months: Number(months),
        firstBilledMonth,
        earnsPoints,
      });
      await invalidate();
      setDescription('');
      setTotal('');
      setAdding(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this plan? The purchase it came from stays as it is.')) return;
    setError(null);
    try {
      await deleteInstallment(database, ws, id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Instalment plans</h2>
        {!adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add a plan
          </Button>
        )}
      </div>

      {(plans.data?.length ?? 0) === 0 && !adding && (
        <p className="text-sm text-slate-500">None yet. A purchase the issuer turns into cicilan is recorded here, so the card's debt splits into billed and unbilled.</p>
      )}

      <div className="divide-y divide-slate-100 text-sm">
        {(plans.data ?? []).map((plan) => {
          const split = installmentSplit(plan, today);
          return (
            <div key={plan.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium">{plan.description}</span>
                <span className="block text-xs text-slate-500">
                  {plan.months} months · <Money minor={plan.monthlyMinor} currency={currency} /> a month · ends {split.lastMonth}
                  {!plan.earnsPoints && ' · earns no points'}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-right text-xs text-slate-500">
                  Billed <Money minor={split.billedMinor} currency={currency} />
                  <span className="block">
                    Still to come <Money minor={split.unbilledMinor} currency={currency} />
                  </span>
                </span>
                <Button variant="danger" onClick={() => void remove(plan.id)}>
                  Remove
                </Button>
              </span>
            </div>
          );
        })}
      </div>

      {adding && (
        <form onSubmit={add} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="What it was">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="iBox Grand Indonesia" />
            </Field>
            <Field label={`Total (${currency})`}>
              <Input value={total} inputMode="decimal" onChange={(e) => setTotal(e.target.value)} placeholder="12.000.000" required />
            </Field>
            <Field label="Over how many months">
              <Input value={months} inputMode="numeric" onChange={(e) => setMonths(e.target.value)} />
            </Field>
            <Field label="First billed">
              <Input type="month" value={firstBilledMonth} onChange={(e) => setFirstBilledMonth(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={earnsPoints} onChange={(e) => setEarnsPoints(e.target.checked)} />
            This still earns points
          </label>
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Save plan
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!adding && <ErrorBox error={error} />}
    </Card>
  );
}
