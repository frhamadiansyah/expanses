import { formatMinor } from '@expanses/core';
import { setEventItemDone, type AccountRow } from '@expanses/db';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Check, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, toneClass, type CornerAction, type Tone } from '../../ui/native';
import { GROUP_RADIUS } from '../../ui/native/metrics';
import { CategoryIcon } from '../categories/CategoryIcon';
import { buyTarget } from './buy-item';
import { differenceWords, plannedLabel, planTotals, quantityWords } from './plan-view';
import { useEventItemsReady, useEventPlan, useEvents } from './queries';

/** The kit's tones for what a difference is. The words themselves are `differenceWords`'. */
const HERE: Record<'over' | 'under' | 'exact', Tone> = { over: 'alarm', under: 'tint', exact: 'ink-3' };

/**
 * One thing on the plan, as a checklist line in the Cashflow history's size: an empty circle while it is still to
 * buy, a tick once done, then the name and the figure.
 *
 * Two targets side by side, never one inside the other: the circle is a button, 44 wide, and what it does follows the
 * item — nothing paid yet, it is Buy it now; paid towards and still open, it marks the item done; done, it puts it back
 * on the list. The rest of the row is the link into the item.
 */
function PlanItemRow({
  eventId,
  itemId,
  name,
  subtitle,
  figure,
  state,
  search,
  onBuy,
  onDone,
}: {
  eventId: string;
  itemId: string;
  name: string;
  subtitle: string;
  figure: string;
  /** Nothing paid yet, paid towards and still open, or done. */
  state: 'open' | 'paid' | 'done';
  search: { ws: string | undefined };
  onBuy: () => void;
  onDone: (done: boolean) => void;
}) {
  const done = state === 'done';
  return (
    <div className="flex items-center" data-testid="plan-item">
      <button
        type="button"
        aria-label={done ? `Reopen ${name}` : state === 'paid' ? `Done buying ${name}` : `Buy ${name}`}
        onClick={() => (state === 'open' ? onBuy() : onDone(!done))}
        className="ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      >
        <span
          aria-hidden
          className={cx(
            'flex h-6 w-6 items-center justify-center rounded-full',
            done ? 'bg-[var(--ph-tint-panel)] text-[var(--ph-tint)]' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset',
          )}
        >
          {done && <Check size={14} strokeWidth={3} />}
        </span>
      </button>
      <Link
        to="/events/$eventId/plan/$itemId"
        params={{ eventId, itemId }}
        search={search}
        className="ph-focus-inset flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pr-[14px] pl-1"
      >
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-sm font-medium', done ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>{name}</span>
          {subtitle && <span className="block truncate text-xs text-[var(--ph-ink-3)]">{subtitle}</span>}
        </span>
        <span className={cx('tabular shrink-0 text-sm font-semibold whitespace-nowrap', done ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>{figure}</span>
      </Link>
    </div>
  );
}

/**
 * A category of the plan as one card, laid out like a day in the Cashflow history: its mark, its name over how many of
 * its items are bought, and on the right what was paid of what it plans; a hairline, then its items.
 */
function PlanCategoryCard({
  categoryId,
  name,
  itemCount,
  boughtCount,
  paid,
  planned,
  accounts,
  children,
}: {
  categoryId: string | null;
  name: string;
  itemCount: number;
  boughtCount: number;
  paid: string;
  planned: string;
  accounts: readonly AccountRow[];
  children: ReactNode;
}) {
  return (
    <section
      data-testid="plan-category"
      aria-label={name}
      className="overflow-hidden bg-[var(--ph-surface)]"
      style={{ borderRadius: GROUP_RADIUS, marginBottom: 12 }}
    >
      <div className="flex items-center gap-3 border-b-[0.5px] border-[var(--ph-hair)] px-[14px] pt-3 pb-2.5">
        <CategoryIcon categoryId={categoryId} accounts={accounts} />
        <div className="flex min-w-0 flex-1 flex-col text-xs leading-tight text-[var(--ph-ink-3)]">
          <h2 className="truncate text-xs font-semibold text-[var(--ph-ink-2)]">{name}</h2>
          <span>
            {itemCount} {itemCount === 1 ? 'item' : 'items'} · {boughtCount === 0 ? 'none' : boughtCount} bought
          </span>
        </div>
        <span className="tabular shrink-0 text-right text-sm leading-tight font-semibold text-[var(--ph-ink)]">
          {paid}
          <span className="block text-xs font-normal text-[var(--ph-ink-3)]">of {planned}</span>
        </span>
      </div>
      <div className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">{children}</div>
    </section>
  );
}

/**
 * An event's plan, as a checklist: how many are bought and what is left to buy on top, then a card per category —
 * its header what was paid of what it plans, its items still to buy first and bought after, greyed.
 *
 * Only the plan is here. Spending nobody planned, and money that came back, are on the event's own page, under the
 * chart of everything it spent: this screen is the list of things to buy and nothing else.
 */
export function PlanPage() {
  const { eventId } = useParams({ from: '/events/$eventId/plan' });
  // Which workspace tab the plan was opened from, so it keeps reading in it. `ws` below is the workspace context.
  const { ws: tab } = useSearch({ from: '/events/$eventId/plan' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  const plan = useEventPlan(eventId, tab ?? null);
  const ready = useEventItemsReady();
  const accounts = useAccounts().data ?? [];
  const [error, setError] = useState<unknown>(null);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const screen = (children: ReactNode) => (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );

  if (events.isSuccess && !event) {
    // Not a bare sentence: a screen whose subject has gone still owes the user a way on from it.
    return screen(
      <>
        <LargeTitle title="Plan" back="All events" backTo="/events" />
        <Empty>That event is no longer here.</Empty>
      </>,
    );
  }

  const data = plan.data;
  const totals = data ? planTotals(data) : null;
  // Worked out once rather than at each of the two places it is read: the words and the tone are one reading.
  const difference = data && data.boughtCount > 0 ? differenceWords(data.differenceMinor, ws.baseCurrency) : null;
  const search = { ws: tab };
  const addLabel = 'Add an item';
  const add: CornerAction = {
    key: 'add',
    label: addLabel,
    glyph: <Plus size={22} aria-hidden />,
    to: '/events/$eventId/plan/new',
    params: { eventId },
    search,
  };
  const rp = (minor: number) => formatMinor(minor, ws.baseCurrency);

  return screen(
    <>
      <LargeTitle
        title={`Plan · ${event?.name ?? ''}`}
        // The tab the plan was opened in goes back with it, or the event would reset to "All" on the way home.
        back="Back to the event"
        backTo="/events/$eventId"
        backParams={{ eventId }}
        backSearch={search}
        actions={[add]}
      />
      <ErrorBox error={error ?? events.error ?? plan.error} />

      {/*
       * A save on a database from before migration 0049 is a deliberate no-op that still hands back an id, so an
       * item would appear to save and then vanish. Said out loud here, and said again on the item form, which opens
       * as it always does, repeats this warning and keeps Save turned off until the data has finished updating.
       */}
      {ready.isSuccess && !ready.data && (
        <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-warn)]">
          This copy of the data is from before a plan was a list of things to buy, so nothing can be added to it yet. Open it once on a version that has
          finished updating, and the plan will be here.
        </p>
      )}

      {data && data.itemCount === 0 ? (
        <>
          <Empty>Nothing planned yet. Add what is planned to buy and roughly what it costs.</Empty>
          <InsetGroup>
            <InsetRow title="Add the first item" to="/events/$eventId/plan/new" params={{ eventId }} search={search} />
          </InsetGroup>
        </>
      ) : (
        data &&
        totals && (
          <>
            {/* One reading on top: how many are ticked off and what is left to buy, with what was planned under it. */}
            <div data-testid="plan-totals">
              <InsetGroup>
                <div className="flex flex-col items-center px-4 pt-3 pb-3 text-center">
                  <span data-testid="plan-count" className="text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
                    {data.boughtCount} of {data.itemCount} bought
                  </span>
                  <span data-testid="plan-to-go" className="tabular mt-1 text-[24px] leading-[30px] font-extrabold text-[var(--ph-ink)]">
                    {/* "All bought" only once every item is done: an open item paid in full still has Rp0 to go. */}
                    {totals.toBuyMinor > 0 || data.boughtCount < data.itemCount ? `${rp(totals.toBuyMinor)} to go` : 'All bought'}
                  </span>
                  <span className="mt-2 h-[7px] w-full overflow-hidden rounded-full bg-[var(--ph-track)]">
                    <span
                      className="block h-full rounded-full bg-[var(--ph-tint)]"
                      style={{ width: `${totals.plannedMinor > 0 ? Math.min(100, Math.round(((totals.plannedMinor - totals.toBuyMinor) / totals.plannedMinor) * 100)) : 0}%` }}
                    />
                  </span>
                  <span data-testid="plan-planned" className="mt-2 text-[12.5px] leading-4 text-[var(--ph-ink-3)]">
                    {plannedLabel(data)} {rp(totals.plannedMinor)}
                    {totals.boughtActualMinor > 0 && ` · Bought ${rp(totals.boughtActualMinor)}`}
                    {difference && (
                      <>
                        {' · '}
                        <span className={toneClass(HERE[difference.tone])}>{difference.text}</span>
                      </>
                    )}
                  </span>
                </div>
              </InsetGroup>
            </div>

            {/*
              * The checklist, a card per category, read like a day in the Cashflow history: its header says how many
              * of its items are bought and what was paid of what it plans, and its items follow — still to buy first,
              * bought after, greyed — each with how many and at what price.
              */}
            {(data.lines ?? [])
              .filter((line) => line.items.length > 0)
              .map((line) => {
                const paid = line.items.reduce((total, item) => total + (item.actualMinor ?? 0), 0);
                const ordered = [...line.items.filter((item) => !item.bought), ...line.items.filter((item) => item.bought)];
                return (
                  <PlanCategoryCard
                    key={line.categoryId ?? 'none'}
                    categoryId={line.categoryId}
                    name={line.name}
                    itemCount={line.items.length}
                    boughtCount={line.items.filter((item) => item.bought).length}
                    paid={rp(paid)}
                    planned={rp(line.plannedMinor)}
                    accounts={accounts}
                  >
                    {ordered.map((item) => {
                      const words = item.bought ? differenceWords(item.differenceMinor!, ws.baseCurrency) : null;
                      const many = quantityWords(item, ws.baseCurrency);
                      // Paid towards but still open: what was paid against what was planned, and how many payments made it.
                      const partly = !item.bought && item.purchaseCount > 0 ? `of ${rp(item.estimateMinor)} · ${item.purchaseCount} ${item.purchaseCount === 1 ? 'purchase' : 'purchases'}` : null;
                      return (
                        <PlanItemRow
                          key={item.id}
                          eventId={eventId}
                          itemId={item.id}
                          name={item.name}
                          subtitle={[item.bought ? many : null, item.bought ? (words?.text ?? null) : (partly ?? many)].filter(Boolean).join(' · ')}
                          figure={rp(item.actualMinor ?? item.estimateMinor)}
                          state={item.done ? 'done' : item.purchaseCount > 0 ? 'paid' : 'open'}
                          search={search}
                          onBuy={() => void navigate(buyTarget(eventId, item.id, tab))}
                          onDone={(done) => void run(() => setEventItemDone(database, ws, item.id, done))}
                        />
                      );
                    })}
                  </PlanCategoryCard>
                );
              })}
            <InsetGroup>
              <InsetRow title={addLabel} to="/events/$eventId/plan/new" params={{ eventId }} search={search} />
            </InsetGroup>
            <p className="px-[4px] text-[12.5px] leading-4 text-[var(--ph-ink-3)]">
              Tap the circle to buy it, or — once something was paid towards it — to mark it done. More payments are added on its page.
            </p>
          </>
        )
      )}
    </>,
  );
}
