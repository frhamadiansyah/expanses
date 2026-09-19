import { expenseLines, formatMinor, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { deleteEvent, finishEvent, linkEventItem, postTransaction, tagTransaction } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Plus } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, Money, PageHeader, RoundButton, Select } from '../../ui';
import { coverTarget, isNothingLeft } from './buy-item';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCategorySetMembership, useCategorySets, useSetCategories } from '../categories/set-queries';
import { BudgetGauge } from '../transactions/BudgetGauge';
import { ShareLine } from '../transactions/CategoryLines';
import { categoryColour } from '../transactions/category-colours';
import { Deck } from '../transactions/Deck';
import { Donut } from '../transactions/Donut';
import { eventDates, eventStatus, StatusChip } from './EventsPage';
import { PlanCard } from './PlanCard';
import { differenceWords, gaugeFor, PLAN_WORDS, plannedLabel, planTotals, spentLabel, TONE, whereItWentRows } from './plan-view';
import { useCategoryWorkspaces } from '../workspaces/queries';
import { useBooksInEvent, useEventHistory, useEventPlan, useEvents, useEventSuggestions } from './queries';

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000) + 1;

/** One figure under the ring: what it is on the left, what it is worth on the right. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * One event, read the way Cashflow reads a month.
 *
 * The chart card is Cashflow's: where the event's money went, and a swipe over to what it planned. Without the
 * month's parts an event has no use for — no Expense and Income, since an event is spending, and no arrows, since
 * the list of events is one tap back. Planning, tagging and recording all happen here, under the chart they change.
 */
export function EventDetailPage() {
  const { eventId } = useParams({ from: '/events/$eventId' });
  // `ws` here is the workspace tab a plan screen was reading in; `ws` from useApp below is the workspace context.
  const { ws: openedIn, buy } = useSearch({ from: '/events/$eventId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  /*
   * Which workspace the event is being read in: null is the whole trip, an id is one workspace's share of it.
   *
   * Kept in the URL rather than in state, because it travels: the plan screens carry it in and hand it back on the
   * way out, and a tab held in `useState` was overwritten by that homecoming — Business → the plan → back landed on
   * "All". In the URL there is one answer, and it survives a reload and a shared link too.
   */
  const tab = openedIn ?? null;
  const setTab = (choice: string | null) =>
    void navigate({ to: '/events/$eventId', params: { eventId }, search: { ws: choice ?? undefined, buy }, replace: true });
  const books = useBooksInEvent(eventId).data ?? [];
  // A tab whose workspace has since been archived, or whose last tagged payment has gone, would read as an
  // empty event rather than as nothing at all; the whole trip is the honest answer while that is true.
  const openTab = books.some((book) => book.id === tab) ? tab : null;
  const plan = useEventPlan(eventId, openTab);
  const suggestions = useEventSuggestions(eventId, openTab);
  const history = useEventHistory(eventId, openTab);
  const accounts = useAccounts().data ?? [];
  // Spending recorded into an event is paid with something, so a locked deposit is no answer.
  const money = accounts.filter((a) => isMoneyAccount(a) && canPayWith(a));
  const sets = useCategorySets({ ownerWide: true }).data ?? [];
  const setCategories = useSetCategories(event?.setId ?? null).data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const today = isoDate();

  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Recording spending into the event.
  const [occurredOn, setOccurredOn] = useState(today);
  const [description, setDescription] = useState('');
  const [moneyId, setMoneyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');

  /*
   * An event records spending in its own set's categories when it draws on one, so a renovation is recorded in
   * renovation terms. Without a set it uses the monthly tree, which leaves other sets out, or the list would offer
   * two Flights — the same expression the item form plans against, so what is planned and what is recorded agree.
   */
  const monthly = accounts.filter((account) => account.kind === 'expense' && account.subtype === 'category' && membership[account.id] === undefined);
  const planCategories = event?.setId ? setCategories : monthly;
  const nameOf = (id: string) => accounts.find((account) => account.id === id)?.name ?? id;
  // The plan is the owner's, so it offers every workspace's categories — and two workspaces can hold copies of
  // one category, the same word twice. Each is said with the workspace it belongs to, so the choice is a real one.
  const workspaceOf = useCategoryWorkspaces();
  const planName = (id: string) => {
    const workspace = workspaceOf(id);
    return workspace ? `${nameOf(id)} · ${workspace}` : nameOf(id);
  };
  const setName = sets.find((row) => row.id === event?.setId)?.name ?? null;

  /**
   * "Buy it now" arrives here: the card opens filled in from the item, and saving ties the payment to what it
   * answered. The item is found in the plan already on screen, so the two readings can never disagree.
   */
  const buying = (plan.data?.lines ?? []).flatMap((line) => line.items).find((item) => item.id === buy) ?? null;
  useEffect(() => {
    if (!buying) return;
    setAdding(true);
    setDescription(buying.name);
    setAmount(minorToMajorString(buying.estimateMinor, ws.baseCurrency));
    setCategoryId(buying.categoryId ?? '');
    // Keyed on the item's own values rather than on the object: the plan refetches as things are tagged, and a new
    // object carrying the same item would wipe out an amount half typed.
  }, [buying?.id, buying?.name, buying?.estimateMinor, buying?.categoryId, ws.baseCurrency]);

  // A choice with one option is not a choice: with one account to pay from, asking again is only a step to forget.
  // Derived rather than written into state, so the answer follows the accounts instead of a stale first render.
  const payingWith = moneyId || (money.length === 1 ? money[0]!.id : '');

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function record(submitted: FormEvent) {
    submitted.preventDefault();
    await run(async () => {
      const paidWith = accounts.find((account) => account.id === payingWith);
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
      if (buying) {
        /*
         * The payment it just made is this item and nothing else, so it takes the whole amount as its share.
         *
         * A receipt already spoken for is the one refusal with somewhere to go — ticking an item off claims what is
         * left of its receipt, so a receipt answering several items is settled on "What it covers" and not by a
         * second tick. The payment is posted and tagged by now either way, so carrying the user to that screen loses
         * nothing and asks them for exactly what the app could not know.
         */
        try {
          await linkEventItem(database, ws, buying.id, transactionId);
        } catch (e) {
          if (!isNothingLeft(e)) throw e;
          await navigate(coverTarget(eventId, transactionId, { item: buying.id, ws: openTab ?? undefined }));
          return;
        }
        await navigate({ to: '/events/$eventId/plan', params: { eventId }, search: { ws: openTab ?? undefined } });
      }
    });
  }

  if (events.isSuccess && !event) return <Empty>That event is no longer here.</Empty>;

  const data = plan.data;
  // The ring is every rupiah tagged to the event, so its slices are every category that has money in it.
  const spentLines = (data?.lines ?? []).filter((line) => line.actualMinor > 0);
  // Where it went keeps every category, planned or not — this is the page that must never hide what was spent.
  const rows = data ? whereItWentRows(data) : [];
  const totals = data ? planTotals(data) : null;
  const spent = data?.spentMinor ?? 0;
  // An event has a plan when something is on the list, whatever it adds up to — not when a figure was set for it.
  const hasPlan = data?.hasPlan === true;
  const onPlan = hasPlan && page === 1;
  const transactions = history.data?.length ?? 0;

  /**
   * All, then one button per workspace that spent in the event.
   *
   * It only appears once there are two, since one button named after the only workspace there is says nothing.
   * A transfer is filed in no workspace, so it shows under every tab — as it does in every workspace's
   * Cashflow — and the ring counts no transfers, so nothing is counted twice by it being there.
   */
  const workspaceTabs = books.length > 1 && (
    <div role="group" aria-label="Workspace" data-testid="event-workspaces" className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-slate-200 p-0.5">
      {[{ id: null, name: 'All' }, ...books].map((choice) => (
        <button
          key={choice.id ?? 'all'}
          type="button"
          aria-pressed={openTab === choice.id}
          onClick={() => setTab(choice.id)}
          className={cx(
            'rounded-md px-3 py-1.5 text-sm font-medium',
            openTab === choice.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
          )}
        >
          {choice.name}
        </button>
      ))}
    </div>
  );

  const donut = (
    <div data-testid="event-total">
      <Donut
        slices={spentLines.map((line) => ({ key: line.categoryId ?? 'none', label: line.name, totalMinor: line.actualMinor, colour: categoryColour(line.categoryId ?? 'none') }))}
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
        // No longer gated on a category set: an event without one plans against the monthly tree, and it may record
        // spending against that same tree. Gating it left such an event able to plan and unable to pay.
        controls={
          <RoundButton label="Add spending" pressed={adding} onClick={() => setAdding((was) => !was)}>
            <Plus size={22} aria-hidden />
          </RoundButton>
        }
        action={!adding ? <Button onClick={() => setAdding(true)}>Add spending</Button> : undefined}
      />
      <button type="button" onClick={() => void navigate({ to: '/events' })} className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800">
        <ChevronLeft size={16} aria-hidden />
        All events
      </button>
      <ErrorBox error={error ?? events.error ?? plan.error} />

      {adding && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">{buying ? `Buy ${buying.name}` : 'Add spending to this event'}</h2>
          <form onSubmit={record} className="grid gap-3 md:grid-cols-2">
            <Field label="Date">
              <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Keramik lantai" />
            </Field>
            <Field label="Paid with">
              <Select value={payingWith} onChange={(e) => setMoneyId(e.target.value)}>
                <option value="">Choose…</option>
                {money.map((account) => (
                  <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose…</option>
                {planCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {planName(category.id)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" hint={buying ? 'Filled in from the estimate. Change it to what the receipt really says.' : undefined}>
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

      {workspaceTabs && <div className="flex justify-center">{workspaceTabs}</div>}

      {event && (
        <div data-testid="event-sheet">
        <Card>
          <div className="flex flex-col items-center gap-0.5 pt-1">
            {/* The event's length used to be the gauge's third figure; it belongs with the dates, and the gauge's
                third place goes to what is still to buy — a figure only the plan has. */}
            <span className="text-sm font-semibold">
              {eventDates(event)} · {dayCount(event.startsOn, event.endsOn)} {dayCount(event.startsOn, event.endsOn) === 1 ? 'day' : 'days'}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <StatusChip status={eventStatus(event, today)} />
              {setName && `draws on ${setName}`}
            </span>
          </div>

          {spent === 0 && !hasPlan ? (
            /* A category is no longer something one plans: a plan is a list of things, and the card below is the way in. */
            <p className="py-6 text-center text-sm text-slate-500">Nothing spent on it yet. Plan what to buy below, or record the first payment.</p>
          ) : hasPlan ? (
            <Deck page={page} onPage={setPage} labels={['Where it went', 'Against the plan']}>
              {donut}
              <div>
                <BudgetGauge
                  // An event is read whole, in the owner's own money, whichever workspace's tab is open.
                  currency={ws.baseCurrency}
                  // Only the categories that have items: a trip that planned the flights and not the food would
                  // otherwise read every unplanned rupiah as over a plan that never meant to cover it.
                  progress={gaugeFor(data!)}
                  month={today.slice(0, 7)}
                  today={today}
                  // `set` is the caps label the gauge prints and `spent` the middle one, and PLAN_WORDS cannot hold
                  // either as a constant — both depend on whether the plan speaks for the whole of the event.
                  words={{ ...PLAN_WORDS, set: plannedLabel(data!), spent: spentLabel(data!) }}
                  last={{ label: 'Still to buy', value: formatMinor(totals!.toBuyMinor, ws.baseCurrency) }}
                />
                {/* The mockup's order under the ring: how the bought things went, and what nobody planned. Every
                    figure is `planTotals`', never recomputed here, so no two screens can disagree about one event. */}
                <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  {data!.boughtCount > 0 && (
                    <Figure label="Difference so far">
                      <span className={TONE[differenceWords(data!.differenceMinor, ws.baseCurrency).tone]}>{differenceWords(data!.differenceMinor, ws.baseCurrency).text}</span>
                    </Figure>
                  )}
                  {totals!.notPlannedMinor > 0 && (
                    <Figure label="Not planned">
                      <Money minor={totals!.notPlannedMinor} currency={ws.baseCurrency} />
                    </Figure>
                  )}
                  {/* Money that came back answers no item, so it moves the total above without a row of its own on
                      any of these lines. Named here rather than clamped away, and named in full on the plan screen. */}
                  {totals!.moneyBackMinor > 0 && (
                    <Figure label="Money back">
                      <Money minor={totals!.moneyBackMinor} currency={ws.baseCurrency} className="text-emerald-700" />
                    </Figure>
                  )}
                  {/*
                   * The ring measures the planned categories alone; the chart one swipe back adds up the whole event.
                   * Where those differ the other page's figure is printed here under the other page's own words, so
                   * the two totals are one reading with a reason, rather than two numbers for one trip.
                   */}
                  {data!.spentMinor !== data!.plannedSpentMinor && (
                    <Figure label="Total spent">
                      <Money minor={Math.max(0, data!.spentMinor)} currency={ws.baseCurrency} />
                    </Figure>
                  )}
                </dl>
              </div>
            </Deck>
          ) : (
            donut
          )}

          {/*
           * The rows belong to "Where it went", the one page that shows every category. Against the plan there are
           * no rows: a category is planned or it is not, and a bar drawn against a category that planned nothing
           * would be measuring spending against a figure nobody set. The plan's own rows are on the plan screen.
           */}
          {!onPlan && rows.length > 0 && (
            <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100" data-testid="event-detail-sheet">
              {rows.map((row) => (
                <div key={row.categoryId ?? 'none'} className="flex min-h-12 flex-col justify-center py-2.5">
                  <ShareLine
                    colour={categoryColour(row.categoryId ?? 'none')}
                    name={row.categoryId === null ? row.name : planName(row.categoryId)}
                    // Clamped: a category whose refunds outweigh its purchases still cannot have spent less than
                    // nothing. What came back is named under the ring, on the page that can explain it.
                    amountMinor={Math.max(0, row.actualMinor)}
                    wholeMinor={spent}
                    currency={ws.baseCurrency}
                    chevron={false}
                    // A planned row is read against its own plan; an unplanned one has nothing to be read against.
                    figure={
                      row.planned ? (
                        <span className="shrink-0 text-sm">
                          <Money minor={Math.max(0, row.actualMinor)} currency={ws.baseCurrency} className="font-semibold" /> <span className="text-slate-500">of</span>{' '}
                          <Money minor={row.plannedMinor} currency={ws.baseCurrency} className="text-slate-500" />
                        </span>
                      ) : undefined
                    }
                  />
                  <span className="mt-1 ml-[22px] flex items-center gap-2 text-xs text-slate-500">
                    {/* Grey, not amber: a category nobody planned is a fact about the plan, never a warning. */}
                    {hasPlan && !row.planned && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">no items</span>}
                    {row.subline}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
        </div>
      )}

      {/*
       * Between the chart and the suggestions, and no longer put away while spending is being recorded: it is a card
       * rather than a second form, so nothing on it competes with the one question the form is asking.
       */}
      {data && <PlanCard eventId={eventId} plan={data} bookId={openTab} />}

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
