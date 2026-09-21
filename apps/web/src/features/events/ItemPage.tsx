import { dayMonth, formatMinor } from '@expanses/core';
import { removeEventItem, unlinkEventItem } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { DestructiveRow, Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, toneClass, type CornerAction } from '../../ui/native';
import { buyTarget, coverTarget } from './buy-item';
import { differenceWords } from './plan-view';
import { useEventPlan } from './queries';

/** The kit's tones for the three things a difference can be. The words themselves come from `differenceWords`. */
const HERE: Record<'over' | 'under' | 'exact', 'alarm' | 'tint' | 'ink-3'> = { over: 'alarm', under: 'tint', exact: 'ink-3' };

/**
 * One thing the event means to buy: what it is, what it is expected to cost, and what actually bought it.
 *
 * The item is found in the plan already on screen rather than fetched again — it is the same reading, so the two
 * can never disagree, and a tab that puts the purchase out of scope puts this item back on the list of things to buy
 * here too. A link is a plain anchor opened in a new tab: nothing in this app ever fetches one.
 *
 * Drawn with the native kit: the figure is the hero, the facts are a grouped inset list, and every action is a row
 * of its own rather than a button loose on the page. Removing the item keeps a group to itself, because the air
 * around a destructive row is the only undo a finger gets.
 */
export function ItemPage() {
  const { eventId, itemId } = useParams({ from: '/events/$eventId/plan/$itemId' });
  const { ws: tab } = useSearch({ from: '/events/$eventId/plan/$itemId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const plan = useEventPlan(eventId, tab ?? null);
  const accounts = useAccounts().data ?? [];
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
          <LargeTitle title="Item" {...backToPlan} />
          <Empty>That item is no longer on this plan.</Empty>
        </div>
      </div>
    );
  }

  const difference = item?.bought ? differenceWords(item.differenceMinor!, ws.baseCurrency) : null;
  const boughtElsewhere = item?.bought && item.boughtInCategoryId !== null && item.boughtInCategoryId !== item.categoryId;
  const edit: CornerAction = {
    key: 'edit',
    label: 'Edit',
    glyph: <Pencil size={20} aria-hidden />,
    to: '/events/$eventId/plan/$itemId/edit',
    params: { eventId, itemId },
    search,
  };

  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-2xl">
        <LargeTitle title={item?.name ?? 'Item'} {...backToPlan} actions={[edit]} />
        <ErrorBox error={error ?? plan.error} />

        {item && (
          <>
            <Hero
              minor={item.bought ? item.actualMinor! : item.estimateMinor}
              currency={ws.baseCurrency}
              // An estimate is not money that has moved, so it is not drawn in the colour of money that has.
              direction={item.bought ? 'out' : 'neutral'}
              caption={
                <>
                  <span className="block">
                    {item.bought ? `${item.description} · ${dayMonth(item.occurredOn!)}` : 'estimate'}
                    {boughtElsewhere && ` · bought in ${nameOf(item.boughtInCategoryId)}`}
                    {item.categoryId && !item.bought && ` · ${nameOf(item.categoryId)}`}
                  </span>
                  {difference && <span className={cx('mt-[2px] block font-semibold', toneClass(HERE[difference.tone]))}>{difference.text}</span>}
                </>
              }
            />

            <InsetGroup
              header="The item"
              footer={
                <>
                  <b className="font-semibold">Name</b> is what the thing is. <b className="font-semibold">Note</b> is anything you want to remember about it.{' '}
                  <b className="font-semibold">Estimate</b> is how many × price each, so 6 check-ups × Rp500.000 reads as Rp3.000.000.
                </>
              }
            >
              <ReadOnlyRow label="How many" value={String(item.quantity)} />
              <ReadOnlyRow label="Price each" value={formatMinor(item.unitPriceMinor, ws.baseCurrency)} />
              {/* Derived, never typed: there is no estimate field anywhere in this feature. */}
              <ReadOnlyRow label="Estimate" value={formatMinor(item.estimateMinor, ws.baseCurrency)} />
              <ReadOnlyRow label="Category" value={nameOf(item.categoryId) ?? 'Not in a category'} />
              {/* The one value that is itself a control: an address goes out to the web, which no route can do. */}
              <InsetRow
                title="Link"
                value={
                  item.link ? (
                    <a href={item.link} target="_blank" rel="noreferrer noopener" className="truncate underline" style={{ color: 'var(--ph-tint)' }}>
                      {item.link}
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
              <ReadOnlyRow label="Note" value={item.note || '—'} />
            </InsetGroup>

            {item.bought ? (
              <InsetGroup header="What bought it" footer="The purchase stays on the event; it simply stops answering this item.">
                <InsetRow
                  title={item.description}
                  subtitle={dayMonth(item.occurredOn!)}
                  value={formatMinor(item.actualMinor!, ws.baseCurrency)}
                  valueTone="ink"
                />
                {/* One receipt often answers several items; this is where its shares are set side by side. */}
                {item.purchase && <InsetRow title="Say what it covers" {...coverTarget(eventId, item.purchase.transactionId, { item: item.id, ws: tab })} />}
                <InsetRow title="Remove the link" onClick={() => void run(() => unlinkEventItem(database, ws, item.id))} chevron={false} />
              </InsetGroup>
            ) : (
              <InsetGroup
                header="Already bought it?"
                footer="Buying it records the payment against this item. Linking picks something already tagged to the event, and says what else the same receipt covers."
              >
                {/*
                 * Two ways, and both of them named rows on this page rather than a gesture anywhere.
                 *
                 * "Buy it now" records the payment and ties it to this item in one go, which is the ordinary case of
                 * one receipt for one thing. "Link a purchase" is for a payment already on the event — and since
                 * ticking an item off claims what is *left* of a receipt, a shopping trip that answered three items
                 * goes that way, through the screen where the three shares are typed together.
                 */}
                <InsetRow title="Buy it now" onClick={() => void navigate(buyTarget(eventId, item.id))} chevron />
                <InsetRow title="Link a purchase" to="/events/$eventId/plan/link" params={{ eventId }} search={{ ws: tab, item: item.id }} />
              </InsetGroup>
            )}

            <InsetGroup footer="Removing an item leaves any purchase alone — it becomes “not planned”.">
              <DestructiveRow
                label="Remove this item"
                onClick={() =>
                  void run(async () => {
                    await removeEventItem(database, ws, item.id);
                    await navigate({ to: '/events/$eventId/plan', params: { eventId }, search });
                  })
                }
              />
            </InsetGroup>
          </>
        )}
      </div>
    </div>
  );
}
