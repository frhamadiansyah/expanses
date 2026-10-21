import { formatMinor } from '@expanses/core';
import { setEventItemDone } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Check, Circle, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, toneClass, type CornerAction, type GroupChild, type Tone } from '../../ui/native';
import { buyTarget } from './buy-item';
import { differenceWords, plannedLabel, planTotals, quantityWords } from './plan-view';
import { useEventItemsReady, useEventPlan, useEvents } from './queries';

/** The kit's tones for what a difference is. The words themselves are `differenceWords`'. */
const HERE: Record<'over' | 'under' | 'exact', Tone> = { over: 'alarm', under: 'tint', exact: 'ink-3' };

/**
 * One thing on the plan, as a checklist line: an empty circle while it is still to buy, a filled tick once done.
 *
 * The row is the way into the item. The circle is a control of its own laid over the row's lead, 44 wide, and what it
 * does follows the item: nothing paid yet, it is Buy it now; paid towards and still open, it marks the item done; done,
 * it puts it back on the list. That makes this the one row on these screens with two targets in it, which `InsetRow`
 * exists to forbid — kept because the tick is what a checklist is for.
 */
function PlanItemRow({
  position,
  eventId,
  itemId,
  name,
  subtitle,
  figure,
  state,
  search,
  onBuy,
  onDone,
}: GroupChild & {
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
    <div className="relative" data-testid="plan-item">
      <InsetRow
        position={position}
        icon={done ? <Check size={15} aria-hidden /> : <Circle size={13} aria-hidden />}
        iconColour={done ? 'var(--ph-tint)' : 'var(--ph-ink-3)'}
        title={<span className={cx(done && 'text-[var(--ph-ink-3)]')}>{name}</span>}
        subtitle={subtitle}
        value={<span className={cx(done ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink-2)]')}>{figure}</span>}
        to="/events/$eventId/plan/$itemId"
        params={{ eventId, itemId }}
        search={search}
      />
      <button
        type="button"
        aria-label={done ? `Reopen ${name}` : state === 'paid' ? `Done buying ${name}` : `Buy ${name}`}
        onClick={() => (state === 'open' ? onBuy() : onDone(!done))}
        className="ph-focus absolute top-1/2 left-[4px] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full"
      />
    </div>
  );
}

/**
 * An event's plan, as a checklist: how many are bought and what is left to buy on top, then every item in one list —
 * still to buy first, bought after it, greyed — with its category as the line under it.
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
  // Every item of every category as one list, each carrying its category's name for the line under it.
  const checklist = (data?.lines ?? []).flatMap((line) => line.items.map((item) => ({ item, category: line.name })));
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

            {/* The checklist: what is still to buy first, what was bought after it, greyed, each with its category. */}
            <InsetGroup>
              {[...checklist.filter((row) => !row.item.bought), ...checklist.filter((row) => row.item.bought)].map(({ item, category }) => {
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
                    subtitle={[category, item.bought ? (words?.text ?? null) : (partly ?? many)].filter(Boolean).join(' · ')}
                    figure={rp(item.actualMinor ?? item.estimateMinor)}
                    state={item.done ? 'done' : item.purchaseCount > 0 ? 'paid' : 'open'}
                    search={search}
                    onBuy={() => void navigate(buyTarget(eventId, item.id, tab))}
                    onDone={(done) => void run(() => setEventItemDone(database, ws, item.id, done))}
                  />
                );
              })}
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
