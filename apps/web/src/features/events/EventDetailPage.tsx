import { expenseLines, isoDate, parseMajor } from '@expanses/core';
import { postTransaction, tagTransaction } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { useCategorySets, useSetCategories } from '../categories/set-queries';
import { useEvents, useEventSheet } from './queries';

/**
 * One event, with the spending recorded from inside it.
 *
 * Recording here is what makes a set worth having: the categories offered are the event's own, so a
 * renovation is filed against renovation categories without either list cluttering the other, and the
 * payment is tagged to the event as it is written rather than hunted down afterwards.
 */
export function EventDetailPage() {
  const { eventId } = useParams({ from: '/events/$eventId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  const sets = useCategorySets().data ?? [];
  const setCategories = useSetCategories(event?.setId ?? null).data ?? [];
  const sheet = useEventSheet(eventId);
  const accounts = useAccounts().data ?? [];
  const money = accounts.filter(isMoneyAccount);

  const [occurredOn, setOccurredOn] = useState(isoDate());
  const [description, setDescription] = useState('');
  const [moneyId, setMoneyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<unknown>(null);

  const setName = sets.find((row) => row.id === event?.setId)?.name ?? null;

  async function add(submitted: FormEvent) {
    submitted.preventDefault();
    setError(null);
    try {
      const paidWith = accounts.find((account) => account.id === moneyId);
      if (!paidWith) throw new Error('Choose what it was paid with');
      if (!categoryId) throw new Error('Choose a category');
      const transactionId = await postTransaction(database, ws, {
        occurredOn,
        description,
        lines: expenseLines({
          categoryAccountId: categoryId,
          paymentAccountId: paidWith.id,
          amountMinor: parseMajor(amount, paidWith.currency ?? ws.baseCurrency),
          currency: paidWith.currency ?? ws.baseCurrency,
        }),
      });
      // The ledger does not take an event, so the tag is a second write; an untagged payment would
      // still be offered by the event's suggestions.
      await tagTransaction(database, ws, transactionId, eventId);
      setDescription('');
      setAmount('');
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  if (events.isSuccess && !event) return <Empty>That event is no longer here.</Empty>;

  return (
    <div className="space-y-4">
      <PageHeader title={event?.name ?? 'Event'} />
      <ErrorBox error={error ?? events.error ?? sheet.error} />

      <Card className="space-y-1">
        <div className="text-xs text-slate-500">
          {event?.startsOn} to {event?.endsOn}
          {setName && ` · draws on ${setName}`}
        </div>
        <div data-testid="event-total" className="text-2xl font-semibold">
          <Money minor={sheet.data?.actualMinor ?? 0} currency={ws.baseCurrency} />
        </div>
        {sheet.data?.plannedMinor !== null && sheet.data !== undefined && (
          <div className="text-xs text-slate-600">
            planned <Money minor={sheet.data.plannedMinor!} currency={ws.baseCurrency} />
            {sheet.data.overMinor !== null && sheet.data.overMinor > 0 && (
              <span className="ml-2 text-rose-600">
                Over by <Money minor={sheet.data.overMinor} currency={ws.baseCurrency} />
              </span>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Add spending to this event</h2>
        {event?.setId === null ? (
          <Empty>This event has no set yet. Give it one on the events page to record spending here.</Empty>
        ) : (
          <form onSubmit={add} className="grid gap-3 md:grid-cols-2">
            <Field label="Date">
              <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Keramik lantai" />
            </Field>
            <Field label="Paid with">
              <Select value={moneyId} onChange={(e) => setMoneyId(e.target.value)}>
                <option value="">Choose…</option>
                {money.map((account) => (
                  <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose…</option>
                {setCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1500000" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
      </Card>

      {(sheet.data?.lines.length ?? 0) > 0 && (
        <Card>
          <div data-testid="event-detail-sheet" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1">Category</th>
                  <th className="py-1 text-right">Planned</th>
                  <th className="py-1 text-right">Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(sheet.data?.lines ?? []).map((line) => (
                  <tr key={line.categoryId}>
                    <td className="py-1">{line.name}</td>
                    <td className="tabular py-1 text-right">
                      {line.plannedMinor === null ? '—' : <Money minor={line.plannedMinor} currency={ws.baseCurrency} />}
                    </td>
                    <td className="tabular py-1 text-right">
                      <Money minor={line.actualMinor} currency={ws.baseCurrency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
