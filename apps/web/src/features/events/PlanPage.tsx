import { dayMonth, formatMinor } from '@expanses/core';
import { unlinkEventItem } from '@expanses/db';
import { useParams, useSearch } from '@tanstack/react-router';
import { Check, Circle, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, toneClass, type CornerAction, type GroupChild, type InsetRowProps, type Tone } from '../../ui/native';
import { differenceWords, itemSubline, moneyBackRows, moneyBackUnder, plannedLabel, planTotals } from './plan-view';
import { useEventHistory, useEventItemsReady, useEventPlan, useEvents } from './queries';

/** The kit's tones for what a difference is. The words themselves are `differenceWords`'. */
const HERE: Record<'over' | 'under' | 'exact', Tone> = { over: 'alarm', under: 'tint', exact: 'ink-3' };

/**
 * One thing on the plan, bought or not.
 *
 * Bought and still-to-buy are **one list**, told apart by the circle at the head of the row — a filled tick or an
 * empty ring — rather than by a dashed border around one of them. The row itself is the way into the item, and the
 * tick is a control of its own laid over the circle: ticking it undoes the purchase, which is an action, and an
 * action a finger can reach may not be smaller than the 44 every other control here is.
 *
 * That leaves this the one row on these screens with two targets in it, which `InsetRow` exists to forbid. Taking
 * either away would lose something — the way into the item, or the only undo the plan offers — so both are kept and
 * the kit is used for everything but the overlay.
 */
function PlanItemRow({
  position,
  eventId,
  itemId,
  name,
  subtitle,
  figure,
  figureTone,
  note,
  noteTone,
  bought,
  search,
  onUnlink,
}: GroupChild & {
  eventId: string;
  itemId: string;
  name: string;
  subtitle: string;
  figure: string;
  figureTone: Tone;
  note: string;
  noteTone: Tone;
  bought: boolean;
  search: { ws: string | undefined };
  onUnlink: () => void;
}) {
  return (
    <div className="relative" data-testid="plan-item">
      <InsetRow
        position={position}
        icon={bought ? <Check size={15} aria-hidden /> : <Circle size={13} aria-hidden />}
        iconColour={bought ? 'var(--ph-tint)' : 'var(--ph-ink-3)'}
        title={name}
        subtitle={subtitle}
        value={
          <span className="block text-right">
            <span className={cx('block', toneClass(figureTone))}>{figure}</span>
            <span className={cx('block text-[11.5px] leading-[14px] font-semibold', toneClass(noteTone))}>{note}</span>
          </span>
        }
        to="/events/$eventId/plan/$itemId"
        params={{ eventId, itemId }}
        search={search}
      />
      {bought && (
        // Laid over the circle rather than inside the row: the tick is the plan's own undo, and it keeps its 44.
        <button
          type="button"
          aria-label={`Unlink ${name}`}
          onClick={onUnlink}
          className="ph-focus absolute top-1/2 left-[4px] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full"
        />
      )}
    </div>
  );
}

/**
 * A payment on the event that no item claims.
 *
 * Its own headed group, and a row like any other in it. The wrapper is there so each of these can be counted and
 * pointed at — the amber pill that used to say this was a decoration, and a decoration cannot be counted.
 */
function UnplannedRow({ position, ...row }: GroupChild & InsetRowProps) {
  return (
    <div data-testid="plan-unplanned">
      <InsetRow {...row} position={position} />
    </div>
  );
}

/**
 * An event's plan: the things it means to buy, grouped under the categories they are filed in.
 *
 * A category line here is the sum of its items and nothing else — there is no figure to set for a category and no
 * field anywhere on this screen that takes an estimate, because an estimate is how many × price each. Every action
 * is a link or a button on the page rather than a gesture, so the screen is the same one on a desktop and a phone.
 *
 * Drawn with the native kit. Two things the old screen said with decoration are now said with structure: bought and
 * not-yet-bought are one list under the category's own header, told apart by the circle at the head of each row; and
 * spending nobody planned is a headed group of its own rather than a dashed box with an amber pill in it.
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
  const moneyBack = moneyBackRows(history.data ?? []);
  const shortfall = totals ? moneyBackUnder(totals.moneyBackMinor, moneyBack, ws.baseCurrency) : null;
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
          This copy of your data is from before a plan was a list of things to buy, so nothing can be added to it yet. Open it once on a version that has
          finished updating, and the plan will be here.
        </p>
      )}

      {data && data.itemCount === 0 ? (
        <>
          <Empty>Nothing planned yet. Add the things you mean to buy and roughly what they cost.</Empty>
          <InsetGroup>
            <InsetRow title="Add the first item" to="/events/$eventId/plan/new" params={{ eventId }} search={search} />
          </InsetGroup>
          {data.spentMinor > 0 && (
            <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              The {rp(data.spentMinor)} already tagged to this event does not go anywhere. Once there is an item, that spending simply reads as “not planned”
              beside it.
            </p>
          )}
        </>
      ) : (
        data &&
        totals && (
          <div data-testid="plan-totals">
            <InsetGroup header="The plan so far">
              <InsetRow title={plannedLabel(data)} value={rp(totals.plannedMinor)} valueTone="ink" />
              <InsetRow title="Bought so far" value={rp(totals.boughtActualMinor)} valueTone="ink" />
              <InsetRow title="Still to buy" value={rp(totals.toBuyMinor)} valueTone="ink" />
              {difference && <InsetRow title="Difference so far" value={difference.text} valueTone={HERE[difference.tone]} />}
            </InsetGroup>
          </div>
        )
      )}

      {totals && totals.notPlannedMinor > 0 && (
        <div data-testid="plan-not-planned">
          <InsetGroup header="Beyond the plan">
            <InsetRow title="Not planned" value={rp(totals.notPlannedMinor)} valueTone="ink" />
          </InsetGroup>
        </div>
      )}

      {/*
       * A refund posted as its own transaction answers no item, so it moves the totals above without appearing in any
       * row below — the plan's leftover rows skip a purchase with nothing left on it, and a refund has less than
       * nothing left. The figure on the header is the sum of the rows beneath it and nothing else, so the heading can
       * be checked against them; "Not planned" above is the sum of its own rows in the same way, and
       * spending = bought + not planned − money back closes over the two.
       */}
      {totals && totals.moneyBackMinor > 0 && (
        <div data-testid="plan-money-back">
          <InsetGroup
            header="Money back"
            trailing={rp(totals.moneyBackMinor)}
            footer={
              <>
                Money that came back and answers no item. It is off what the event spent, and off nothing else.
                {/*
                 * The heading and these rows are two different readings — the heading narrowed by the category an
                 * entry is filed in, the rows by the workspace a transaction is filed in and cut off at the list's
                 * own limit — so whenever they do not come to the same figure the difference is named. Saying it
                 * only when the rows were *entirely* gone left the commoner case, a short list, silently wrong.
                 */}
                {shortfall && <span className="mt-[4px] block">{shortfall}</span>}
              </>
            }
          >
            {moneyBack.map((row) => (
              <InsetRow key={row.transactionId} title={row.description} subtitle={dayMonth(row.occurredOn)} value={rp(row.amountMinor)} valueTone="tint" />
            ))}
          </InsetGroup>
        </div>
      )}

      {/*
       * Only once something is planned. The empty state above says the money already tagged "reads as 'not planned'
       * beside it once there is an item" — printing those rows anyway put that promise directly above the state it
       * promises, under a category heading reading "Rp 4.200.000 of Rp 0".
       */}
      {(data && data.itemCount > 0 ? data.lines : []).map((line) => (
        <div key={line.categoryId ?? 'none'}>
          <InsetGroup
            header={line.name}
            /* Clamped: a category whose refunds outweigh its purchases still cannot have spent less than nothing. */
            trailing={`${rp(Math.max(0, line.actualMinor))} of ${rp(line.plannedMinor)}`}
          >
            {line.items.map((item) => {
              const difference = item.bought ? differenceWords(item.differenceMinor!, ws.baseCurrency) : null;
              return (
                <PlanItemRow
                  key={item.id}
                  eventId={eventId}
                  itemId={item.id}
                  name={item.name}
                  subtitle={itemSubline(item, ws.baseCurrency)}
                  figure={rp(item.actualMinor ?? item.estimateMinor)}
                  figureTone={item.bought ? 'ink' : 'ink-3'}
                  note={difference ? difference.text : 'to buy'}
                  noteTone={difference ? HERE[difference.tone] : 'ink-3'}
                  bought={item.bought}
                  search={search}
                  onUnlink={() => void run(() => unlinkEventItem(database, ws, item.id))}
                />
              );
            })}
          </InsetGroup>

          {/* Spending nobody planned is a group of its own, headed by what it is, rather than a dashed box inside
              the plan's own list with an amber pill on it. */}
          {line.unplanned.length > 0 && (
            <InsetGroup header={`Not planned · ${line.name}`}>
              {line.unplanned.map((row) => (
                <UnplannedRow
                  key={row.transactionId}
                  title={row.description}
                  subtitle={row.partial ? 'part of this receipt' : `bought ${dayMonth(row.occurredOn)}`}
                  value={rp(row.amountBaseMinor)}
                  valueTone="warn"
                />
              ))}
            </InsetGroup>
          )}
        </div>
      ))}

      {data && data.itemCount > 0 && (
        <InsetGroup footer="A category line is the sum of its items — there is no cap to set. Something tagged to the event with no item sits under its category as “not planned”.">
          <InsetRow title={addLabel} subtitle="plan another thing, in any category" to="/events/$eventId/plan/new" params={{ eventId }} search={search} />
        </InsetGroup>
      )}
    </>,
  );
}
