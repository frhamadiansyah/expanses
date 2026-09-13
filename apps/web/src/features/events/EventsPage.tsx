import { isoDate, parseMajor } from '@expanses/core';
import { deleteEvent, removeEventBudget, saveEvent, setEventBudget, tagTransaction } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { useCategorySets, useSetCategories } from '../categories/set-queries';
import { useEventBudgets, useEvents, useEventSheet, useEventSuggestions } from './queries';

/**
 * Events: a birth, a wedding, a renovation, a trip, Lebaran.
 *
 * Spending on an event lands across many categories and a few weeks, so no budget line ever sees
 * the whole of it. Planning it category by category answers what it should cost, and also says which
 * categories to look in — which is what keeps the tagging to one sitting rather than a running chore.
 */
export function EventsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const events = useEvents();
  const accounts = useAccounts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const budgets = useEventBudgets(selectedId);
  const sheet = useEventSheet(selectedId);
  const suggestions = useEventSuggestions(selectedId);
  const [error, setError] = useState<unknown>(null);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(isoDate());
  const [endsOn, setEndsOn] = useState(isoDate());
  const [plannedTotal, setPlannedTotal] = useState('');
  const [setId, setSetId] = useState('');

  const [categoryId, setCategoryId] = useState('');
  const [planned, setPlanned] = useState('');

  const list = events.data ?? [];
  const selected = list.find((event) => event.id === selectedId) ?? null;
  const sets = useCategorySets().data ?? [];
  // An event plans against its own set when it has one, so a renovation is planned in renovation terms.
  const setCategories = useSetCategories(selected?.setId ?? null).data ?? [];
  const monthly = (accounts.data ?? []).filter((account) => account.kind === 'expense' && account.subtype === 'category');
  const categories = selected?.setId ? setCategories : monthly;
  const nameOf = (id: string) => (accounts.data ?? []).find((account) => account.id === id)?.name ?? id;

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function addEvent(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const id = await saveEvent(database, ws, {
        name,
        startsOn,
        endsOn,
        plannedMinor: plannedTotal.trim() === '' ? null : parseMajor(plannedTotal, ws.baseCurrency),
        setId: setId === '' ? null : setId,
      });
      setSelectedId(id);
      setName('');
      setPlannedTotal('');
      setAdding(false);
    });
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    await run(async () => {
      await setEventBudget(database, ws, selectedId, {
        categoryAccountId: categoryId,
        plannedMinor: planned.trim() === '' ? null : parseMajor(planned, ws.baseCurrency),
      });
      setCategoryId('');
      setPlanned('');
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Events" action={!adding && <Button onClick={() => setAdding(true)}>Add an event</Button>} />
      <ErrorBox error={error ?? events.error ?? sheet.error} />

      {adding && (
        <Card>
          <form onSubmit={addEvent} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lebaran, the wedding, the renovation" />
              </Field>
              <Field label="Planned total" hint="Optional. Leave it empty and the category figures add up instead.">
                <Input value={plannedTotal} onChange={(e) => setPlannedTotal(e.target.value)} inputMode="decimal" placeholder="20000000" />
              </Field>
              <Field label="Categories" hint="A set keeps an event's categories out of your monthly tree.">
                <Select value={setId} onChange={(e) => setSetId(e.target.value)}>
                  <option value="">The monthly categories</option>
                  {sets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Starts on">
                <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </Field>
              <Field label="Ends on">
                <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Save event</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {list.length === 0 && !adding && <Empty>No events yet. A birth, a wedding, a renovation, a trip — anything that spends across categories.</Empty>}

      {list.length > 0 && (
        <Card className="space-y-1">
          {list.map((event) => (
            <div key={event.id} data-testid="event-row" className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
              <span className="flex flex-wrap items-baseline gap-2">
                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setSelectedId(event.id)}>
                  <span className="font-medium">{event.name}</span>{' '}
                  <span className="text-xs text-slate-500">
                    {event.startsOn} to {event.endsOn}
                  </span>
                </button>
                <Link to="/events/$eventId" params={{ eventId: event.id }} className="text-xs underline">
                  Open
                </Link>
              </span>
              <Button variant="danger" onClick={() => void run(() => deleteEvent(database, ws, event.id))}>
                Remove
              </Button>
            </div>
          ))}
        </Card>
      )}

      {selected && (
        <Card className="space-y-3">
          <div data-testid="event-sheet" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">{selected.name}</h2>
              <span className="text-xs text-slate-600">
                {sheet.data?.plannedMinor === null || sheet.data === undefined ? (
                  'Nothing planned yet'
                ) : (
                  <>
                    planned <Money minor={sheet.data.plannedMinor} currency={ws.baseCurrency} />
                  </>
                )}
                {sheet.data && (
                  <>
                    {' · spent '}
                    <Money minor={sheet.data.actualMinor} currency={ws.baseCurrency} className="font-semibold text-slate-900" />
                  </>
                )}
              </span>
            </div>

            {sheet.data && sheet.data.overMinor !== null && sheet.data.overMinor > 0 && (
              <p className="text-xs text-rose-600">
                Over by <Money minor={sheet.data.overMinor} currency={ws.baseCurrency} />
              </p>
            )}

            {(sheet.data?.lines.length ?? 0) > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="py-1">Category</th>
                      <th className="py-1 text-right">Planned</th>
                      <th className="py-1 text-right">Spent</th>
                      <th className="py-1 text-right">Over</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sheet.data!.lines.map((line) => (
                      <tr key={line.categoryId}>
                        <td className="py-1">
                          {line.name}
                          {line.unplanned && <span className="ml-2 text-xs text-amber-700">not planned for</span>}
                        </td>
                        <td className="tabular py-1 text-right">
                          {line.plannedMinor === null ? '—' : <Money minor={line.plannedMinor} currency={ws.baseCurrency} />}
                        </td>
                        <td className="tabular py-1 text-right">
                          <Money minor={line.actualMinor} currency={ws.baseCurrency} />
                        </td>
                        <td className="tabular py-1 text-right">
                          {line.overMinor === null || line.overMinor === 0 ? '—' : <Money minor={line.overMinor} currency={ws.baseCurrency} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form onSubmit={addCategory} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
              <Field label="Category" className="min-w-48">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Choose a category</option>
                  {categories.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Planned" hint="Leave empty to include the category without a figure.">
                <Input value={planned} onChange={(e) => setPlanned(e.target.value)} inputMode="decimal" placeholder="3000000" />
              </Field>
              <Button type="submit" variant="secondary">
                Add category
              </Button>
            </form>

            {(budgets.data?.length ?? 0) > 0 && (
              <p className="text-xs text-slate-500">
                Draws on{' '}
                {(budgets.data ?? []).map((row, index) => (
                  <span key={row.categoryAccountId}>
                    {index > 0 && ', '}
                    {nameOf(row.categoryAccountId)}{' '}
                    <button
                      type="button"
                      aria-label={`Stop drawing on ${nameOf(row.categoryAccountId)}`}
                      className="underline"
                      onClick={() => void run(() => removeEventBudget(database, ws, selected.id, row.categoryAccountId))}
                    >
                      remove
                    </button>
                  </span>
                ))}
              </p>
            )}
          </div>
        </Card>
      )}

      {selected && (suggestions.data?.length ?? 0) > 0 && (
        <Card className="space-y-2">
          <div data-testid="event-suggestions" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Was this part of {selected.name}?</h2>
              <span className="text-xs text-slate-500">Inside the dates, in a category it draws on, not yet tagged</span>
            </div>
            {(suggestions.data ?? []).map((candidate) => (
              <div key={candidate.transactionId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="text-slate-500">{candidate.occurredOn}</span> <span className="font-medium">{candidate.description}</span>{' '}
                  <span className="text-xs text-slate-500">{nameOf(candidate.categoryAccountId)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Money minor={candidate.amountBaseMinor} currency={ws.baseCurrency} />
                  <Button
                    variant="secondary"
                    aria-label={`Tag ${candidate.description}`}
                    onClick={() => void run(() => tagTransaction(database, ws, candidate.transactionId, selected.id))}
                  >
                    Yes
                  </Button>
                </span>
              </div>
            ))}
            <p className="text-xs text-slate-500">
              Tagged spending leaves your monthly caps and is shown on the budget as its own line, because you meant to spend it.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
