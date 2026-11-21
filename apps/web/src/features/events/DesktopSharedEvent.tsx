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
import { AddCostLink, BoxRow, EventDesk, EventTitleBar, PlanBox, PlanTable, TableTabs, TD, TH } from './DeskEventParts';
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

  const planBox = showPlan && planData && planTotals && planData.itemCount > 0;
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
      <div className="@container space-y-[14px] px-[20px] py-[16px]">
        <ErrorBox error={plan.error} />
        {locked ? null : <FinishSharing view={view} />}
        {readOnly && (
          <p data-testid="shared-event-read-only" className="rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] px-[14px] py-[9px] text-[13px] text-[var(--ph-ink-2)]">
            {readOnlyLine(view)}
          </p>
        )}
        {waiting && !readOnly && (
          <button
            type="button"
            data-testid="take-over-row"
            onClick={() => setTakingOver(true)}
            className="flex w-full items-center justify-between rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] px-[14px] py-[9px] text-left text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
          >
            <span>
              {waiting} <span className="text-[var(--ph-ink-3)]">· Choose the account for each</span>
            </span>
            <span aria-hidden className="text-[var(--ph-chevron)]">
              ›
            </span>
          </button>
        )}
        <div className={cx('grid items-stretch gap-[14px]', grid)}>
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
                <div className="px-[10px] pt-[4px] pb-[10px]">
                  {view.payments.length === 0 ? (
                    <p data-testid="split-settled" className="px-[4px] py-[4px] text-[12.5px] text-[var(--ph-ink-3)]">
                      Nobody owes anything.
                    </p>
                  ) : (
                    view.payments.map((p) => (
                      <div
                        key={`${p.fromPersonId}-${p.toPersonId}`}
                        data-testid="shared-payment-row"
                        className="mt-[6px] flex items-center justify-between gap-[10px] rounded-[8px] bg-[var(--ph-warn-panel)] px-[10px] py-[7px] text-[13px] text-[var(--ph-warn-ink)]"
                      >
                        <span className="min-w-0 font-medium">{paymentLine(p, view.currency)}</span>
                        {offerSettle(p) && !locked && (
                          <button
                            type="button"
                            aria-label={`Settle up: ${paymentLine(p, view.currency)}`}
                            onClick={() => setSettling(p)}
                            className="shrink-0 rounded-[6px] border border-current bg-[var(--ph-surface)] px-[8px] py-[2px] text-[12px] font-medium"
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
          <div className="flex items-center gap-[10px] px-[14px] py-[9px]">
            <TableTabs
              value={showPlan ? table : 'transactions'}
              onChange={setTable}
              tabs={[
                { key: 'transactions', label: `Transactions · ${allRecords}` },
                ...(showPlan ? [{ key: 'plan' as const, label: `Plan · ${planData?.itemCount ?? 0} ${planData?.itemCount === 1 ? 'cost' : 'costs'}` }] : []),
              ]}
            />
            {picked !== null && table === 'transactions' && (
              <span className="flex items-center gap-[6px] text-[12px] text-[var(--ph-ink-2)]">
                <span data-testid="event-filter">Only {slices.find((slice) => slice.key === picked)?.label ?? 'one category'}</span>
                <button type="button" onClick={() => setPicked(null)} className="text-[var(--mac-accent)] hover:underline">
                  Show all
                </button>
              </span>
            )}
            <span className="flex-1" />
            <span className={NOTE}>{table === 'plan' ? 'click a cost to change it on every phone' : 'click a row to open it'}</span>
          </div>
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
            <p className="border-t border-[var(--ph-hair)] px-[14px] py-[12px] text-[13px] text-[var(--ph-ink-3)]">Nothing recorded on the trip yet.</p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[13px]" data-testid="event-transactions">
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
                {records.map(({ date, item }, index) => (
                  <SharedRecordRow
                    key={recordKey(item)}
                    date={date}
                    item={item}
                    view={view}
                    zebra={index % 2 === 1}
                    mark={mark}
                    onOpen={open(item)}
                  />
                ))}
              </tbody>
            </table>
          )}
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
        me ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]',
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
  zebra,
  mark,
  onOpen,
}: {
  date: string;
  item: DayItem;
  view: SharedEventView;
  zebra: boolean;
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
        {row.flags.length > 0 && <span className="block truncate text-[11.5px] text-[var(--ph-ink-3)]">{row.flags.join(' · ')}</span>}
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
        <span aria-hidden className={cx('inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold', payer?.isMe ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]')}>
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
      className={cx('select-none', onOpen ? 'cursor-pointer hover:bg-[var(--ph-fill)]' : 'cursor-default', zebra && 'bg-[var(--mac-zebra)]', grey ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}
    >
      <td className={cx(TD, 'pl-[14px] text-[var(--ph-ink-3)] tabular-nums')}>{shortDate(date, today)}</td>
      <td className={TD}>{note}</td>
      <td className={TD}>{category}</td>
      <td className={cx(TD, 'text-[var(--ph-ink-2)]')}>{paid}</td>
      <td className={cx(TD, 'pr-[14px] text-right whitespace-nowrap tabular-nums')}>
        <span className="font-semibold">{amount}</span>
        {extra && <span className="ml-[6px] text-[11.5px] text-[var(--ph-ink-3)]">{extra}</span>}
      </td>
    </tr>
  );
}
