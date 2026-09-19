import { dayMonth } from '@expanses/core';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useApp } from '../../app/context';
import { Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { useEventHistory, useEventPlan, useEvents } from './queries';

/** One row of the list: a payment already tagged to this event, and how much of it no item claims yet. */
interface PurchaseRow {
  id: string;
  occurredOn: string;
  description: string;
  paidWith: string | null;
  totalMinor: number;
  leftMinor: number;
}

/**
 * Which payment answered this item: the event's own receipts, newest first, each with what is still unaccounted for.
 *
 * Nothing here writes. It is a chooser, and the write happens on "What it covers", where the shares of one receipt
 * are typed together and checked against it in one go. A receipt whose whole amount is already given to items cannot
 * answer another, so it is shown and said so rather than hidden: a list that quietly drops a receipt someone
 * remembers paying is a list they will not trust.
 */
export function PickPurchasePage() {
  const { eventId } = useParams({ from: '/events/$eventId/plan/link' });
  // `ws` is the workspace tab the plan is being read in; `ws` from useApp below is the workspace context.
  const { ws: tab, item } = useSearch({ from: '/events/$eventId/plan/link' });
  const { ws } = useApp();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  /*
   * The whole plan, whatever tab the event is being read in.
   *
   * A plan belongs to the owner: `eventPlanFor` under a workspace drops the items filed in *another* workspace's
   * categories altogether, so a receipt already spoken for by one of them looked free here — offered, and then
   * refused by a write that does not narrow. What is left of a payment is a fact about the payment, exactly as
   * `usePurchaseCover` says, so it is read owner-wide and the tab is kept only for the journey back.
   */
  const plan = useEventPlan(eventId, null);
  const history = useEventHistory(eventId, tab ?? null);

  if (events.isSuccess && !event) return <Empty>That event is no longer here.</Empty>;

  const items = (plan.data?.lines ?? []).flatMap((line) => line.items);
  const named = items.find((row) => row.id === item) ?? null;
  const search = { ws: tab, item };

  /*
   * What each receipt has already given away, read off the plan already on screen rather than by a query per row.
   * The share is taken from `item.purchase` and not from `item.actualMinor`: a share given by an item whose purchase
   * sits outside the open workspace tab is still a share of this receipt, and reading the scoped figure would report
   * a receipt as free when the write would refuse it.
   */
  const givenTo = new Map<string, number>();
  for (const row of items) {
    if (row.purchase) givenTo.set(row.purchase.transactionId, (givenTo.get(row.purchase.transactionId) ?? 0) + row.purchase.shareMinor);
  }

  const rows: PurchaseRow[] = (history.data ?? []).map((tx) => {
    // Net, and never below nought: a receipt carrying a refund line spends less than its largest entry, and one that
    // gave money back on balance has nothing to answer with at all.
    const totalMinor = Math.max(
      0,
      tx.entries.filter((entry) => entry.accountKind === 'expense').reduce((total, entry) => total + entry.amountBaseMinor, 0),
    );
    return {
      id: tx.id,
      occurredOn: tx.occurredOn,
      description: tx.description,
      paidWith: tx.entries.find((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability')?.accountName ?? null,
      totalMinor,
      leftMinor: Math.max(0, totalMinor - (givenTo.get(tx.id) ?? 0)),
    };
  });
  const open = rows.filter((row) => row.leftMinor > 0);

  const backTo = named
    ? ({ to: '/events/$eventId/plan/$itemId', params: { eventId, itemId: named.id }, search: { ws: tab } } as const)
    : ({ to: '/events/$eventId/plan', params: { eventId }, search: { ws: tab } } as const);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Link a purchase" />
      <Link {...backTo} aria-label={named ? 'Back to the item' : 'Back to the plan'} className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800">
        <ChevronLeft size={16} aria-hidden />
        {named ? 'Back to the item' : 'Back to the plan'}
      </Link>
      <ErrorBox error={events.error ?? plan.error ?? history.error} />

      <p className="px-1 text-sm text-slate-500">
        {named ? (
          <>
            Which payment bought <b className="font-semibold text-slate-700">{named.name}</b>? The next screen says what else the same receipt covers.
          </>
        ) : (
          <>Which payment answered something on this plan? The next screen says what it covers.</>
        )}
      </p>

      {rows.length === 0 ? (
        <Empty>Nothing tagged to this event still has anything unaccounted for. Tag a payment first, or use Buy it now.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.description}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {dayMonth(row.occurredOn)}
                      {row.paidWith && ` · ${row.paidWith}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Money minor={row.totalMinor} currency={ws.baseCurrency} className="block text-sm font-semibold" />
                    <span className="block text-[11.5px] text-slate-500">
                      {row.leftMinor > 0 ? (
                        <>
                          <Money minor={row.leftMinor} currency={ws.baseCurrency} /> left
                        </>
                      ) : (
                        'fully accounted for'
                      )}
                    </span>
                  </span>
                </>
              );
              return row.leftMinor > 0 ? (
                <li key={row.id}>
                  <Link to="/events/$eventId/plan/link/$transactionId" params={{ eventId, transactionId: row.id }} search={search} className="flex items-center gap-3 py-2.5">
                    {body}
                  </Link>
                </li>
              ) : (
                <li key={row.id} className="flex items-center gap-3 py-2.5 opacity-50" aria-disabled>
                  {body}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {rows.length > 0 && open.length === 0 && (
        <p className="px-1 text-xs text-slate-500">
          Nothing tagged to this event still has anything unaccounted for. Tag a payment first, or use Buy it now.
        </p>
      )}
      <p className="px-1 text-xs text-slate-500">
        Only payments already tagged to this event are here. The receipt itself is never split — saying what it covers
        is a reading of it, and your statement and points are untouched.
      </p>
    </div>
  );
}
