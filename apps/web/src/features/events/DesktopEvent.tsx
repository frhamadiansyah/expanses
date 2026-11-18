import { formatMinor, isExchangeResultKey, isoDate } from '@expanses/core';
import { type EventRow, saveEvent, saveEventItem, setEventItemDone, tagTransaction, type TransactionView } from '@expanses/db';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox, Money } from '../../ui';
import { SegmentedControl, type Segment } from '../../ui/native';
import { CategoryIcon, useCategoryMarkColour } from '../categories/CategoryIcon';
import { goalCard } from '../goals/goal-cards';
import { useGoalPlans } from '../goals/queries';
import { BOX, BoxHead, NOTE, RingBox } from '../transactions/CashflowBoxes';
import { ringLegend } from '../transactions/cashflow-desk-model';
import { amountExtraParts, buildRows } from '../transactions/list-model';
import { shortDate } from '../transactions/quick-row';
import { ReceiptPeek } from '../transactions/ReceiptPeek';
import { addSpendingTarget, buyTarget } from './buy-item';
import { AddCostLink, BoxRow, EventDesk, EventTitleBar, PlanBox, PlanTable, TableTabs, TD, TH } from './DeskEventParts';
import { eventDates } from './event-dates';
import { beforeItStarts, paidWithRows, startsAhead } from './events-desk-model';
import { chartUnder, planTotals } from './plan-view';
import { useBooksInEvent, useEventHistory, useEventPlan, useEvents, useEventSuggestions } from './queries';

type TableTab = 'transactions' | 'plan';

/** A spending line the event's figures add: never an exchange's gain or loss, which counts nowhere (owner, 17 Nov 2026). */
const spendLine = (entry: { accountKind: string; accountSystemKey?: string | null }) => entry.accountKind === 'expense' && !isExchangeResultKey(entry.accountSystemKey);

/**
 * A private event on a wide screen (Mac Events, option A, owner 2026-11-18), full width under its own title bar.
 *
 * Three boxes: Spent by category (the phone's ring: every category with money in it, click one to filter the table),
 * Plan (what the planned categories spent of the plan; not drawn for an event kept without a plan or with nothing on it,
 * and the ring widens), and Before it starts for a planned event not started yet — what is still to pay, a month until
 * then, and the goal it is saved for — else Paid with, what paid for it by account. Then a table of two tabs: the
 * event's transactions (a click opens the Mac receipt peek beside it, ⌃ ⌄ and ↑ ↓ step, Esc closes) and its Plan, a
 * cost's Planned typed in place. What was spent inside the dates and not tagged follows. Every figure is the phone's
 * own reading of the same queries (`planTotals`, `chartUnder`, the history list); every write is today's.
 */
export function DesktopLocalEvent() {
  const { eventId } = useParams({ from: '/events/$eventId' });
  const { ws: openedIn } = useSearch({ from: '/events/$eventId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  // The workspace tab is the URL's, as on the phone: the plan pages carry it in and hand it back.
  const tab = openedIn ?? null;
  const setTab = (choice: string | null) => void navigate({ to: '/events/$eventId', params: { eventId }, search: { ws: choice ?? undefined }, replace: true });
  const books = useBooksInEvent(eventId).data ?? [];
  const openTab = books.some((book) => book.id === tab) ? tab : null;
  const plan = useEventPlan(eventId, openTab);
  const suggestions = useEventSuggestions(eventId, openTab);
  const history = useEventHistory(eventId, openTab);
  const accounts = useAccounts().data ?? [];
  const colourFor = useCategoryMarkColour();
  const today = isoDate();
  const currency = ws.baseCurrency;

  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [table, setTable] = useState<TableTab>('transactions');
  const [peekId, setPeekId] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const data = plan.data;
  const totals = data ? planTotals(data) : null;
  const planned = event?.planOff !== true;
  const hasPlan = data?.hasPlan === true && planned;
  const txs = history.data ?? [];

  // The ring: every category with money in it, as the phone's "Where it went" draws it.
  const spentLines = (data?.lines ?? []).filter((line) => line.actualMinor > 0);
  const legend = ringLegend(
    spentLines.map((line) => ({ id: line.categoryId ?? 'none', name: line.name, totalMinor: line.actualMinor })),
    (id) => colourFor(id === 'none' ? null : id),
    0,
    6,
  );

  // The table, filtered to the category picked on the ring as the phone's history is.
  const inPicked = (entry: { accountKind: string; accountId: string }) => entry.accountKind === 'expense' && entry.accountId === picked;
  const shown = txs.filter((tx) => (picked === null ? true : picked === 'none' ? !tx.entries.some(spendLine) : tx.entries.some(inPicked)));
  const pickedName = picked === null ? null : (data?.lines.find((line) => (line.categoryId ?? 'none') === picked)?.name ?? null);

  // ── The receipt peek ─────────────────────────────────────────────────────────────────────────────────────────────
  const order = table === 'transactions' ? shown.map((tx) => tx.id) : [];
  const peeking = peekId !== null && order.includes(peekId);
  const step = (by: -1 | 1) => {
    const at = peekId ? order.indexOf(peekId) : -1;
    const next = at < 0 ? undefined : order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setPeekId(next);
  };
  useEffect(() => {
    if (!peeking) return;
    const place = () => setPeekTop(Math.max(0, bar.current?.getBoundingClientRect().bottom ?? 52));
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [peeking]);
  useEffect(() => {
    if (!peekId) return;
    document.querySelector(`[data-event-tx="${CSS.escape(peekId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [peekId]);
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (key: KeyboardEvent) => {
    if (!peeking) return;
    const target = key.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (key.key === 'Escape') setPeekId(null);
    else if (key.key === 'ArrowUp') step(-1);
    else if (key.key === 'ArrowDown') step(1);
    else return;
    key.preventDefault();
  };
  useEffect(() => {
    const listen = (key: KeyboardEvent) => keys.current(key);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  /** Links a goal to the event, or none: today's event write, every other field as the event has it (`events.goal_id`). */
  async function linkGoal(row: EventRow, goalId: string | null) {
    await saveEvent(database, ws, { id: row.id, name: row.name, startsOn: row.startsOn, endsOn: row.endsOn, setId: row.setId, goalId });
  }

  if (events.isSuccess && !event) {
    return (
      <EventDesk testId="event-page">
        <p className="px-[20px] py-[16px] text-[13px] text-[var(--ph-ink-3)]">That event is no longer here.</p>
      </EventDesk>
    );
  }

  const ahead = event !== null && hasPlan && startsAhead(event, today);
  const paidWith = paidWithRows(txs);
  const third = ahead ? 'before' : paidWith.rows.length > 0 ? 'paid-with' : null;
  const boxes = 1 + (hasPlan ? 1 : 0) + (third ? 1 : 0);
  const grid =
    boxes === 3
      ? 'grid-cols-1 @min-[560px]:grid-cols-2 @min-[900px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]'
      : boxes === 2
        ? 'grid-cols-1 @min-[560px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'
        : 'grid-cols-1';

  const workspaceTabs =
    books.length > 1 ? (
      <div data-testid="event-workspaces" className="w-full max-w-sm">
        <SegmentedControl
          label="Workspace"
          segments={[{ key: 'all', label: 'All' }, ...books.map((book): Segment => ({ key: book.id, label: book.name }))]}
          value={openTab ?? 'all'}
          onChange={(key) => setTab(key === 'all' ? null : key)}
          max={6}
        />
      </div>
    ) : null;

  return (
    <EventDesk testId="event-page">
      <EventTitleBar
        barRef={bar}
        eventId={eventId}
        name={event?.name ?? ''}
        dates={event ? `${eventDates(event)}${event.currency && event.currency !== ws.baseCurrency ? ` · ${event.currency}` : ''}` : ''}
        chip={null}
        mode={event}
        settings={{ to: '/events/$eventId/settings' }}
        add={{ label: 'Add spending', run: () => void navigate(addSpendingTarget(eventId)) }}
      />
      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', peeking && 'mr-[322px]')}>
        <ErrorBox error={error ?? events.error ?? plan.error} />
        {workspaceTabs}
        {event && data && totals && (
          <div className={cx('grid items-stretch gap-[14px]', grid)}>
            <RingBox
              kind="expense"
              title="Spent by category"
              testId="event-ring"
              period={event.name}
              items={legend.items}
              totalMinor={totals.spentMinor}
              currency={currency}
              picked={picked ?? ''}
              onPick={(id) => {
                setPicked(picked === id ? null : id);
                setTable('transactions');
              }}
              icon={(id) => <CategoryIcon categoryId={id === 'none' ? null : id} accounts={accounts} size="xs" />}
              ready={plan.isSuccess}
              footnote={chartUnder(totals, txs.length, currency)}
            />
            {hasPlan && <PlanBox totals={totals} boughtCount={data.boughtCount} itemCount={data.itemCount} currency={currency} />}
            {third && (
              <div className={cx('flex min-w-0 flex-col', boxes === 3 && '@min-[560px]:col-span-2 @min-[900px]:col-span-1')}>
                {third === 'before' ? (
                  <BeforeBox event={event} toPayMinor={totals.toBuyMinor} currency={currency} onLink={(goalId) => void run(() => linkGoal(event, goalId))} />
                ) : (
                  <PaidWithBox rows={paidWith.rows} totalMinor={paidWith.totalMinor} currency={currency} />
                )}
              </div>
            )}
          </div>
        )}

        {event && (
          <section className={cx(BOX, 'overflow-clip')} aria-label="Event table" data-testid="event-table-box">
            <div className="flex items-center gap-[10px] px-[14px] py-[9px]">
              <TableTabs
                value={planned ? table : 'transactions'}
                onChange={(next) => {
                  setTable(next);
                  setPeekId(null);
                }}
                tabs={[
                  { key: 'transactions', label: `Transactions · ${txs.length}` },
                  ...(planned ? [{ key: 'plan' as const, label: `Plan · ${data?.itemCount ?? 0} ${data?.itemCount === 1 ? 'cost' : 'costs'}` }] : []),
                ]}
              />
              {picked !== null && table === 'transactions' && (
                <span className="flex items-center gap-[6px] text-[12px] text-[var(--ph-ink-2)]">
                  <span data-testid="event-filter">Only {pickedName ?? 'one category'}</span>
                  <button type="button" onClick={() => setPicked(null)} className="text-[var(--mac-accent)] hover:underline">
                    Show all
                  </button>
                </span>
              )}
              <span className="flex-1" />
              <span className={NOTE}>{table === 'plan' ? 'type a planned figure in its row · Status ticks Done buying' : shown.length > 0 ? 'click a row to see it' : ''}</span>
            </div>
            {table === 'plan' && planned && data ? (
              <PlanTable
                plan={data}
                currency={event.currency ?? ws.baseCurrency}
                baseCurrency={ws.baseCurrency}
                mark={(categoryId) => <CategoryIcon categoryId={categoryId} accounts={accounts} size="xs" />}
                onOpen={(itemId) => void navigate({ to: '/events/$eventId/plan/$itemId', params: { eventId, itemId }, search: { ws: openTab ?? undefined } })}
                edit={{
                  // Today's item write, every other field as the cost has it: only the price of one changes.
                  save: async (item, unitPriceMinor) => {
                    await saveEventItem(database, ws, eventId, { id: item.id, name: item.name, quantity: item.quantity, unitPriceMinor, categoryAccountId: item.categoryId, link: item.link, note: item.note });
                    await invalidate();
                  },
                  form: (itemId) => void navigate({ to: '/events/$eventId/plan/$itemId/edit', params: { eventId, itemId }, search: { ws: openTab ?? undefined } }),
                }}
                status={{
                  pay: (item) => void navigate(buyTarget(eventId, item.id, openTab ?? undefined)),
                  done: (item, done) => void run(() => setEventItemDone(database, ws, item.id, done)),
                }}
                addCost={<AddCostLink to="/events/$eventId/plan/new" eventId={eventId} />}
              />
            ) : (
              <TransactionsTable txs={shown} accounts={accounts} today={today} currency={currency} peekId={peeking ? peekId : null} onPeek={setPeekId} filtered={picked !== null} />
            )}
          </section>
        )}

        {(suggestions.data?.length ?? 0) > 0 && event && (
          <section className={BOX} aria-label={`Was this part of ${event.name}?`} data-testid="event-suggestions">
            <BoxHead title={`Was this part of ${event.name}?`} note="inside the dates, in a category it draws on, not tagged yet" />
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {(suggestions.data ?? []).map((candidate) => (
                  <tr key={candidate.transactionId} className="border-t border-[var(--ph-hair)]">
                    <td className={cx(TD, 'w-[70px] pl-[14px] text-[var(--ph-ink-3)] tabular-nums')}>{shortDate(candidate.occurredOn, today)}</td>
                    <td className={TD}>{candidate.description}</td>
                    <td className={cx(TD, 'text-[var(--ph-ink-2)]')}>
                      <span className="flex items-center gap-[6px]">
                        <CategoryIcon categoryId={candidate.categoryAccountId} accounts={accounts} size="xs" />
                        {accounts.find((account) => account.id === candidate.categoryAccountId)?.name ?? ''}
                      </span>
                    </td>
                    <td className={cx(TD, 'text-right tabular-nums')}>{formatMinor(candidate.amountBaseMinor, currency)}</td>
                    <td className={cx(TD, 'w-[70px] pr-[14px] text-right')}>
                      <button
                        type="button"
                        aria-label={`Tag ${candidate.description}`}
                        onClick={() => void run(() => tagTransaction(database, ws, candidate.transactionId, eventId))}
                        className="rounded-[6px] border border-[var(--ph-chevron)] px-[8px] py-[1px] text-[12px] hover:bg-[var(--ph-fill)]"
                      >
                        Tag
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {peeking && peekId && (
        <ReceiptPeek
          top={peekTop}
          transactionId={peekId}
          testId="receipt-peek"
          first={order.indexOf(peekId) <= 0}
          last={order.indexOf(peekId) === order.length - 1}
          onStep={step}
          onClose={() => setPeekId(null)}
        />
      )}
    </EventDesk>
  );

}

/**
 * The event's transactions: Date, Note, Category, Paid with and Amount (the phone row's figure, with the foreign one in
 * grey beside it). A click opens the Mac receipt peek; the row picked stays blue while it is open.
 */
function TransactionsTable({
  txs,
  accounts,
  today,
  currency,
  peekId,
  onPeek,
  filtered,
}: {
  txs: readonly TransactionView[];
  accounts: Parameters<typeof buildRows>[2];
  today: string;
  currency: string;
  peekId: string | null;
  onPeek: (id: string) => void;
  filtered: boolean;
}) {
  const listRows = new Map(buildRows(txs, [], accounts, []).map((row) => [row.id, row]));
  if (txs.length === 0) {
    return <p className="border-t border-[var(--ph-hair)] px-[14px] py-[12px] text-[13px] text-[var(--ph-ink-3)]">{filtered ? 'No payments in this category.' : 'Nothing tagged to it yet. ＋ Add spending records the first payment.'}</p>;
  }
  return (
    <table className="w-full table-fixed border-collapse text-[13px]" data-testid="event-transactions">
      <colgroup>
        <col className="w-[80px]" />
        <col />
        <col className="w-[22%]" />
        <col className="w-[22%]" />
        <col className="w-[190px]" />
      </colgroup>
      <thead>
        <tr>
          <th className={cx(TH, 'pl-[14px]')}>Date</th>
          <th className={TH}>Note</th>
          <th className={TH}>Category</th>
          <th className={TH}>Paid with</th>
          <th className={cx(TH, 'pr-[14px] text-right')}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {txs.map((tx, index) => {
          const expense = tx.entries.find((entry) => entry.accountKind === 'expense');
          const paidWith = tx.entries.find((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability');
          const listRow = listRows.get(tx.id);
          const foreign = (listRow ? amountExtraParts(tx, undefined, listRow) : []).filter((part) => part.tone === 'foreign');
          const selected = peekId === tx.id;
          const grey = selected ? 'text-white/80' : 'text-[var(--ph-ink-3)]';
          return (
            <tr
              key={tx.id}
              data-testid="event-history"
              data-event-tx={tx.id}
              aria-selected={selected}
              onClick={() => onPeek(tx.id)}
              title="Click to see it"
              className={cx('cursor-default select-none', selected ? 'bg-[var(--mac-accent)] text-white' : cx('text-[var(--ph-ink)]', index % 2 === 1 && 'bg-[var(--mac-zebra)]'))}
            >
              <td className={cx(TD, 'pl-[14px] tabular-nums', grey)}>{shortDate(tx.occurredOn, today)}</td>
              <td className={TD}>
                <button type="button" title="Open the receipt" className="block w-full truncate text-left">
                  {tx.description || expense?.accountName || 'No note'}
                </button>
              </td>
              <td className={cx(TD, selected && '[&_[data-testid=category-mark]]:bg-white!')}>
                <span className="flex min-w-0 items-center gap-[6px]">
                  <CategoryIcon categoryId={expense?.accountId ?? null} accounts={accounts} size="xs" />
                  <span className="truncate">{expense?.accountName ?? 'No category'}</span>
                </span>
              </td>
              <td className={cx(TD, 'truncate', selected ? 'text-white' : 'text-[var(--ph-ink-2)]')}>{paidWith?.accountName ?? ''}</td>
              <td className={cx(TD, 'pr-[14px] text-right whitespace-nowrap tabular-nums')}>
                <Money minor={expense?.amountBaseMinor ?? 0} currency={currency} className="font-semibold" />
                {foreign.length > 0 && <span className={cx('ml-[6px] text-[11.5px]', grey)}>{foreign.map((part) => part.text).join(' · ')}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Before it starts (owner, 2026-11-18): the first day, what the plan still has to pay before it (all of the plan's
 * still-to-pay: a cost has no date of its own), that over the whole months until then, and the goal it is saved for.
 */
function BeforeBox({ event, toPayMinor, currency, onLink }: { event: EventRow; toPayMinor: number; currency: string; onLink: (goalId: string | null) => void }) {
  const today = isoDate();
  const figures = beforeItStarts({ toPayMinor, startsOn: event.startsOn, today, currency });
  return (
    <section className={cx(BOX, 'flex-1')} aria-label="Before it starts" data-testid="before-it-starts">
      <BoxHead title="Before it starts" note={figures.until} />
      <dl>
        <BoxRow label="Starts" testId="before-starts">
          {new Date(`${event.startsOn}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </BoxRow>
        <BoxRow label="To pay before then" testId="before-to-pay">
          <Money minor={figures.toPayMinor} currency={currency} />
        </BoxRow>
        <BoxRow label={<span title={`Over ${figures.months} ${figures.months === 1 ? 'month' : 'months'}`}>A month until then</span>} testId="before-a-month">
          <Money minor={figures.aMonthMinor} currency={currency} />
        </BoxRow>
        <GoalRow goalId={event.goalId} onLink={onLink} />
      </dl>
    </section>
  );
}

/**
 * The goal the event is saved for (`events.goal_id`): its name — a link to its page — with what is saved of its target,
 * the goal page's own figures (`goalCard`); or Link a goal ›, a short list of the goals still running.
 */
function GoalRow({ goalId, onLink }: { goalId: string | null; onLink: (goalId: string | null) => void }) {
  const { ws } = useApp();
  const plans = useGoalPlans(isoDate()).data?.plans ?? [];
  const cards = plans.map((plan) => goalCard(plan, { baseCurrency: ws.baseCurrency }));
  const linked = goalId ? cards.find((card) => card.goalId === goalId) : undefined;
  const running = cards.filter((card) => !card.done);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  const pick = (id: string | null) => {
    setOpen(false);
    onLink(id);
  };
  return (
    <div className="relative border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[13px]" ref={box} data-testid="before-goal">
      <div className="flex items-baseline justify-between gap-[10px]">
        <dt className="shrink-0 text-[var(--ph-ink)]">Goal</dt>
        <dd className="min-w-0 text-right">
          {linked ? (
            <span className="flex min-w-0 items-baseline justify-end gap-[6px]">
              <Link to="/goals/$goalId" params={{ goalId: linked.goalId }} className="min-w-0 truncate text-[var(--mac-accent)] hover:underline" data-testid="before-goal-link">
                {linked.name} ›
              </Link>
              <button type="button" onClick={() => setOpen(!open)} className="shrink-0 text-[11.5px] text-[var(--ph-ink-3)] hover:text-[var(--ph-ink)]" aria-label="Change the goal">
                Change
              </button>
            </span>
          ) : (
            <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="text-[var(--mac-accent)] hover:underline">
              Link a goal ›
            </button>
          )}
        </dd>
      </div>
      {linked && (
        <div data-testid="before-goal-saved" className="mt-[1px] text-right text-[11.5px] text-[var(--ph-ink-3)] tabular-nums">
          {formatMinor(linked.currentMinor, linked.currency)} saved{linked.targetMinor > 0 && ` of ${formatMinor(linked.targetMinor, linked.currency)}`}
        </div>
      )}
      {open && (
        <div role="menu" aria-label="Goals" className="absolute right-[8px] z-30 mt-[4px] w-[260px] rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-[5px] text-left shadow-[0_8px_28px_rgba(0,0,0,0.18)]">
          {running.length === 0 && <p className="px-[10px] py-[6px] text-[12.5px] text-[var(--ph-ink-3)]">No goal is running.</p>}
          {running.map((card) => (
            <button
              key={card.goalId}
              type="button"
              role="menuitemradio"
              aria-checked={card.goalId === goalId}
              onClick={() => pick(card.goalId)}
              className="flex w-full items-center justify-between gap-[8px] rounded-[5px] px-[10px] py-[4px] text-left text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
            >
              <span className="min-w-0 truncate">{card.name}</span>
              <span className="shrink-0 text-[11.5px] text-[var(--ph-ink-3)]">{card.kindLabel}</span>
            </button>
          ))}
          {goalId && (
            <button type="button" role="menuitem" onClick={() => pick(null)} className="mt-[2px] w-full rounded-[5px] border-t border-[var(--ph-hair)] px-[10px] py-[4px] text-left text-[13px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
              No goal
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What paid for the event, by account, and the rows' own total: the third box of an event with nothing ahead of it. */
function PaidWithBox({ rows, totalMinor, currency }: { rows: { name: string; minor: number }[]; totalMinor: number; currency: string }) {
  const top = rows.slice(0, 4);
  const rest = rows.slice(4).reduce((sum, row) => sum + row.minor, 0);
  const lines: ReactNode[] = top.map((row) => (
    <BoxRow key={row.name} label={row.name} testId="paid-with-row">
      <Money minor={row.minor} currency={currency} />
    </BoxRow>
  ));
  if (rest !== 0) {
    lines.push(
      <BoxRow key="others" label={`${rows.length - 4} more`} testId="paid-with-row">
        <Money minor={rest} currency={currency} />
      </BoxRow>,
    );
  }
  return (
    <section className={cx(BOX, 'flex-1')} aria-label="Paid with" data-testid="paid-with">
      <BoxHead title="Paid with" note={`${rows.length} ${rows.length === 1 ? 'account' : 'accounts'}`} />
      <dl>
        {lines}
        <BoxRow label={<span className="font-semibold">Total</span>} testId="paid-with-total">
          <Money minor={totalMinor} currency={currency} className="font-semibold" />
        </BoxRow>
      </dl>
    </section>
  );
}
