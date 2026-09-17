import { expenseLines, formatMinor, isoDate, parseMajor } from '@expanses/core';
import { deleteEvent, finishEvent, postTransaction, removeEventBudget, setEventBudget, tagTransaction } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Field, Input, Money, PageHeader, RoundButton, Select } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCategorySetMembership, useCategorySets, useSetCategories } from '../categories/set-queries';
import { BudgetGauge, type GaugeWords } from '../transactions/BudgetGauge';
import { CapLine, ShareLine } from '../transactions/CategoryLines';
import { categoryColour } from '../transactions/category-colours';
import { Deck } from '../transactions/Deck';
import { Donut } from '../transactions/Donut';
import { eventDates, eventStatus, StatusChip } from './EventsPage';
import { useEventBudgets, useEventHistory, useEvents, useEventSheet, useEventSuggestions } from './queries';

/** A month has budgets; an event has a plan. */
const PLAN_WORDS: GaugeWords = {
  left: 'Left of the plan',
  over: 'Over the plan by',
  set: 'Planned',
  overCount: (count) => `${count} ${count === 1 ? 'category' : 'categories'} over`,
};

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000) + 1;

/**
 * One event, read the way Cashflow reads a month.
 *
 * The chart card is Cashflow's: where the event's money went, and a swipe over to what it planned. Without the
 * month's parts an event has no use for — no Expense and Income, since an event is spending, and no arrows, since
 * the list of events is one tap back. Planning, tagging and recording all happen here, under the chart they change.
 */
export function EventDetailPage() {
  const { eventId } = useParams({ from: '/events/$eventId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  const sheet = useEventSheet(eventId);
  const budgets = useEventBudgets(eventId);
  const suggestions = useEventSuggestions(eventId);
  const history = useEventHistory(eventId);
  const accounts = useAccounts().data ?? [];
  const money = accounts.filter(isMoneyAccount);
  const sets = useCategorySets({ ownerWide: true }).data ?? [];
  const setCategories = useSetCategories(event?.setId ?? null).data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const today = isoDate();

  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Planning a category.
  const [planCategoryId, setPlanCategoryId] = useState('');
  const [planned, setPlanned] = useState('');
  // Recording spending into the event.
  const [occurredOn, setOccurredOn] = useState(today);
  const [description, setDescription] = useState('');
  const [moneyId, setMoneyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');

  // An event plans against its own set when it has one, so a renovation is planned in renovation terms. Without
  // one it plans against the monthly tree, which leaves other sets out, or the list would offer two Flights.
  const monthly = accounts.filter((account) => account.kind === 'expense' && account.subtype === 'category' && membership[account.id] === undefined);
  const planCategories = event?.setId ? setCategories : monthly;
  const nameOf = (id: string) => accounts.find((account) => account.id === id)?.name ?? id;
  const setName = sets.find((row) => row.id === event?.setId)?.name ?? null;

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function plan(submitted: FormEvent) {
    submitted.preventDefault();
    await run(async () => {
      await setEventBudget(database, ws, eventId, {
        categoryAccountId: planCategoryId,
        plannedMinor: planned.trim() === '' ? null : parseMajor(planned, ws.baseCurrency),
      });
      setPlanCategoryId('');
      setPlanned('');
    });
  }

  async function record(submitted: FormEvent) {
    submitted.preventDefault();
    await run(async () => {
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
    });
  }

  if (events.isSuccess && !event) return <Empty>That event is no longer here.</Empty>;

  const data = sheet.data;
  const lines = (data?.lines ?? []).filter((line) => line.actualMinor > 0 || line.plannedMinor !== null);
  const spentLines = lines.filter((line) => line.actualMinor > 0);
  const spent = data?.actualMinor ?? 0;
  const plannedTotal = data?.plannedMinor ?? null;
  const hasPlan = plannedTotal !== null && plannedTotal > 0;
  const onPlan = hasPlan && page === 1;
  const transactions = history.data?.length ?? 0;

  const donut = (
    <div data-testid="event-total">
      <Donut
        slices={spentLines.map((line) => ({ key: line.categoryId, label: line.name, totalMinor: line.actualMinor, colour: categoryColour(line.categoryId) }))}
        totalMinor={spent}
        middle={formatMinor(spent, ws.baseCurrency)}
        label="Total spent"
        under={transactions > 0 ? `${transactions} transaction${transactions === 1 ? '' : 's'}` : undefined}
      />
    </div>
  );

  // Oldest day last, like Cashflow; each day a card of its own.
  const days = new Map<string, NonNullable<typeof history.data>>();
  for (const tx of history.data ?? []) days.set(tx.occurredOn, [...(days.get(tx.occurredOn) ?? []), tx]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={event?.name ?? 'Event'}
        controls={
          event?.setId ? (
            <RoundButton label="Add spending" pressed={adding} onClick={() => setAdding((was) => !was)}>
              <Plus size={22} aria-hidden />
            </RoundButton>
          ) : undefined
        }
        action={event?.setId && !adding ? <Button onClick={() => setAdding(true)}>Add spending</Button> : undefined}
      />
      <button type="button" onClick={() => void navigate({ to: '/events' })} className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800">
        <ChevronLeft size={16} aria-hidden />
        All events
      </button>
      <ErrorBox error={error ?? events.error ?? sheet.error} />

      {adding && event?.setId && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Add spending to this event</h2>
          <form onSubmit={record} className="grid gap-3 md:grid-cols-2">
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
            <div className="flex items-end gap-2">
              <Button type="submit">Save</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Done
              </Button>
            </div>
          </form>
        </Card>
      )}

      {event && (
        <div data-testid="event-sheet">
        <Card>
          <div className="flex flex-col items-center gap-0.5 pt-1">
            <span className="text-sm font-semibold">{eventDates(event)}</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <StatusChip status={eventStatus(event, today)} />
              {setName && `draws on ${setName}`}
            </span>
          </div>

          {spent === 0 && !hasPlan ? (
            <p className="py-6 text-center text-sm text-slate-500">Nothing spent on it yet. Plan a category below, or record the first payment.</p>
          ) : hasPlan ? (
            <Deck page={page} onPage={setPage} labels={['Where it went', 'Against the plan']}>
              {donut}
              <BudgetGauge
                progress={{
                  capsMinor: plannedTotal,
                  spentMinor: spent,
                  overCount: lines.filter((line) => (line.overMinor ?? 0) > 0).length,
                  any: true,
                }}
                month={today.slice(0, 7)}
                today={today}
                words={PLAN_WORDS}
                last={{ label: 'Long', value: `${dayCount(event.startsOn, event.endsOn)} ${dayCount(event.startsOn, event.endsOn) === 1 ? 'day' : 'days'}` }}
              />
            </Deck>
          ) : (
            donut
          )}

          {lines.length > 0 && (
            <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100" data-testid="event-detail-sheet">
              {(onPlan ? lines : spentLines).map((line) => (
                <div key={line.categoryId} className="flex min-h-12 flex-col justify-center py-2.5">
                  {onPlan ? (
                    <CapLine
                      colour={categoryColour(line.categoryId)}
                      name={line.name}
                      amountMinor={line.actualMinor}
                      capMinor={line.plannedMinor}
                      currency={ws.baseCurrency}
                      chevron={false}
                      noCap="not planned"
                    />
                  ) : (
                    <ShareLine colour={categoryColour(line.categoryId)} name={line.name} amountMinor={line.actualMinor} wholeMinor={spent} currency={ws.baseCurrency} chevron={false} />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        </div>
      )}

      {/* Put away while spending is being recorded: both forms ask for a category, and one question at a time is enough. */}
      {!adding && (
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold">Plan</h2>
        <form onSubmit={plan} className="flex flex-wrap items-end gap-2">
          <Field label="Category" className="min-w-48">
            <Select value={planCategoryId} onChange={(e) => setPlanCategoryId(e.target.value)}>
              <option value="">Choose a category</option>
              {planCategories.map((account) => (
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
                  onClick={() => void run(() => removeEventBudget(database, ws, eventId, row.categoryAccountId))}
                >
                  remove
                </button>
              </span>
            ))}
          </p>
        )}
      </Card>
      )}

      {(suggestions.data?.length ?? 0) > 0 && event && (
        <Card className="space-y-2">
          <div data-testid="event-suggestions" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Was this part of {event.name}?</h2>
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
                    onClick={() => void run(() => tagTransaction(database, ws, candidate.transactionId, eventId))}
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

      {days.size > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-base font-semibold">Transaction history</h2>
          {[...days.entries()].map(([date, txs]) => {
            const d = new Date(`${date}T00:00:00`);
            const total = txs.reduce((sum, tx) => sum + tx.entries.filter((e) => e.accountKind === 'expense').reduce((s, e) => s + e.amountBaseMinor, 0), 0);
            return (
              <Card key={date}>
                <div className="-mx-2 flex items-center gap-3 border-b border-slate-200 px-2 pb-2">
                  <span className="tabular w-9 shrink-0 text-2xl leading-none font-semibold">{d.getDate()}</span>
                  <span className="flex flex-col text-xs leading-tight text-slate-500">
                    <b className="font-semibold text-slate-700">{d.toLocaleDateString('en-GB', { weekday: 'long' })}</b>
                    {d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                  </span>
                  <Money minor={total} currency={ws.baseCurrency} className="ml-auto text-sm font-semibold text-slate-600" />
                </div>
                <ul className="divide-y divide-slate-100">
                  {txs.map((tx) => {
                    const expense = tx.entries.find((entry) => entry.accountKind === 'expense');
                    const paidWith = tx.entries.find((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability');
                    return (
                      <li key={tx.id} className="flex items-center gap-3 py-2.5">
                        <CategoryIcon categoryId={expense?.accountId ?? null} accounts={accounts} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{expense?.accountName ?? tx.description}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {tx.description}
                            {paidWith && ` · ${paidWith.accountName}`}
                          </span>
                        </span>
                        <Money minor={expense?.amountBaseMinor ?? 0} currency={ws.baseCurrency} className="shrink-0 text-sm font-semibold text-red-700" />
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </section>
      )}

      {event && (
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant="secondary"
            aria-label={event.finishedAt === null ? `Finish ${event.name}` : `Reopen ${event.name}`}
            onClick={() => void run(() => finishEvent(database, ws, event.id, event.finishedAt === null))}
          >
            {event.finishedAt === null ? 'Mark as done' : 'Reopen'}
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              void run(async () => {
                await deleteEvent(database, ws, event.id);
                await navigate({ to: '/events' });
              })
            }
          >
            Remove event
          </Button>
        </div>
      )}
    </div>
  );
}
