import { dayMonth, eventCurrency, formatMinor } from '@expanses/core';
import { setEventItemDone, unlinkEventItem } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { GROUP_RADIUS, InsetGroup, InsetRow, ReadOnlyRow, SwitchRow, type CornerAction, PushedTitle } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { buyTarget, coverTarget } from './buy-item';
import { itemFigure } from './plan-view';
import { useEventHistory, useEventPlan, useEvents, usePlanConverter } from './queries';

/** One column of the price strip: a small grey label over the figure, both from the column's left edge. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 border-l-[0.5px] border-[var(--ph-hair)] px-[14px] py-3 first:border-l-0">
      <span className="block text-[12px] leading-[16px] text-[var(--ph-ink-3)]">{label}</span>
      <span className="tabular mt-[3px] block truncate text-[16px] leading-[20px] font-semibold text-[var(--ph-ink)]">{value}</span>
    </div>
  );
}

/**
 * One cost the event means to pay: what it is, what it is expected to come to, and what actually paid it. A cost is
 * a thing or a service — a ticket, an MC, an organiser.
 *
 * The cost is found in the plan already on screen rather than fetched again — it is the same reading, so the two
 * can never disagree, and a tab that puts a payment out of scope puts this cost back on the list of things to pay
 * here too. A link is a plain anchor opened in a new tab: nothing in this app ever fetches one.
 *
 * Drawn with the native kit, top to bottom: an identity block (the category's mark, the name, one grey line saying
 * whether it is paid and in which category), the price strip, Details (link and remarks, only those that exist), the
 * Paid group (only once something is), the two ways to pay, and the Settled switch (only once something is paid).
 * No sentence explains any of it, and there is no way to delete here: that row lives at the foot of the edit form.
 */
export function ItemPage() {
  const { eventId, itemId } = useParams({ from: '/events/$eventId/plan/$itemId' });
  const { ws: tab } = useSearch({ from: '/events/$eventId/plan/$itemId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const plan = useEventPlan(eventId, tab ?? null);
  const events = useEvents();
  const home = eventCurrency((events.data ?? []).find((row) => row.id === eventId)?.currency, ws.baseCurrency);
  // Each payment's shop and day, read off the event's own history: the plan names only the latest.
  const history = useEventHistory(eventId, tab ?? null);
  const accounts = useAccounts().data ?? [];
  // A payment's share is held in the base currency; an event in another currency reads it at that day's rate.
  const converter = usePlanConverter(home === ws.baseCurrency ? [] : [ws.baseCurrency, home]).data;
  const [error, setError] = useState<unknown>(null);

  const item = (plan.data?.lines ?? []).flatMap((line) => line.items).find((row) => row.id === itemId) ?? null;
  const search = { ws: tab };
  const nameOf = (id: string | null) => (id === null ? null : (accounts.find((account) => account.id === id)?.name ?? id));

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const backToPlan = { back: 'Back to the plan', backTo: '/events/$eventId/plan', backParams: { eventId }, backSearch: search } as const;

  if (plan.isSuccess && !item) {
    return (
      <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
        <div className="mx-auto max-w-2xl">
          <PushedTitle title="Cost" {...backToPlan} />
          <Empty>That cost is no longer on this plan.</Empty>
        </div>
      </div>
    );
  }

  const edit: CornerAction = {
    key: 'edit',
    label: 'Edit',
    glyph: <Pencil size={18} aria-hidden />,
    to: '/events/$eventId/plan/$itemId/edit',
    params: { eventId, itemId },
    search,
  };

  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">
        {/* No title in the bar: the name is the identity block's. */}
        <PushedTitle title="" {...backToPlan} actions={[edit]} />
        <ErrorBox error={error ?? plan.error} />

        {renderItem()}
      </div>
    </div>
  );

  function renderItem() {
    if (!item) return null;
    const own = item.currency ?? ws.baseCurrency;
    const category = nameOf(item.categoryId);
    // The total in the event's currency, with ≈ when the cost is priced in another; the cost's own figure with no rate.
    const rated = !item.noRate && item.estimateEventMinor !== null;
    const total = rated ? `${own !== home ? '≈ ' : ''}${formatMinor(item.estimateEventMinor!, home)}` : formatMinor(item.estimateOwnMinor, own);
    const totalPlain = rated ? formatMinor(item.estimateEventMinor!, home) : formatMinor(item.estimateOwnMinor, own);
    const paid = item.purchases.length > 0;
    const status = item.done ? 'Settled' : item.purchaseCount > 0 ? `${itemFigure(item, home, ws.baseCurrency)} of ${totalPlain} paid` : 'Unpaid';
    const shown = (minor: number, on: string | undefined) => {
      if (home === ws.baseCurrency) return formatMinor(minor, ws.baseCurrency);
      const there = on ? converter?.convert(minor, ws.baseCurrency, home, on) : null;
      return there === null || there === undefined ? formatMinor(minor, ws.baseCurrency) : formatMinor(there, home);
    };
    return (
      <>
        <section
          className="mb-3 flex flex-col items-center bg-[var(--ph-surface)] px-[14px] pt-4 pb-[14px] text-center"
          style={{ borderRadius: GROUP_RADIUS }}
          data-testid="item-identity"
        >
          <CategoryIcon categoryId={item.categoryId} accounts={accounts} size="tile" />
          <h2 className="mt-2 max-w-full break-words text-[20px] leading-[26px] font-bold text-[var(--ph-ink)]">{item.name}</h2>
          <p data-testid="item-status" className="mt-1 text-[14px] leading-[18px] text-[var(--ph-ink-3)]">
            {[status, category].filter(Boolean).join(' · ')}
          </p>
        </section>

        <div className="mb-3 flex bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }} data-testid="item-figures">
          <Figure label="Price each" value={formatMinor(item.unitPriceMinor, own)} />
          <Figure label="How many" value={String(item.quantity)} />
          <Figure label="Total" value={total} />
        </div>

        {(item.link || item.note) && (
          <InsetGroup header="Details">
            {/* The one value that is itself a control: an address goes out to the web, which no route can do. */}
            {item.link ? (
              <InsetRow
                title="Purchase link"
                plain
                value={
                  <a href={item.link} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-[55vw] items-center md:max-w-[26rem]">
                    <span className="truncate">{item.link}</span>
                    <span aria-hidden className="ml-1 shrink-0">↗</span>
                  </a>
                }
              />
            ) : null}
            {item.note ? <ReadOnlyRow label="Remarks" value={item.note} /> : null}
          </InsetGroup>
        )}

        {paid && (
          <InsetGroup header="Paid">
            {item.purchases.map((purchase) => {
              const tx = (history.data ?? []).find((row) => row.id === purchase.transactionId);
              return (
                <InsetRow
                  key={purchase.transactionId}
                  testId="item-payment"
                  plain
                  title={tx ? `${dayMonth(tx.occurredOn)} · ${tx.description || 'Another payment'}` : 'Another payment'}
                  value={shown(purchase.shareMinor, tx?.occurredOn)}
                  valueTone="ink"
                  // One receipt often answers several costs; a tap on its payment is where its shares are set side by side.
                  chevron
                  {...coverTarget(eventId, purchase.transactionId, { item: item.id, ws: tab })}
                />
              );
            })}
            <InsetRow
              title={item.purchases.length === 1 ? 'Unlink payment' : 'Unlink every payment'}
              // Every payment off puts the cost back on the list: nothing is left to say it was paid.
              onClick={() =>
                void run(async () => {
                  await unlinkEventItem(database, ws, item.id);
                  await setEventItemDone(database, ws, item.id, false);
                })
              }
              action
            />
          </InsetGroup>
        )}

        {!item.bought && (
          <InsetGroup>
            {/*
             * Two ways, both of them named rows on this page rather than a gesture anywhere.
             *
             * "Pay now" records the payment and ties it to this cost in one go. "Link a payment" is for one already
             * on the event — a shopping trip that answered three costs goes that way, through the screen where the
             * three shares are typed together. Either adds to what the cost already holds.
             */}
            <InsetRow title={paid ? 'Add payment' : 'Pay now'} onClick={() => void navigate(buyTarget(eventId, item.id, tab))} action />
            <InsetRow title="Link a payment" to="/events/$eventId/plan/link" params={{ eventId }} search={{ ws: tab, item: item.id }} action />
          </InsetGroup>
        )}

        {/* The mark itself, not the reading: settled on payments another tab holds still reads as on here. */}
        {(paid || item.done) && (
          <InsetGroup>
            <SwitchRow label="Settled" checked={item.done} onChange={(on) => void run(() => setEventItemDone(database, ws, item.id, on))} testId="item-settled" />
          </InsetGroup>
        )}
      </>
    );
  }
}
