import { dayMonth, formatMinor } from '@expanses/core';
import { unlinkEventItem } from '@expanses/db';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { Check, ChevronLeft, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Card, cx, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { differenceWords, itemSubline, moneyBackRows, plannedLabel, planTotals } from './plan-view';
import { useEventHistory, useEventItemsReady, useEventPlan, useEvents } from './queries';

/** The dark full-width link that is the one thing to do on an empty plan, and the quiet one at the foot of a full one. */
const WIDE = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium';
const WIDE_DARK = `${WIDE} bg-slate-900 text-white hover:bg-slate-700`;
const WIDE_QUIET = `${WIDE} bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100`;

const TONE = { over: 'text-red-700', under: 'text-emerald-700', exact: 'text-slate-500' } as const;

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-sm font-semibold">{children}</dd>
    </div>
  );
}

/**
 * An event's plan: the things it means to buy, grouped under the categories they are filed in.
 *
 * A category line here is the sum of its items and nothing else — there is no figure to set for a category and no
 * field anywhere on this screen that takes an estimate, because an estimate is how many × price each. Every action
 * is a link or a button on the page rather than a gesture, so the screen is the same one on a desktop and a phone.
 */
export function PlanPage() {
  const { eventId } = useParams({ from: '/events/$eventId/plan' });
  // Which workspace tab the plan was opened from, so it keeps reading in it. `ws` below is the workspace context.
  const { ws: tab } = useSearch({ from: '/events/$eventId/plan' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  const plan = useEventPlan(eventId, tab ?? null);
  const history = useEventHistory(eventId, tab ?? null);
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

  if (events.isSuccess && !event) {
    // Not a bare sentence: a screen whose subject has gone still owes the user a way on from it.
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="Plan" />
        <Link to="/events" className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800">
          <ChevronLeft size={16} aria-hidden />
          All events
        </Link>
        <Empty>That event is no longer here.</Empty>
      </div>
    );
  }

  const data = plan.data;
  const totals = data ? planTotals(data) : null;
  const moneyBack = moneyBackRows(history.data ?? []);
  const search = { ws: tab };
  const addLabel = 'Add an item';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={`Plan · ${event?.name ?? ''}`}
        controls={
          <Link
            to="/events/$eventId/plan/new"
            params={{ eventId }}
            search={search}
            aria-label={addLabel}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70"
          >
            <Plus size={22} aria-hidden />
          </Link>
        }
        action={
          <Link to="/events/$eventId/plan/new" params={{ eventId }} search={search} className={cx(WIDE_DARK, 'w-auto')}>
            {addLabel}
          </Link>
        }
      />
      {/* The tab the plan was opened in goes back with it, or the event would reset to "All" on the way home. */}
      <Link
        to="/events/$eventId"
        params={{ eventId }}
        search={search}
        aria-label="Back to the event"
        className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800"
      >
        <ChevronLeft size={16} aria-hidden />
        Back to the event
      </Link>
      <ErrorBox error={error ?? events.error ?? plan.error} />

      {/*
       * A save on a database from before migration 0049 is a deliberate no-op that still hands back an id, so an
       * item would appear to save and then vanish. Said out loud here, and the form refuses to open below.
       */}
      {ready.isSuccess && !ready.data && (
        <Card className="text-sm text-amber-900 ring-amber-200">
          This copy of your data is from before a plan was a list of things to buy, so nothing can be added to it yet. Open it once on a version that has
          finished updating, and the plan will be here.
        </Card>
      )}

      {data && data.itemCount === 0 ? (
        <div className="space-y-3">
          <Empty>Nothing planned yet. Add the things you mean to buy and roughly what they cost.</Empty>
          <Link to="/events/$eventId/plan/new" params={{ eventId }} search={search} className={WIDE_DARK}>
            <Plus size={16} aria-hidden />
            Add the first item
          </Link>
          {data.spentMinor > 0 && (
            <p className="px-1 text-xs text-slate-500">
              The {formatMinor(data.spentMinor, ws.baseCurrency)} already tagged to this event does not go anywhere. Once there is an item, that spending simply
              reads as “not planned” beside it.
            </p>
          )}
        </div>
      ) : (
        data &&
        totals && (
          <div data-testid="plan-totals">
            <Card>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label={plannedLabel(data)}>
                  <Money minor={totals.plannedMinor} currency={ws.baseCurrency} />
                </Figure>
                <Figure label="Bought so far">
                  <Money minor={totals.boughtActualMinor} currency={ws.baseCurrency} />
                </Figure>
                <Figure label="Still to buy">
                  <Money minor={totals.toBuyMinor} currency={ws.baseCurrency} />
                </Figure>
                {data.boughtCount > 0 && (
                  <Figure label="Difference so far">
                    <span className={TONE[differenceWords(data.differenceMinor, ws.baseCurrency).tone]}>
                      {differenceWords(data.differenceMinor, ws.baseCurrency).text}
                    </span>
                  </Figure>
                )}
              </dl>
              {totals.notPlannedMinor > 0 && (
                <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
                  <span className="text-slate-500">Not planned</span>
                  <Money minor={totals.notPlannedMinor} currency={ws.baseCurrency} className="font-semibold" />
                </p>
              )}
              {/*
               * A refund posted as its own transaction answers no item, so it moves the totals above without
               * appearing in any row below — the plan's leftover rows skip a purchase with nothing left on it, and a
               * refund has less than nothing left. The figure here is the sum of the rows beneath it and nothing
               * else, so the heading can be checked against them; "Not planned" above is the sum of its own rows in
               * the same way, and spending = bought + not planned − money back closes over the two.
               */}
              {totals.moneyBackMinor > 0 && (
                <div className="mt-3 space-y-1 border-t border-slate-100 pt-3" data-testid="plan-money-back">
                  <p className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-500">Money back</span>
                    <Money minor={totals.moneyBackMinor} currency={ws.baseCurrency} className="font-semibold text-emerald-700" />
                  </p>
                  {moneyBack.map((row) => (
                    <p key={row.transactionId} className="flex items-baseline justify-between gap-3 text-xs text-slate-500">
                      <span className="truncate">
                        {row.description} · {dayMonth(row.occurredOn)}
                      </span>
                      <Money minor={row.amountMinor} currency={ws.baseCurrency} />
                    </p>
                  ))}
                  <p className="text-xs text-slate-500">Money that came back and answers no item. It is off what the event spent, and off nothing else.</p>
                  {/* Only when the rows are gone — a voided or retagged refund still leaves the figure to explain. */}
                  {moneyBack.length === 0 && <p className="text-xs text-slate-500">More came back than any item accounts for.</p>}
                </div>
              )}
            </Card>
          </div>
        )
      )}

      {/*
       * Only once something is planned. The empty state above says the money already tagged "reads as 'not planned'
       * beside it once there is an item" — printing those rows anyway put that promise directly above the state it
       * promises, under a category heading reading "Rp 4.200.000 of Rp 0".
       */}
      {(data && data.itemCount > 0 ? data.lines : []).map((line) => (
        <section key={line.categoryId ?? 'none'} className="space-y-2">
          <h2 className="flex items-center gap-2 px-1">
            <CategoryIcon categoryId={line.categoryId} accounts={accounts} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{line.name}</span>
            <span className="shrink-0 text-xs text-slate-500">
              {/* Clamped: a category whose refunds outweigh its purchases still cannot have spent less than nothing. */}
              <Money minor={Math.max(0, line.actualMinor)} currency={ws.baseCurrency} /> of <Money minor={line.plannedMinor} currency={ws.baseCurrency} />
            </span>
          </h2>
          <Card>
            <ul className="divide-y divide-slate-100">
              {line.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2.5" data-testid="plan-item">
                  {/* The tick is its own control, never nested inside the link, so both are reachable by keyboard. */}
                  {item.bought ? (
                    <button
                      type="button"
                      aria-label={`Unlink ${item.name}`}
                      onClick={() => void run(() => unlinkEventItem(database, ws, item.id))}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"
                    >
                      <Check size={13} aria-hidden />
                    </button>
                  ) : (
                    <span className="h-6 w-6 shrink-0 rounded-full border border-slate-200" aria-hidden />
                  )}
                  <Link
                    to="/events/$eventId/plan/$itemId"
                    params={{ eventId, itemId: item.id }}
                    search={search}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-slate-500">{itemSubline(item, ws.baseCurrency)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Money
                        minor={item.actualMinor ?? item.estimateMinor}
                        className={cx('block text-sm font-semibold', !item.bought && 'text-slate-400')}
                        currency={ws.baseCurrency}
                      />
                      <span className={cx('block text-[11.5px] font-semibold', item.bought ? TONE[differenceWords(item.differenceMinor!, ws.baseCurrency).tone] : 'text-slate-400')}>
                        {item.bought ? differenceWords(item.differenceMinor!, ws.baseCurrency).text : 'to buy'}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {line.unplanned.map((row) => (
              <div key={row.transactionId} className="mt-2 flex items-center gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{row.description}</span>
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">not planned</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">{row.partial ? 'part of this receipt' : `bought ${dayMonth(row.occurredOn)}`}</span>
                </span>
                <Money minor={row.amountBaseMinor} currency={ws.baseCurrency} className="shrink-0 text-sm font-semibold" />
              </div>
            ))}
          </Card>
        </section>
      ))}

      {data && data.itemCount > 0 && (
        <div className="space-y-2 pt-1">
          <Link to="/events/$eventId/plan/new" params={{ eventId }} search={search} className={WIDE_QUIET}>
            <Plus size={16} aria-hidden />
            <span>{addLabel}</span>
          </Link>
          <p className="px-1 text-xs text-slate-500">
            A category line is the sum of its items — there is no cap to set. Something tagged to the event with no item sits under its category as “not planned”.
          </p>
        </div>
      )}
    </div>
  );
}
