import { eventCurrency, formatMinor } from '@expanses/core';
import { setEventItemDone, type AccountRow } from '@expanses/db';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Check, Plus } from 'lucide-react';
import { type ComponentProps, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, type CornerAction, PushedTitle } from '../../ui/native';
import { GROUP_RADIUS } from '../../ui/native/metrics';
import { CategoryIcon } from '../categories/CategoryIcon';
import { buyTarget } from './buy-item';
import { estimateLabel, itemFigure, itemPaidAgainst, itemSubtitle, planDonePercent, planInEvent, planStatus } from './plan-view';
import { useEventItemsReady, useEventPlan, useEvents } from './queries';


/**
 * One thing on the plan, as a checklist line in the Cashflow history's size: an empty circle while it is still to
 * buy, a tick once done, then the name and the figure.
 *
 * Two targets side by side, never one inside the other: the circle is a button, 44 wide, and what it does follows the
 * item — nothing paid yet, it is Buy it now; paid towards and still open, it marks the item done; done, it puts it back
 * on the list. The rest of the row is the link into the item.
 *
 * A paid cost stays in ink; only its circle turns green. Its figure is what was paid, with the estimate under it in the
 * quiet ink ("of Rp 330.000") and, only when the two differ, an arrow before the figure: green down for a saving, red up
 * for an overrun. A cost still to pay has the one line.
 *
 * The circle is the category mark's 28 px and starts at its left edge (14 px: the 44 px target reaches 8 px either side of
 * it), and the name starts where the category's does, so the two read as one column.
 */
function PlanItemRow({
  eventId,
  itemId,
  name,
  subtitle,
  figure,
  against,
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
  /** The estimate a paid cost is read against, and whether it came in under or over it; null for a cost not yet paid. */
  against: { of: string; arrow: 'under' | 'over' | null } | null;
  /** Nothing paid yet, paid towards and still open, or done. */
  state: 'open' | 'paid' | 'done';
  search: { ws: string | undefined };
  onBuy: () => void;
  onDone: (done: boolean) => void;
}) {
  const done = state === 'done';
  return (
    <div className="flex items-center pl-[6px]" data-testid="plan-item">
      <button
        type="button"
        aria-label={done ? `Reopen ${name}` : state === 'paid' ? `Settle ${name}` : `Pay ${name}`}
        onClick={() => (state === 'open' ? onBuy() : onDone(!done))}
        className="ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
      >
        <span
          aria-hidden
          className={cx(
            'flex h-7 w-7 items-center justify-center rounded-full',
            done ? 'bg-[var(--ph-up-panel)] text-[var(--ph-up)]' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset',
          )}
        >
          {done && <Check size={15} strokeWidth={3} />}
        </span>
      </button>
      <Link
        to="/events/$eventId/plan/$itemId"
        params={{ eventId, itemId }}
        search={search}
        className="ph-focus-inset flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pr-[14px] pl-1"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--ph-ink)]">{name}</span>
          {subtitle && <span className="block truncate text-xs text-[var(--ph-ink-3)]">{subtitle}</span>}
        </span>
        <span className="tabular shrink-0 text-right text-sm font-semibold whitespace-nowrap text-[var(--ph-ink)]">
          {against?.arrow && (
            <span
              role="img"
              aria-label={against.arrow === 'under' ? 'Under the estimate' : 'Over the estimate'}
              className={cx('mr-[5px] text-[10px]', against.arrow === 'under' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-alarm)]')}
            >
              <span aria-hidden>{against.arrow === 'under' ? '▼' : '▲'}</span>
            </span>
          )}
          {figure}
          {against && <span className="block text-[11.5px] leading-[14px] font-normal text-[var(--ph-ink-3)]">{against.of}</span>}
        </span>
      </Link>
    </div>
  );
}

const hereStatus = (status: ReturnType<typeof planStatus>, rp: (minor: number) => string) => ({ kind: status.kind, amount: rp(status.amountMinor) });

/**
 * The plan's top card: a ring of how much is paid with the count under its percentage, beside a status line (what the
 * paid costs saved or went over), what is left to pay, and the estimate against the actual.
 *
 * The ring is exactly as tall as the text beside it, so the text is measured and the SVG sized to it (a ring of its own
 * size beside text of another would leave one of them floating). The ring is drawn on a 100 unit square and scaled, so
 * its stroke and its words grow with it; the count never renders under 8px. The status line is always there, so the
 * height holds from one state to the next. Nothing in the text wraps: the figures are small enough to share the row.
 * When the event's currency is not the base, each of the three figures has its base equivalent under it.
 */
export function PlanHeroBody({
  percent,
  count,
  status,
  toPay,
  toPayBase,
  estimateWord,
  estimate,
  estimateBase,
  actual,
  actualBase,
}: {
  percent: number;
  count: string;
  status: { kind: 'none' | 'partly' | 'saved' | 'over' | 'exact'; amount: string };
  toPay: string;
  toPayBase: string | null;
  estimateWord: string;
  estimate: string;
  estimateBase: string | null;
  actual: string;
  actualBase: string | null;
}) {
  const block = useRef<HTMLDivElement>(null);
  // Before it is measured, and where nothing can be: about the height the text comes to.
  const [size, setSize] = useState(100);
  // Every render, so a change of text or of font size is read at once; the observer catches what a render does not
  // (a font loading late, the card narrowing). The state only moves when the height does.
  useLayoutEffect(() => {
    const el = block.current;
    if (!el) return;
    const measure = () => {
      const height = el.getBoundingClientRect().height;
      setSize((was) => (Math.abs(was - height) < 0.01 ? was : height));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });
  const circumference = 2 * Math.PI * 45;
  // 9 of the ring's 100 units, but never fewer than 8 rendered pixels: a small ring scales the text up.
  const countSize = Math.max(9, 800 / size);
  const base = (text: string | null, id: string) =>
    text && (
      <span data-testid={id} className="tabular block text-[10px] leading-[13px] whitespace-nowrap text-[var(--ph-ink-3)]">
        ≈ {text}
      </span>
    );
  return (
        <div className="px-[14px] py-[14px]">
          <div className="flex items-start gap-[14px]">
            <svg data-testid="plan-ring" role="img" aria-label={`${percent} percent paid, ${count}`} width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
              <circle cx="50" cy="50" r="45" fill="none" stroke="var(--ph-track)" strokeWidth="10" />
              {percent > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="var(--ph-up)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - percent / 100)}
                  transform="rotate(-90 50 50)"
                />
              )}
              <text x="50" y="44" textAnchor="middle" dominantBaseline="central" fontSize="21" fontWeight="700" fill="var(--ph-ink)">
                {percent}%
              </text>
              <text data-testid="plan-count" x="50" y="62" textAnchor="middle" dominantBaseline="central" fontSize={countSize} fontWeight="500" fill="var(--ph-ink-3)">
                {count}
              </text>
            </svg>
            <div ref={block} className="min-w-0 flex-1">
              {status.kind === 'none' || status.kind === 'partly' || status.kind === 'exact' ? (
                <div data-testid="plan-status" className="text-xs leading-[15px] font-medium whitespace-nowrap text-[var(--ph-ink-3)]">
                  {status.kind === 'none' ? 'Nothing paid yet' : status.kind === 'partly' ? 'Partly paid' : 'On the estimate'}
                </div>
              ) : (
                <div
                  data-testid="plan-status"
                  aria-label={status.kind === 'saved' ? `Saved ${status.amount} against the estimate` : `Over the estimate by ${status.amount}`}
                  className={cx(
                    'tabular text-xs leading-[15px] font-semibold whitespace-nowrap',
                    status.kind === 'saved' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-alarm)]',
                  )}
                >
                  <span aria-hidden>{status.kind === 'saved' ? '▼' : '▲'}</span> {status.amount} {status.kind === 'saved' ? 'saved' : 'over'}
                </div>
              )}
              <div data-testid="plan-to-go" className="tabular mt-px text-base leading-5 font-extrabold whitespace-nowrap text-[var(--ph-ink)]">
                {toPay}
              </div>
              {base(toPayBase, 'plan-to-go-base')}
              <div className="my-[5px] h-[0.5px] bg-[var(--ph-hair)]" />
              <div className="flex justify-between gap-1.5">
                <div>
                  <div data-testid="plan-planned" className="whitespace-nowrap">
                    <span className="block text-[10.5px] leading-[13px] text-[var(--ph-ink-3)]">{estimateWord}</span>
                    <span className="tabular text-xs leading-4 font-semibold text-[var(--ph-ink)]">{estimate}</span>
                  </div>
                  {base(estimateBase, 'plan-planned-base')}
                </div>
                <div className="text-right">
                  <div data-testid="plan-actual" className="whitespace-nowrap">
                    <span className="block text-[10.5px] leading-[13px] text-[var(--ph-ink-3)]">Actual</span>
                    <span className="tabular text-xs leading-4 font-semibold text-[var(--ph-ink)]">{actual}</span>
                  </div>
                  {base(actualBase, 'plan-actual-base')}
                </div>
              </div>
            </div>
          </div>
        </div>
  );
}

/** The private plan's top card: the body inside a group's surface. */
export function PlanHero(props: ComponentProps<typeof PlanHeroBody>) {
  return (
    <div data-testid="plan-totals">
      <InsetGroup>
        <PlanHeroBody {...props} />
      </InsetGroup>
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
        <CategoryIcon categoryId={categoryId} accounts={accounts} size="row" />
        <div className="flex min-w-0 flex-1 flex-col text-xs leading-tight text-[var(--ph-ink-3)]">
          <h2 className="truncate text-sm font-semibold text-[var(--ph-ink)]">{name}</h2>
          <span>
            {itemCount} {itemCount === 1 ? 'cost' : 'costs'} · {boughtCount === 0 ? 'none' : boughtCount} paid
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
 * An event's plan, as a checklist: a ring card on top (how many are paid, what is left to pay, the estimate against the
 * actual and how they compare), then a card per category — its header what was paid of what it plans, its items still
 * to pay first and paid after.
 *
 * The plan is read in the event's currency (the workspace's own when the event has none): an item priced in another
 * currency shows its own price, and its estimate at the day's rate with ≈. The base equivalents sit under the card's
 * three figures.
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
        <PushedTitle title="Plan" back="All events" backTo="/events" />
        <Empty>That event is no longer here.</Empty>
      </>,
    );
  }

  const data = plan.data;
  const home = eventCurrency(event?.currency, ws.baseCurrency);
  const totals = data ? planInEvent(data, home, ws.baseCurrency) : null;
  const search = { ws: tab };
  const addLabel = 'Add a cost';
  const add: CornerAction = {
    key: 'add',
    label: addLabel,
    glyph: <Plus size={22} aria-hidden />,
    to: '/events/$eventId/plan/new',
    params: { eventId },
    search,
  };
  const rp = (minor: number) => formatMinor(minor, home);

  return screen(
    <>
      <PushedTitle
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
          This copy of the data is from before a plan was a list of things to pay, so nothing can be added to it yet. Open it once on a version that has
          finished updating, and the plan will be here.
        </p>
      )}

      {data && data.itemCount === 0 ? (
        <>
          <Empty>Nothing planned yet. Add what is planned to pay and roughly what it costs.</Empty>
          <InsetGroup>
            <InsetRow title="Add the first cost" to="/events/$eventId/plan/new" params={{ eventId }} search={search} />
          </InsetGroup>
        </>
      ) : (
        data &&
        totals && (
          <>
            <PlanHero
              percent={planDonePercent(totals.plannedMinor, totals.toBuyMinor)}
              count={`${data.boughtCount} of ${data.itemCount} paid`}
              status={hereStatus(planStatus(data.lines.flatMap((line) => line.items)), rp)}
              // "All paid" only once every cost is done: an open item paid in full still has Rp0 to pay.
              toPay={totals.toBuyMinor > 0 || data.boughtCount < data.itemCount ? `${rp(totals.toBuyMinor)} to pay` : 'All paid'}
              toPayBase={totals.base && formatMinor(totals.base.toBuyMinor, ws.baseCurrency)}
              estimateWord={estimateLabel(data)}
              estimate={rp(totals.plannedMinor)}
              estimateBase={totals.base && formatMinor(totals.base.plannedMinor, ws.baseCurrency)}
              actual={rp(totals.boughtMinor)}
              actualBase={totals.base && formatMinor(totals.base.boughtMinor, ws.baseCurrency)}
            />

            {/*
              * The checklist, a card per category, read like a day in the Cashflow history: its header says how many
              * of its items are paid and what was paid of what it plans, and its items follow — still to buy first,
              * paid after — each with how many and at what price.
              */}
            {(data.lines ?? [])
              .filter((line) => line.items.length > 0)
              .map((line) => {
                const paid = line.items.reduce((total, item) => total + (item.paidEventMinor ?? 0), 0);
                const ordered = [...line.items.filter((item) => !item.bought), ...line.items.filter((item) => item.bought)];
                return (
                  <PlanCategoryCard
                    key={line.categoryId ?? 'none'}
                    categoryId={line.categoryId}
                    name={line.name}
                    itemCount={line.items.length}
                    boughtCount={line.items.filter((item) => item.bought).length}
                    paid={rp(paid)}
                    planned={rp(line.plannedEventMinor)}
                    accounts={accounts}
                  >
                    {ordered.map((item) => {
                      return (
                        <PlanItemRow
                          key={item.id}
                          eventId={eventId}
                          itemId={item.id}
                          name={item.name}
                          subtitle={itemSubtitle(item, home, ws.baseCurrency)}
                          figure={itemFigure(item, home, ws.baseCurrency)}
                          against={itemPaidAgainst(item, home, ws.baseCurrency)}
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
          </>
        )
      )}
    </>,
  );
}
