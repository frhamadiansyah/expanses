import { expenseLines, formatMinor, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { deleteEvent, finishEvent, linkEventItem, postTransaction, tagTransaction } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox, Money } from '../../ui';
import {
  DestructiveRow,
  InsetGroup,
  InsetRow,
  LargeTitle,
  Panel,
  SegmentedControl,
  SelectRow,
  TextRow,
  type CornerAction,
  type GroupChild,
  type InsetRowProps,
  type Segment,
} from '../../ui/native';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { coverTarget, isNothingLeft } from './buy-item';
import { useCategorySetMembership, useCategorySets, useSetCategories } from '../categories/set-queries';
import { BudgetGauge } from '../transactions/BudgetGauge';
import { ShareLine } from '../transactions/CategoryLines';
import { categoryColour } from '../transactions/category-colours';
import { Deck } from '../transactions/Deck';
import { Donut } from '../transactions/Donut';
import { buildRows } from '../transactions/list-model';
import { TransactionRow, useRecategorise } from '../transactions/TransactionRow';
import { eventDates, eventStatus, StatusChip } from './EventsPage';
import { PlanCard } from './PlanCard';
import { BACK_WORDS, chartUnder, differenceWords, gaugeFor, PLAN_WORDS, plannedLabel, planTotals, spentLabel, TONE, whereItWentRows } from './plan-view';
import { editInsteadIn } from '../workspaces/filing';
import { useCategoryWorkspaces, useWorkspaceBadges } from '../workspaces/queries';
import { useBooksInEvent, useEventHistory, useEventPlan, useEvents, useEventSuggestions } from './queries';

/** A suggestion, a workspace's own row: wrapped so the group can still hand it its separator. */
function TaggableRow({ position, ...row }: GroupChild & InsetRowProps) {
  return <InsetRow {...row} position={position} />;
}

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
  // Which shell is drawing this page. The history's item pills are capped on the phone and whole on the desktop.
  const phone = usePhone();
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
  const money = moneyHolders(accounts).filter((a) => canPayWith(a));
  const sets = useCategorySets({ ownerWide: true }).data ?? [];
  const setCategories = useSetCategories(event?.setId ?? null).data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const today = isoDate();
  // One copy of the category gesture for this screen: the sheet it opens and the Undo toast it leaves.
  const recategorise = useRecategorise();
  /*
   * An event's history is owner-wide on purpose — one trip is paid for out of several workspaces — but the
   * sheet the circle opens offers the **open** workspace's categories, as every picker in the app does. So a
   * payment filed in another workspace must not be offered the gesture at all: re-filing it there is a write
   * `replaceTransaction` refuses, and a refusal met after the choice is a choice that should not have been
   * offered. The same rule Cashflow states as `clickable`, said here where the history is always multi-workspace.
   */
  const historyBadges = useWorkspaceBadges((history.data ?? []).map((tx) => tx.id));
  // Until the filing is known every row looks unfiled, which would read as "this workspace's" for that window.
  const filedHere = (transactionId: string) => historyBadges.ready && editInsteadIn(historyBadges.of(transactionId), ws.bookId) === null;

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
  // What `record()` posts, parsed the way it parses it, in the paying account's currency. Money coming back (a figure
  // below nought) pays nothing out and asks nothing.
  const typedMinor = (() => {
    const paidWith = accounts.find((account) => account.id === payingWith);
    if (!paidWith) return 0;
    try {
      return parseMajor(amount, paidWith.currency ?? ws.baseCurrency);
    } catch {
      return 0;
    }
  })();
  const setAside = useSetAside(typedMinor > 0 ? spendingDoor(payingWith, typedMinor) : null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function record(submitted?: FormEvent) {
    submitted?.preventDefault();
    // The form submits on Enter too: the question is a condition on every way in.
    if (!setAside.ready) return;
    await run(async () => {
      const paidWith = accounts.find((account) => account.id === payingWith);
      if (!paidWith) throw new Error('Choose what it was paid with');
      if (!categoryId) throw new Error('Choose a category');
      const currency = paidWith.currency ?? ws.baseCurrency;
      const amountMinor = parseMajor(amount, currency);
      /*
       * Asked before a rupiah is written, because the link that follows can refuse and the payment cannot be taken
       * back. A share is a whole figure above nought, so buying a thing for nought or for less posted the payment,
       * tagged it to the event, and only then failed with the repository's own words about shares — leaving behind
       * a transaction the user never got the thing they asked for. A refusal must leave no transaction behind.
       *
       * Only when something is being bought: money coming back is recorded here as spending of its own, and that is
       * a figure below nought on purpose. It simply answers no item.
       */
      if (buying && amountMinor <= 0) {
        throw new Error('What it cost is a figure above nought. Money coming back is recorded on its own, without buying an item.');
      }
      const transactionId = await postTransaction(database, ws, {
        occurredOn,
        description,
        lines: expenseLines({
          categoryAccountId: categoryId,
          paymentAccountId: paidWith.id,
          amountMinor,
          currency,
        }),
        setAside: setAside.choice,
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
  // Every figure this card prints is `planTotals`', clamped once and in one place.
  const spent = totals?.spentMinor ?? 0;
  /*
   * What the ring and its rows are drawn against, which is not the figure in the middle of it.
   *
   * A category's share is clamped at nought — nothing can take a share of less than nothing — so measuring those
   * shares against the event's *net* drew Travel at 125 % of a ring whose middle said Rp4.000.000. The whole is
   * therefore what went out, and what came back is named under the ring by `chartUnder` rather than left as the
   * difference between a ring that adds to one figure and a middle that says another.
   */
  const whole = totals?.wentOutMinor ?? 0;
  // The raw total, and only ever to ask whether anything was tagged at all: an event whose refunds outweigh its
  // purchases has money in it, and "Nothing spent on it yet" would be the page hiding a refund rather than a total.
  const anyMoney = (data?.spentMinor ?? 0) !== 0;
  // An event has a plan when something is on the list, whatever it adds up to — not when a figure was set for it.
  const hasPlan = data?.hasPlan === true;
  const onPlan = hasPlan && page === 1;
  const transactions = history.data?.length ?? 0;
  // Worked out once rather than at each of the two places it is printed: the words and the tone are one reading.
  const difference = data && data.boughtCount > 0 ? differenceWords(data.differenceMinor, ws.baseCurrency) : null;
  /*
   * Whether the list under the ring has anything in it at all.
   *
   * Every line of it is conditional, so a planned event that has spent nothing drew an empty `<dl>` — a bordered
   * strip with nothing inside, which reads as a row that failed to load rather than as nothing to say.
   */
  const quotesTheChart = data !== undefined && totals !== null && data.spentMinor !== data.plannedSpentMinor && totals.netBackMinor === 0;
  const underRing =
    totals !== null &&
    (difference !== null ||
      totals.notPlannedMinor > 0 ||
      totals.moneyBackMinor > 0 ||
      quotesTheChart ||
      totals.netBackMinor > 0 ||
      (totals.planNetBackMinor > 0 && totals.planNetBackMinor !== totals.netBackMinor));

  /**
   * All, then one button per workspace that spent in the event.
   *
   * It only appears once there are two, since one button named after the only workspace there is says nothing.
   * A transfer is filed in no workspace, so it shows under every tab — as it does in every workspace's
   * Cashflow — and the ring counts no transfers, so nothing is counted twice by it being there.
   */
  const workspaceTabs = books.length > 1 && (
    <div data-testid="event-workspaces" className="mb-[14px] w-full md:max-w-sm">
      <SegmentedControl
        label="Workspace"
        segments={[{ key: 'all', label: 'All' }, ...books.map((book): Segment => ({ key: book.id, label: book.name }))]}
        value={openTab ?? 'all'}
        onChange={(key) => setTab(key === 'all' ? null : key)}
      />
    </div>
  );

  const donut = (
    <div data-testid="event-total">
      <Donut
        slices={spentLines.map((line) => ({ key: line.categoryId ?? 'none', label: line.name, totalMinor: line.actualMinor, colour: categoryColour(line.categoryId ?? 'none') }))}
        // What went out, not the net: the slices are what the categories spent, and a slice may never be longer
        // than the ring it is drawn on. The middle stays the event's own total, with the difference said under it.
        totalMinor={whole}
        middle={formatMinor(spent, ws.baseCurrency)}
        label="Total spent"
        // How many payments make the figure up — or, when the figure is a nought a refund drove it to, what
        // came back, said right under it rather than left for the plan screen one swipe away.
        under={totals ? chartUnder(totals, transactions, ws.baseCurrency) : undefined}
      />
    </div>
  );

  // Oldest day last, like Cashflow; each day a card of its own.
  // The history as the list's own rows, so an event draws transactions the way every other screen does.
  const historyRows = new Map(buildRows(history.data ?? [], [], accounts, []).map((row) => [row.id, row]));
  const days = new Map<string, NonNullable<typeof history.data>>();
  for (const tx of history.data ?? []) days.set(tx.occurredOn, [...(days.get(tx.occurredOn) ?? []), tx]);

  /*
   * What each payment in the history answered, read off the plan rather than worked out again here.
   *
   * `purchase` is the item's side of the link and `unplanned` the plan's own leftover rows — the very rows the plan
   * screen prints — so a history row says what the plan says, in the plan's words, and the two cannot drift apart.
   */
  const answers = new Map<string, string[]>();
  for (const item of (data?.lines ?? []).flatMap((line) => line.items)) {
    const id = item.purchase?.transactionId;
    if (id) answers.set(id, [...(answers.get(id) ?? []), item.name]);
  }
  const leftovers = new Set((data?.lines ?? []).flatMap((line) => line.unplanned).map((row) => row.transactionId));

  // No longer gated on a category set: an event without one plans against the monthly tree, and it may record
  // spending against that same tree. Gating it left such an event able to plan and unable to pay.
  const addSpending: CornerAction = {
    key: 'add',
    label: 'Add spending',
    glyph: <Plus size={22} aria-hidden />,
    run: () => setAdding((was) => !was),
  };

  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">
      <LargeTitle title={event?.name ?? 'Event'} back="All events" backTo="/events" actions={[addSpending]} />
      <ErrorBox error={error ?? events.error ?? plan.error} />

      {adding && (
        <form onSubmit={record}>
          <InsetGroup header={buying ? `Buy ${buying.name}` : 'Add spending to this event'}>
            <TextRow label="Date" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            <TextRow label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Keramik lantai" />
            <SelectRow label="Paid with" value={payingWith} onChange={(e) => setMoneyId(e.target.value)}>
              <option value="">Choose…</option>
              {money.map((account) => (
                <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
              ))}
            </SelectRow>
            <SelectRow label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {planCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {planName(category.id)}
                </option>
              ))}
            </SelectRow>
            <TextRow
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="1500000"
              hint={buying ? 'Filled in from the estimate. Change it to what the receipt really says.' : undefined}
            />
          </InsetGroup>
          {/* The two ways out of the card, as rows: the form is still what submits, so Enter saves as it did. */}
          {setAside.node}
          <InsetGroup>
            <InsetRow title="Save" onClick={() => void record()} disabled={!setAside.ready} chevron={false} />
            <InsetRow title="Done" onClick={() => setAdding(false)} chevron={false} />
          </InsetGroup>
        </form>
      )}

      {workspaceTabs}

      {event && (
        <Panel testId="event-sheet">
          <div className="flex flex-col items-center gap-0.5 pt-1">
            {/* The event's length used to be the gauge's third figure; it belongs with the dates, and the gauge's
                third place goes to what is still to buy — a figure only the plan has. */}
            <span className="text-[13px] font-semibold text-[var(--ph-ink)]">
              {eventDates(event)} · {dayCount(event.startsOn, event.endsOn)} {dayCount(event.startsOn, event.endsOn) === 1 ? 'day' : 'days'}
            </span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--ph-ink-3)]">
              <StatusChip status={eventStatus(event, today)} />
              {setName && `draws on ${setName}`}
            </span>
          </div>

          {!anyMoney && !hasPlan ? (
            /* A category is no longer something one plans: a plan is a list of things, and the card below is the way in. */
            <p className="py-6 text-center text-[13px] text-[var(--ph-ink-3)]">Nothing spent on it yet. Plan what to buy below, or record the first payment.</p>
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
                    *money* figure is `planTotals`', never recomputed here, so no two screens can disagree about one
                    event — the ring above included, since `gaugeFor` is the same reading of the same figures. The
                    three that are not are the plan's own counts and its signed difference (`boughtCount`,
                    `differenceMinor`, and the `spentMinor`/`plannedSpentMinor` comparison that decides whether the
                    chart is worth quoting): none is a figure a clamp could ever apply to.
                    Drawn at all only when it has a line in it: an empty `<dl>` is a bordered strip saying nothing. */}
                {underRing && (
                <dl className="mt-2 space-y-1 border-t-[0.5px] border-[var(--ph-hair)] pt-2 text-[12.5px] text-[var(--ph-ink-3)]">
                  {difference && (
                    <Figure label="Difference so far">
                      <span className={TONE[difference.tone]}>{difference.text}</span>
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
                  {quotesTheChart && (
                    <Figure label="Total spent">
                      <Money minor={totals!.spentMinor} currency={ws.baseCurrency} />
                    </Figure>
                  )}
                  {/*
                   * And when more came back than went out there is no total to quote: "Total spent Rp0" was the page
                   * clamping a −Rp1.000.000 chart to nought and calling the nought a quotation of it. What is true is
                   * said instead, the right way round and in the page's own words for money coming back — first of
                   * the whole event, then of the ring alone when the two went under by different amounts.
                   */}
                  {totals!.netBackMinor > 0 && (
                    <Figure label={BACK_WORDS.event}>
                      <Money minor={totals!.netBackMinor} currency={ws.baseCurrency} className="text-emerald-700" />
                    </Figure>
                  )}
                  {totals!.planNetBackMinor > 0 && totals!.planNetBackMinor !== totals!.netBackMinor && (
                    <Figure label={BACK_WORDS.plan}>
                      <Money minor={totals!.planNetBackMinor} currency={ws.baseCurrency} className="text-emerald-700" />
                    </Figure>
                  )}
                </dl>
                )}
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
            <div className="mt-2 border-t-[0.5px] border-[var(--ph-hair)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]" data-testid="event-detail-sheet">
              {rows.map((row) => (
                <div key={row.categoryId ?? 'none'} className="flex min-h-12 flex-col justify-center py-2.5">
                  <ShareLine
                    colour={categoryColour(row.categoryId ?? 'none')}
                    name={row.categoryId === null ? row.name : planName(row.categoryId)}
                    // Clamped: a category whose refunds outweigh its purchases still cannot have spent less than
                    // nothing. What came back is named under the ring, on the page that can explain it.
                    amountMinor={Math.max(0, row.actualMinor)}
                    wholeMinor={whole}
                    currency={ws.baseCurrency}
                    chevron={false}
                    // A planned row is read against its own plan; an unplanned one has nothing to be read against.
                    figure={
                      row.planned ? (
                        <span className="shrink-0 text-[13px]">
                          <Money minor={Math.max(0, row.actualMinor)} currency={ws.baseCurrency} className="font-semibold" />{' '}
                          <span className="text-[var(--ph-ink-3)]">of</span>{' '}
                          <Money minor={row.plannedMinor} currency={ws.baseCurrency} className="text-[var(--ph-ink-3)]" />
                        </span>
                      ) : undefined
                    }
                  />
                  <span className="mt-1 ml-[22px] flex items-center gap-2 text-[12.5px] text-[var(--ph-ink-3)]">
                    {/* Quiet, never amber: a category nobody planned is a fact about the plan, not a warning. */}
                    {hasPlan && !row.planned && <span className="font-semibold text-[var(--ph-ink-3)]">no items</span>}
                    {row.subline}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/*
       * Between the chart and the suggestions, and no longer put away while spending is being recorded: it is a card
       * rather than a second form, so nothing on it competes with the one question the form is asking.
       */}
      {data && <PlanCard eventId={eventId} plan={data} bookId={openTab} />}

      {(suggestions.data?.length ?? 0) > 0 && event && (
        <div data-testid="event-suggestions">
          <InsetGroup
            header={`Was this part of ${event.name}?`}
            footer="Inside the dates, in a category it draws on, not yet tagged. Tagged spending leaves your monthly caps and is shown on the budget as its own line, because you meant to spend it."
          >
            {(suggestions.data ?? []).map((candidate) => (
              /* The row is the Yes: a row never holds a button of its own, and what it does is what it is named. */
              <TaggableRow
                key={candidate.transactionId}
                title={candidate.description}
                subtitle={`${candidate.occurredOn} · ${nameOf(candidate.categoryAccountId)}`}
                value={formatMinor(candidate.amountBaseMinor, ws.baseCurrency)}
                valueTone="ink"
                label={`Tag ${candidate.description}`}
                chevron={false}
                onClick={() => void run(() => tagTransaction(database, ws, candidate.transactionId, eventId))}
              />
            ))}
          </InsetGroup>
        </div>
      )}

      {days.size > 0 && (
        <section>
          <h2 className="px-[4px] pb-[6px] text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">Transaction history</h2>
          {[...days.entries()].map(([date, txs]) => {
            const d = new Date(`${date}T00:00:00`);
            const total = txs.reduce((sum, tx) => sum + tx.entries.filter((e) => e.accountKind === 'expense').reduce((s, e) => s + e.amountBaseMinor, 0), 0);
            return (
              <Panel key={date}>
                <div className="-mx-[13px] flex items-center gap-3 border-b-[0.5px] border-[var(--ph-hair)] px-[13px] pb-2">
                  <span className="tabular w-9 shrink-0 text-2xl leading-none font-semibold text-[var(--ph-ink)]">{d.getDate()}</span>
                  <span className="flex flex-col text-[12.5px] leading-tight text-[var(--ph-ink-3)]">
                    <b className="font-semibold text-[var(--ph-ink-2)]">{d.toLocaleDateString('en-GB', { weekday: 'long' })}</b>
                    {d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                  </span>
                  <Money minor={total} currency={ws.baseCurrency} className="ml-auto text-[13px] font-semibold text-[var(--ph-ink-2)]" />
                </div>
                <ul className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
                  {txs.map((tx) => {
                    const expense = tx.entries.find((entry) => entry.accountKind === 'expense');
                    const paidWith = tx.entries.find((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability');
                    /*
                     * What this payment answered, in the plan's own words: one pill per item it settled, and an
                     * amber one when it still has something left on it that no item claims. A receipt that bought
                     * two things and left a little over says all three, which is exactly what it did — and a
                     * payment nobody planned at all says only "not planned", which is the honest whole of it.
                     */
                    const answered = answers.get(tx.id) ?? [];
                    const leftover = leftovers.has(tx.id);
                    // The same row every other transaction list draws, so this history gains the gestures too:
                    // tap it for its receipt, tap its circle to re-file it. Nothing here deletes or edits in
                    // place — an event has never offered either, and a new way in inherits every refusal.
                    const listRow = historyRows.get(tx.id)!;
                    return (
                      <TransactionRow
                        key={tx.id}
                        row={listRow}
                        accounts={accounts}
                        testId="event-history"
                        amountMinor={expense?.amountBaseMinor ?? 0}
                        currency={ws.baseCurrency}
                        className="py-2.5"
                        title="Open the receipt"
                        onOpen={() => void navigate({ to: '/transactions/$transactionId', params: { transactionId: tx.id } })}
                        onRecategorise={recategorise.offers(listRow) && filedHere(tx.id) ? recategorise.start : undefined}
                        label={expense?.accountName ?? tx.description}
                        subtitle={
                          <>
                            {tx.description}
                            {paidWith && ` · ${paidWith.accountName}`}
                          </>
                        }
                        under={
                          (answered.length > 0 || leftover) && (
                            <span className="mt-1 flex flex-wrap items-center gap-1">
                              {/*
                               * On a phone, at most three and then a count: a shopping trip answering eight items
                               * printed eight pills that wrapped, and the row grew taller than the day card around
                               * it. That is a 390px problem and nothing else — a desktop day card has room for all
                               * eight — so the desktop keeps every pill and the whole of every name. Capping both
                               * shells for one shell's sake takes the answer away from the wider one, and the wide
                               * screen is never made poorer to fix the narrow one.
                               *
                               * `usePhone` rather than a `md:` class, because this is which pills exist and not how
                               * they look: hidden by CSS they are still in the page, where a screen reader reads out
                               * the three the eye is being spared. It is the same mechanism the shell itself uses.
                               *
                               * Keyed by position as well as name, because two items on one plan may share a name —
                               * "Nappies" bought twice is two items, and two pills keyed alike is one pill React
                               * drops.
                               */}
                              {(phone ? answered.slice(0, 3) : answered).map((name, at) => (
                                <span
                                  key={`${name}-${at}`}
                                  className={cx(
                                    'truncate rounded-full bg-[var(--ph-fill)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ph-ink-2)]',
                                    // Bounded by the row either way, so nothing overflows; the phone's bound is tighter.
                                    phone ? 'max-w-[10rem]' : 'max-w-full',
                                  )}
                                >
                                  {name}
                                </span>
                              ))}
                              {phone && answered.length > 3 && (
                                <span className="rounded-full bg-[var(--ph-fill)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ph-ink-2)]">{`+${answered.length - 3} more`}</span>
                              )}
                              {/* In the warning ink the plan screen names the same fact in, rather than an amber pill. */}
                              {leftover && <span className="text-[11px] font-semibold text-[var(--ph-warn)]">not planned</span>}
                            </span>
                          )
                        }
                      />
                    );
                  })}
                </ul>
              </Panel>
            );
          })}
        </section>
      )}

      {event && (
        <>
          <InsetGroup>
            <InsetRow
              title={event.finishedAt === null ? 'Mark as done' : 'Reopen'}
              label={event.finishedAt === null ? `Finish ${event.name}` : `Reopen ${event.name}`}
              chevron={false}
              onClick={() => void run(() => finishEvent(database, ws, event.id, event.finishedAt === null))}
            />
          </InsetGroup>
          {/* Its own group: the air around a destructive row is the only undo a finger gets. */}
          <InsetGroup>
            <DestructiveRow
              label="Remove event"
              onClick={() =>
                void run(async () => {
                  await deleteEvent(database, ws, event.id);
                  await navigate({ to: '/events' });
                })
              }
            />
          </InsetGroup>
        </>
      )}

      {/* The category sheet and its Undo toast, once for the screen rather than once per row. */}
      {recategorise.overlay}
      </div>
    </div>
  );
}
