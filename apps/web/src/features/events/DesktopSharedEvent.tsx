import { formatMinor, isoDate } from '@expanses/core';
import type { NamedPayment, SharedEventView, SharedSettlementView } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeftRight, CircleEllipsis, HandCoins } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { cx, ErrorBox } from '../../ui';
import { ICONS, MarkChip } from '../categories/CategoryIcon';
import { BOX, BoxHead, NOTE, RingBox } from '../transactions/CashflowBoxes';
import { ringLegend } from '../transactions/cashflow-desk-model';
import { chartColour, OTHER_COLOUR } from '../transactions/category-colours';
import { shortDate } from '../transactions/quick-row';
import { useOpenReceipt } from '../transactions/ReceiptPeekHost';
import { addSpendingTarget } from './buy-item';
import { AddCostLink, BoxRow, EventDesk, EventTiles, EventTitleBar, PlanBox, PlanTable, TABLE_WRAP, TableTabs, TD, TH } from './DeskEventParts';
import { macV2 } from '../../ui/mac-detail';
import { PILL_SMALL } from '../../ui/desk';
import { eventDates } from './event-dates';
import { sharedChip, splitCostsBox } from './events-desk-model';
import { FinishSharing } from './FinishSharing';
import { planInEvent } from './plan-view';
import { SettlementSheet } from './SettlementSheet';
import { SettleUpSheet } from './SettleUpSheet';
import { useFetchEventRates, useSharedEventPlan } from './shared-queries';
import { dayGroups, type DayItem, expenseRow, listedRecords, mineToSettle, pageLocks, paymentLine, pickedDays, readOnlyLine, settlementDeletable, settlementRow, spendingSlices, transferRow, waitingLine } from './shared-view';
import { TakeOverSheet } from './TakeOverSheet';

type TableTab = 'transactions' | 'plan';

/**
 * A shared trip on a wide screen (Mac Events, option A, owner 2026-11-18), laid out as a private event is: the title bar
 * (‹ Events, the name's menu, dates and currency, Shared · the others, Event mode, ⚙ the trip's Settings, ＋ Add
 * spending), then Spent by category (the phone's ring of the trip's own categories, click to filter), Plan (the shared
 * plan's figures, unless its Plan switch is off) and Split costs (what each person paid, how costs are shared, who pays
 * whom with Settle up — not drawn in one pot), over the trip's records and its Plan in one table. A record opens what the
 * phone opens: a cost's card to change on every phone, a settle-up's sheet, a listed transfer's receipt. Every figure is
 * the phone's shared view (`spendingSlices`, `splitCostsBox` over the same records, `planInEvent`, `view.payments`).
 */
export function DesktopSharedEvent({ view }: { view: SharedEventView }) {
  const { ws } = useApp();
  const navigate = useNavigate();
  const openReceipt = useOpenReceipt();
  const plan = useSharedEventPlan(view.eventId);
  const { readOnly, locked } = pageLocks(view);
  useFetchEventRates(view.waiting.some((w) => w.reason === 'no-rate'));
  const waiting = waitingLine(view);
  const bar = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Back from a cost's page lands on the Plan tab, where the trip was left (the phone's Plan card).
  const { card: arrivedOn } = useSearch({ from: '/events/$eventId' });
  const [table, setTable] = useState<TableTab>(arrivedOn === 'plan' ? 'plan' : 'transactions');
  const [settling, setSettling] = useState<NamedPayment | null>(null);
  const [opened, setOpened] = useState<SharedSettlementView | null>(null);
  const [takingOver, setTakingOver] = useState(false);

  const slices = spendingSlices(view);
  const colourOf = (key: string) => (key === 'none' ? OTHER_COLOUR : chartColour(key));
  const legend = ringLegend(
    slices.map((slice) => ({ id: slice.key, name: slice.label, totalMinor: slice.totalMinor })),
    colourOf,
    0,
    6,
  );
  const mark = (key: string | null) => {
    const category = key && key !== 'none' ? view.categories.find((c) => c.categoryId === key) : undefined;
    return <MarkChip Glyph={ICONS[category?.icon ?? 'circle-ellipsis'] ?? CircleEllipsis} colour={category ? chartColour(category.categoryId) : OTHER_COLOUR} size="xs" />;
  };
  const days = pickedDays(dayGroups(listedRecords(view)), picked);
  const records = days.flatMap((day) => day.items.map((item) => ({ date: day.date, item })));
  const allRecords = dayGroups(listedRecords(view)).reduce((sum, day) => sum + day.items.length, 0);
  const counted = view.expenses.filter((e) => !e.voided && !e.unreadable).length;

  const planData = plan.data;
  const showPlan = !view.planOff;
  const planTotals = planData ? planInEvent(planData, view.currency, view.currency) : null;
  const split = view.splitCosts ? splitCostsBox(view) : null;
  const mine = new Set(mineToSettle(view));
  const offerSettle = (p: NamedPayment) => mine.has(p) || !view.people.some((x) => x.hasApp && (x.personId === p.fromPersonId || x.personId === p.toPersonId));
  const others = view.people.filter((person) => !person.isMe && !person.removed).map((person) => ({ name: person.name, initials: person.initials }));

  const hasPlan = showPlan && planData && planTotals && planData.itemCount > 0;
  // v1 says the plan's figures in the tiles over the boxes; the Plan box itself is v2's.
  const planBox = hasPlan && macV2;
  const boxes = 1 + (planBox ? 1 : 0) + (split ? 1 : 0);
  const grid =
    boxes === 3
      ? 'grid-cols-1 @min-[560px]:grid-cols-2 @min-[900px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]'
      : boxes === 2
        ? 'grid-cols-1 @min-[560px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'
        : 'grid-cols-1';

  return (
    <EventDesk testId="shared-event">
      <EventTitleBar
        barRef={bar}
        eventId={view.eventId}
        name={view.name}
        dates={`${eventDates(view)}${view.currency !== ws.baseCurrency ? ` · ${view.currency}` : ''}`}
        chip={sharedChip({ people: others })}
        mode={locked ? null : { id: view.eventId, name: view.name, startsOn: view.startsOn, endsOn: view.endsOn, currency: view.currency }}
        settings={{ to: '/events/$eventId/shared-settings' }}
        add={readOnly ? null : { label: 'Add spending', run: () => void navigate(addSpendingTarget(view.eventId)), disabled: locked }}
      />
      <div className="@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]">
        <ErrorBox error={plan.error} />
        {locked ? null : <FinishSharing view={view} />}
        {readOnly && (
          <p data-testid="shared-event-read-only" className="rounded-[14px] bg-[var(--mk-card)] px-[16px] py-[10px] text-[13.5px] text-[var(--mk-ink-2)]">
            {readOnlyLine(view)}
          </p>
        )}
        {waiting && !readOnly && (
          <button
            type="button"
            data-testid="take-over-row"
            onClick={() => setTakingOver(true)}
            className="flex w-full items-center justify-between rounded-[14px] bg-[var(--mk-t-orange-bg)] px-[16px] py-[10px] text-left text-[13.5px] font-semibold text-[var(--mk-t-orange)] hover:opacity-90"
          >
            <span>
              {waiting} <span className="font-normal">· Choose the account for each</span>
            </span>
            <span aria-hidden>
              ›
            </span>
          </button>
        )}
        {hasPlan && (
          <EventTiles
            spentMinor={view.spentMinor}
            totals={{ plannedMinor: planTotals.plannedMinor, plannedSpentMinor: planTotals.boughtMinor, toBuyMinor: planTotals.toBuyMinor }}
            boughtCount={planData.boughtCount}
            itemCount={planData.itemCount}
            currency={view.currency}
          />
        )}
        <div className={cx('grid items-stretch gap-[16px]', grid)}>
          <RingBox
            kind="expense"
            title="Spent by category"
            testId="event-ring"
            period={view.name}
            items={legend.items}
            totalMinor={view.spentMinor}
            currency={view.currency}
            picked={picked ?? ''}
            onPick={(key) => {
              setPicked(picked === key ? null : key);
              setTable('transactions');
            }}
            icon={(key) => mark(key)}
            ready
            footnote={counted > 0 ? `${counted} ${counted === 1 ? 'transaction' : 'transactions'}` : null}
          />
          {planBox && (
            <PlanBox
              totals={{ plannedMinor: planTotals.plannedMinor, plannedSpentMinor: planTotals.boughtMinor, toBuyMinor: planTotals.toBuyMinor, notPlannedMinor: null, moneyBackMinor: 0 }}
              boughtCount={planData.boughtCount}
              itemCount={planData.itemCount}
              currency={view.currency}
            />
          )}
          {split && (
            <div className={cx('flex min-w-0 flex-col', boxes === 3 && '@min-[560px]:col-span-2 @min-[900px]:col-span-1')}>
              <section className={cx(BOX, 'flex-1')} aria-label="Split costs" data-testid="split-costs">
                <BoxHead title="Split costs" note={others.length > 0 ? `shared with ${others.map((o) => o.name).join(', ')}` : undefined} />
                <dl>
                  {split.paidBy.map((row) => (
                    <BoxRow
                      key={row.personId}
                      testId="split-paid-by"
                      label={
                        <span className="flex items-center gap-[7px]">
                          <Initials text={row.initials} me={row.isMe} />
                          Paid by {row.name}
                        </span>
                      }
                    >
                      {formatMinor(row.minor, view.currency)}
                    </BoxRow>
                  ))}
                  <BoxRow label={split.rule} testId="split-rule">
                    {formatMinor(split.shareMinor, view.currency)}
                  </BoxRow>
                </dl>
                <div className="px-[10px] pt-[4px] pb-[12px]">
                  {view.payments.length === 0 ? (
                    <p data-testid="split-settled" className="px-[4px] py-[4px] text-[13px] text-[var(--mk-ink-2)]">
                      Nobody owes anything.
                    </p>
                  ) : (
                    view.payments.map((p) => (
                      <div
                        key={`${p.fromPersonId}-${p.toPersonId}`}
                        data-testid="shared-payment-row"
                        className="mt-[6px] flex min-h-[38px] items-center justify-between gap-[10px] rounded-[12px] bg-[var(--mk-t-orange-bg)] px-[12px] py-[6px] text-[13px] text-[var(--mk-t-orange)]"
                      >
                        <span className="min-w-0 font-semibold">{paymentLine(p, view.currency)}</span>
                        {offerSettle(p) && !locked && (
                          <button
                            type="button"
                            aria-label={`Settle up: ${paymentLine(p, view.currency)}`}
                            onClick={() => setSettling(p)}
                            className={cx(PILL_SMALL, 'bg-[var(--mk-page)]')}
                          >
                            Settle up
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        <section className={cx(BOX, 'overflow-clip')} aria-label="Event table" data-testid="event-table-box">
          <div className="flex items-center gap-[10px] px-[16px] pt-[14px] pb-[10px]">
            <TableTabs
              value={showPlan ? table : 'transactions'}
              onChange={setTable}
              tabs={[
                { key: 'transactions', label: `Transactions · ${allRecords}` },
                ...(showPlan ? [{ key: 'plan' as const, label: `Plan · ${planData?.itemCount ?? 0} ${planData?.itemCount === 1 ? 'cost' : 'costs'}` }] : []),
              ]}
            />
            {picked !== null && table === 'transactions' && (
              <span className="flex items-center gap-[6px] text-[13px] text-[var(--mk-ink-2)]">
                <span data-testid="event-filter">Only {slices.find((slice) => slice.key === picked)?.label ?? 'one category'}</span>
                <button type="button" onClick={() => setPicked(null)} className="font-semibold text-[var(--mk-blue)] hover:underline">
                  Show all
                </button>
              </span>
            )}
            <span className="flex-1" />
            <span className={NOTE}>{table === 'plan' ? 'click a cost to change it on every phone' : 'click a row to open it'}</span>
          </div>
          <div className={TABLE_WRAP}>
          {table === 'plan' && showPlan ? (
            planData ? (
              <PlanTable
                plan={planData}
                currency={view.currency}
                baseCurrency={view.currency}
                mark={(categoryId) => mark(categoryId)}
                onOpen={(itemId) => {
                  if (!locked) void navigate({ to: '/events/$eventId/shared-plan/$itemId', params: { eventId: view.eventId, itemId }, search: {} });
                }}
                edit={null}
                status={null}
                addCost={locked ? null : <AddCostLink to="/events/$eventId/shared-plan/new" eventId={view.eventId} />}
              />
            ) : null
          ) : records.length === 0 ? (
            <p className="px-[6px] pt-[2px] pb-[10px] text-[13.5px] text-[var(--mk-ink-2)]">Nothing recorded on the trip yet.</p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[13.5px]" data-testid="event-transactions">
              <colgroup>
                <col className="w-[80px]" />
                <col />
                <col className="w-[20%]" />
                <col className="w-[22%]" />
                <col className="w-[200px]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={cx(TH, 'pl-[14px]')}>Date</th>
                  <th className={TH}>Note</th>
                  <th className={TH}>Category</th>
                  <th className={TH}>Payment method</th>
                  <th className={cx(TH, 'pr-[14px] text-right')}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {records.map(({ date, item }) => (
                  <SharedRecordRow
                    key={recordKey(item)}
                    date={date}
                    item={item}
                    view={view}
                    mark={mark}
                    onOpen={open(item)}
                  />
                ))}
              </tbody>
            </table>
          )}
          </div>
        </section>
      </div>
      {opened && view.splitCosts ? <SettlementSheet view={view} settlement={opened} onClose={() => setOpened(null)} /> : null}
      {settling && view.splitCosts ? <SettleUpSheet view={view} payment={settling} onClose={() => setSettling(null)} /> : null}
      {takingOver ? <TakeOverSheet view={view} onClose={() => setTakingOver(false)} /> : null}
    </EventDesk>
  );

  /** What a record opens: the phone's own door for each — a cost's card, a settle-up's sheet, a transfer's receipt. */
  function open(item: DayItem): (() => void) | undefined {
    if (item.kind === 'transfer') {
      const id = item.transfer.transactionId;
      if (!id) return undefined;
      return () => (openReceipt ? openReceipt(id) : void navigate({ to: '/transactions/$transactionId', params: { transactionId: id } }));
    }
    if (item.kind === 'settlement') return !locked && settlementDeletable(item.settlement, view) ? () => setOpened(item.settlement) : undefined;
    const e = item.expense;
    return e.voided || locked ? undefined : () => void navigate({ to: '/transactions/new', search: { event: view.eventId, expense: e.expenseId } });
  }
}

const recordKey = (item: DayItem) => (item.kind === 'expense' ? item.expense.expenseId : item.kind === 'settlement' ? item.settlement.settlementId : `transfer-${item.transfer.transferId}`);

/** A person's initials in a small round chip: dark for this phone's person, grey for the others. */
function Initials({ text, me }: { text: string; me: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold',
        me ? 'bg-[var(--mk-ink)] text-[var(--mk-page)]' : 'bg-[var(--mk-pill-hover)] text-[var(--mk-ink-2)]',
      )}
    >
      {text}
    </span>
  );
}

/** One record of the trip in the table: a cost, a settle-up or a transfer listed on it, read as the phone's day card reads it. */
function SharedRecordRow({
  date,
  item,
  view,
  mark,
  onOpen,
}: {
  date: string;
  item: DayItem;
  view: SharedEventView;
  mark: (key: string | null) => ReactNode;
  onOpen: (() => void) | undefined;
}) {
  const today = isoDate();
  let note: ReactNode;
  let category: ReactNode;
  let paid: ReactNode = null;
  let amount: string;
  let extra: string | null = null;
  let testId: string;
  let grey = false;
  if (item.kind === 'expense') {
    const e = item.expense;
    const row = expenseRow(e, view);
    const payer = view.people.find((person) => person.personId === e.payerPersonId);
    testId = 'shared-expense-row';
    note = (
      <>
        <span className="block truncate">{e.note?.trim() || row.title}</span>
        {row.flags.length > 0 && <span className="block truncate text-[12px] text-[var(--mk-ink-2)]">{row.flags.join(' · ')}</span>}
      </>
    );
    category = (
      <span className="flex min-w-0 items-center gap-[6px]">
        {mark(e.categoryId)}
        <span className="truncate">{row.title}</span>
      </span>
    );
    const account = payer?.isMe ? (e.posting?.accountName ?? null) : null;
    paid = (
      <span className="flex min-w-0 items-center gap-[6px]">
        <span aria-hidden className={cx('inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold', payer?.isMe ? 'bg-[var(--mk-ink)] text-[var(--mk-page)]' : 'bg-[var(--mk-pill-hover)] text-[var(--mk-ink-2)]')}>
          {payer?.initials ?? '?'}
        </span>
        <span className="truncate">{account ?? e.payerName}</span>
      </span>
    );
    amount = row.amount;
    extra = row.share;
    grey = e.voided;
  } else if (item.kind === 'settlement') {
    const row = settlementRow(item.settlement, view);
    testId = 'shared-settlement-row';
    note = (
      <>
        <span className="block truncate">{row.title}</span>
        {row.flags.length > 0 && <span className="block truncate text-[11.5px] text-[var(--ph-ink-3)]">{row.flags.join(' · ')}</span>}
      </>
    );
    category = (
      <span className="flex min-w-0 items-center gap-[6px]">
        <MarkChip Glyph={HandCoins} colour="var(--ph-tint)" size="xs" />
        <span className="truncate">Settle up</span>
      </span>
    );
    amount = row.amount;
  } else {
    const row = transferRow(item.transfer);
    testId = 'shared-transfer-row';
    note = (
      <>
        <span className="block truncate">{row.title}</span>
        <span className="block truncate text-[11.5px] text-[var(--ph-ink-3)]">{row.subtitle}</span>
      </>
    );
    category = (
      <span className="flex min-w-0 items-center gap-[6px]">
        <MarkChip Glyph={ArrowLeftRight} colour="var(--ph-ink-3)" size="xs" />
        <span className="truncate">Transfer</span>
      </span>
    );
    amount = row.amount;
    grey = true;
  }
  return (
    <tr
      data-testid={testId}
      onClick={onOpen}
      title={onOpen ? 'Click to open it' : undefined}
      className={cx('select-none', onOpen ? 'cursor-pointer hover:bg-[var(--mk-hover)]' : 'cursor-default', grey ? 'text-[var(--mk-ink-3)]' : 'text-[var(--mk-ink)]')}
    >
      <td className={cx(TD, 'pl-[14px] text-[var(--mk-ink-2)] tabular-nums')}>{shortDate(date, today)}</td>
      <td className={TD}>{note}</td>
      <td className={TD}>{category}</td>
      <td className={cx(TD, 'text-[var(--mk-ink-2)]')}>{paid}</td>
      <td className={cx(TD, 'pr-[14px] text-right whitespace-nowrap tabular-nums')}>
        <span className="font-semibold">{amount}</span>
        {extra && <span className="ml-[6px] text-[12px] text-[var(--mk-ink-2)]">{extra}</span>}
      </td>
    </tr>
  );
}
