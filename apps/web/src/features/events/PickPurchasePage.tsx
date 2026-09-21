import { dayMonth, formatMinor } from '@expanses/core';
import { useParams, useSearch } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle } from '../../ui/native';
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
 *
 * Drawn with the native kit: one grouped inset list with its header outside it. What the receipt was is the row's
 * figure, and what is left of it the line under that figure — the same shape the plan's own rows use for the
 * difference, so the two lists read alike.
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

  /** The second line of a row: when it was paid, and what paid it. */
  const subline = (row: PurchaseRow) => [dayMonth(row.occurredOn), row.paidWith].filter(Boolean).join(' · ');

  /**
   * The figure, and under it what is still unspoken for.
   *
   * What the receipt was comes first, because that is what the row is for; what is left of it is the second line,
   * where the plan's own rows put the difference. A receipt entirely given away says so in words instead.
   */
  const figure = (row: PurchaseRow) => (
    <span className="block text-right">
      <span className="block">{formatMinor(row.totalMinor, ws.baseCurrency)}</span>
      <span className="block text-[11.5px] leading-[14px] font-semibold text-[var(--ph-ink-3)]">
        {row.leftMinor > 0 ? `${formatMinor(row.leftMinor, ws.baseCurrency)} left` : 'fully accounted for'}
      </span>
    </span>
  );

  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">
        <LargeTitle
          title="Link a purchase"
          back={named ? 'Back to the item' : 'Back to the plan'}
          backTo={backTo.to}
          backParams={backTo.params}
          backSearch={backTo.search}
        />
        <ErrorBox error={events.error ?? plan.error ?? history.error} />

        <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">
          {named ? (
            <>
              Which payment bought <b className="font-semibold text-[var(--ph-ink)]">{named.name}</b>? The next screen says what else the same receipt covers.
            </>
          ) : (
            <>Which payment answered something on this plan? The next screen says what it covers.</>
          )}
        </p>

        {rows.length === 0 ? (
          <Empty>Nothing tagged to this event still has anything unaccounted for. Tag a payment first, or use Buy it now.</Empty>
        ) : (
          <InsetGroup
            header="Tagged to this event"
            footer={
              open.length === 0
                ? 'Nothing tagged to this event still has anything unaccounted for. Tag a payment first, or use Buy it now.'
                : undefined
            }
          >
            {rows.map((row) =>
              row.leftMinor > 0 ? (
                <InsetRow
                  key={row.id}
                  title={row.description}
                  subtitle={subline(row)}
                  value={figure(row)}
                  valueTone="ink"
                  to="/events/$eventId/plan/link/$transactionId"
                  params={{ eventId, transactionId: row.id }}
                  search={search}
                />
              ) : (
                // Shown and said so, never hidden — and pointing nowhere, because it has nothing left to answer with.
                <InsetRow key={row.id} title={row.description} subtitle={subline(row)} value={figure(row)} />
              ),
            )}
          </InsetGroup>
        )}

        <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Only payments already tagged to this event are here. The receipt itself is never split — saying what it covers is a reading of it, and your statement
          and points are untouched.
        </p>
      </div>
    </div>
  );
}
