import { dayMonth, formatMinor } from '@expanses/core';
import { removeEventItem, setEventItemDone, unlinkEventItem } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { DestructiveRow, Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, toneClass, type CornerAction } from '../../ui/native';
import { buyTarget, coverTarget } from './buy-item';
import { differenceWords } from './plan-view';
import { useEventHistory, useEventPlan } from './queries';

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
  // Each payment's shop and day, read off the event's own history: the plan names only the latest.
  const history = useEventHistory(eventId, tab ?? null);
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
    glyph: <Pencil size={18} aria-hidden />,
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
              minor={item.bought || item.purchaseCount > 0 ? (item.actualMinor ?? 0) : item.estimateMinor}
              currency={ws.baseCurrency}
              // An estimate is not money that has moved, so it is not drawn in the colour of money that has.
              direction={item.bought || item.purchaseCount > 0 ? 'out' : 'neutral'}
              caption={
                <>
                  <span className="block">
                    {item.bought
                      ? item.purchaseCount === 0
                        ? 'done, nothing paid'
                        : item.purchaseCount === 1
                          ? `${item.description} · ${dayMonth(item.occurredOn!)}`
                          : `${item.purchaseCount} purchases`
                      : item.purchaseCount > 0
                        ? `paid so far, of ${formatMinor(item.estimateMinor, ws.baseCurrency)}`
                        : 'estimate'}
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
                  <b className="font-semibold">Name</b> is what the thing is. <b className="font-semibold">Note</b> is anything to remember about it.{' '}
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

            {item.purchases.length > 0 && (
              <InsetGroup
                header="What bought it"
                footer={
                  item.purchases.length === 1
                    ? 'The purchase stays on the event; it simply stops answering this item.'
                    : 'Tap a payment to say what else it covers, or to take it off this item. The payments stay on the event.'
                }
              >
                {item.purchases.map((purchase) => {
                  const tx = (history.data ?? []).find((row) => row.id === purchase.transactionId);
                  return (
                    <InsetRow
                      key={purchase.transactionId}
                      testId="item-payment"
                      title={tx?.description || 'Another payment'}
                      subtitle={tx ? dayMonth(tx.occurredOn) : 'not in this view'}
                      value={formatMinor(purchase.shareMinor, ws.baseCurrency)}
                      valueTone="ink"
                      {...(item.purchases.length > 1 ? coverTarget(eventId, purchase.transactionId, { item: item.id, ws: tab }) : {})}
                    />
                  );
                })}
                {/* One receipt often answers several items; this is where its shares are set side by side. */}
                {item.purchases.length === 1 && <InsetRow title="Say what it covers" {...coverTarget(eventId, item.purchases[0]!.transactionId, { item: item.id, ws: tab })} />}
                <InsetRow
                  title={item.purchases.length === 1 ? 'Remove the link' : 'Remove every payment'}
                  // Every payment off puts the item back on the list: nothing is left to say it was bought.
                  onClick={() =>
                    void run(async () => {
                      await unlinkEventItem(database, ws, item.id);
                      await setEventItemDone(database, ws, item.id, false);
                    })
                  }
                  chevron={false}
                />
              </InsetGroup>
            )}

            {!item.bought && (
              <InsetGroup
                header={item.purchases.length > 0 ? 'Bought more of it?' : 'Already bought it?'}
                footer="Buying it records the payment against this item. Linking picks something already tagged to the event, and says what else the same receipt covers. An item can be paid for more than once."
              >
                {/*
                 * Two ways, and both of them named rows on this page rather than a gesture anywhere.
                 *
                 * "Buy it now" records the payment and ties it to this item in one go. "Link a purchase" is for a
                 * payment already on the event — a shopping trip that answered three items goes that way, through the
                 * screen where the three shares are typed together. Either adds to what the item already holds.
                 */}
                <InsetRow title="Buy it now" onClick={() => void navigate(buyTarget(eventId, item.id, tab))} chevron />
                <InsetRow
                  title={item.purchases.length > 0 ? 'Link another purchase' : 'Link a purchase'}
                  to="/events/$eventId/plan/link"
                  params={{ eventId }}
                  search={{ ws: tab, item: item.id }}
                />
              </InsetGroup>
            )}

            {/* Done is its own mark: an item paid for in parts stays on the list until nothing more is to be bought. */}
            {/* The mark itself, not the reading: done on payments another tab holds still reads Reopen here. */}
            <InsetGroup footer={item.done ? undefined : 'Done when nothing more is to be bought for it; until then it stays on the list.'}>
              <InsetRow
                title={item.done ? 'Reopen' : 'Done buying'}
                onClick={() => void run(() => setEventItemDone(database, ws, item.id, !item.done))}
                chevron={false}
              />
            </InsetGroup>

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
