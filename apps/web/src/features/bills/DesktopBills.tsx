import { addMonths, BILL_DUE_SOON_DAYS, dayMonth, daysFrom, formatMinor, isoDate, monthName, ordinal, periodMonthOf } from '@expanses/core';
import { type MonthlyBill, undoBillPayments } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { CalendarClock, Check, ChevronLeft, ChevronRight, CreditCard } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { compactMoney } from '../../app/sidebar-model';
import { useAccounts, useInvalidateAll, useIsBookShared, useMemberPayers } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { toneClass } from '../../ui/native';
import { type ToastIcon, UndoToast } from '../../ui/UndoToast';
import { feeDateText } from '../cards/fee-line';
import { type DueFee, useUpcomingFees } from '../cards/fee-due';
import { CategoryIcon } from '../categories/CategoryIcon';
import { GoalsThisMonth } from '../goals/GoalDues';
import { useAllPlanInstalments, useInstallments } from '../loans/queries';
import { bareFigure } from '../networth/debt-rows';
import { usePurchasePayers } from '../sharing/queries';
import { BOX, NOTE } from '../transactions/CashflowBoxes';
import { useMonthStart } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { amountOf, billAccountName, billCurrencyOf, billsInReadCurrency, isPaused, isSettled, isToPay, paidText } from './bill-view';
import { BillPeek, type PeekToast } from './BillPeek';
import {
  barMonths,
  barScale,
  billsOn,
  calendarWeeks,
  type DayMark,
  dayMarks,
  deskGroups,
  deskStatus,
  dueOf,
  type MonthBar,
  type MonthBox,
  monthBarOf,
  monthBoxOf,
  pickedTotal,
  countedNote,
  trendCaption,
} from './bills-desk-model';
import { instalmentLines, type InstalmentLine } from './instalment-rows';
import { MonthlyBuys } from './MonthlyBuys';
import { PaySeveralSheet } from './PaySeveralSheet';
import { useBillMoney, useBillsInMonths, useMonthlyBills, useSinkingFunds } from './queries';
import { setAsideOf } from './set-aside';

/** How long after a peek opens the page makes room for it: longer than a double-click's gap. */
const ROOM_DELAY_MS = 350;

const GBTN =
  'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';
const PBTN = 'inline-flex h-[26px] items-center rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)]';
const STEP = 'flex h-[24px] w-[22px] items-center justify-center rounded text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]';
const H2 = 'flex items-baseline justify-between gap-[10px] px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]';

/** The calendar's marks: orange for late or due soon, grey for later, a hollow ring for paid. */
const MARK: Record<DayMark, string> = {
  soon: 'bg-[var(--ph-warn)]',
  later: 'bg-[var(--ph-ink-3)]',
  paid: 'ring-1 ring-[var(--ph-ink-3)] ring-inset',
};

/** A card fee's Status: "In 20 days", as a bill's reads. */
const feeStatus = (on: string, today: string) => {
  const left = daysFrom(today, on);
  return left <= 0 ? 'Charged today' : `In ${left} ${left === 1 ? 'day' : 'days'}`;
};
/** A box's own width, followed as it changes (the peek opening, the window resized): what the table and the bars lay out by. */
function useWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.current.observe(node);
  }, []);
  return [ref, width];
}

const monthLabel = (month: string) => `${monthName(month, 'long')} ${month.slice(0, 4)}`;
const weekday = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
  });

/** A table figure: bare in the reading money ("8.400.000"), with its symbol in any other. */
const figure = (minor: number, currency: string, readCurrency: string) => (currency === readCurrency ? bareFigure(minor, currency) : formatMinor(minor, currency));

/**
 * Bills on a wide screen (Mac Bills, "List + calendar together", owner 2026-11-17): a title bar with the month, Yearly
 * bills and New bill; on the left a month calendar whose days carry the bills' marks and the bars of bills each month;
 * on the right the month's box, what is set aside for yearly bills, and every bill in one table grouped as the phone
 * groups them. Ticks pay several at once through the phone's own sheet; a row opens the bill in a side peek. The phone's
 * Recurring is not this page — `RecurringPage` draws it as before.
 */
export function DesktopBills() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const monthStart = useMonthStart();
  const current = periodMonthOf(today, monthStart);
  const [month, setMonthState] = useState(current);
  const isCurrent = month === current;
  const accounts = useAccounts().data ?? [];

  // This month's rows are the phone's own (last month's unpaid bill included, as there); any other month's are read for it.
  const live = useMonthlyBills(today);
  const bars = barMonths(month);
  const others = bars.filter((m) => m !== current);
  const read = useBillsInMonths(others, today);
  const rowsOf = (m: string): MonthlyBill[] | undefined => (m === current ? live.data : read.data?.[m]);
  const rows = rowsOf(month) ?? [];
  const loaded = rowsOf(month) !== undefined;

  const payerOf = usePurchasePayers(
    rows.flatMap((bill) => (bill.paymentId ? [bill.paymentId] : [])),
    useIsBookShared(),
  );
  const memberPayers = useMemberPayers().data;
  const money = useBillMoney().data;
  const readCurrency = money?.currency ?? ws.baseCurrency;
  const currencyOf = (bill: MonthlyBill) => billCurrencyOf(bill, accounts, ws.baseCurrency);
  const inRead = (list: readonly MonthlyBill[]) => billsInReadCurrency(list, money, currencyOf);
  const { rows: readRows, unconverted } = inRead(rows);
  const box = monthBoxOf(readRows, today, monthStart);
  const monthBars = bars.flatMap((m) => {
    const list = rowsOf(m);
    return list ? [monthBarOf(m, inRead(list).rows, current, today, monthStart)] : [];
  });

  const funds = useSinkingFunds(today).data ?? [];
  const convertFund = money?.converts ? money.convert : money?.convertForeign;
  const setAside = setAsideOf(funds, readCurrency, convertFund && ((minor, from) => convertFund(minor, from, today)));
  const fees = useUpcomingFees(today);
  const plans = useInstallments();
  const planStatuses = useAllPlanInstalments(today);
  const instalments = isCurrent ? instalmentLines(plans.data ?? [], accounts, ws.baseCurrency, today, planStatuses.data ?? {}) : [];
  const shownFees = isCurrent ? fees : [];

  const groups = deskGroups(rows, month, isCurrent, today);
  // The table's columns go by the room its box has: Paid with first, then Category, step aside rather than squeeze.
  const [tableRef, tableWidth] = useWidth<HTMLElement>();
  const cols: Columns = {
    category: tableWidth === 0 || tableWidth >= 540,
    paidWith: tableWidth === 0 || tableWidth >= 680,
  };
  const span = 5 + Number(cols.category) + Number(cols.paidWith);
  const tableIds = groups.flatMap((group) => group.rows.map((bill) => bill.id));

  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [payingSeveral, setPayingSeveral] = useState(false);
  const [toast, setToast] = useState<{
    text: string;
    icon: ToastIcon;
    undo: () => Promise<void>;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const closeSeveral = useCallback(() => setPayingSeveral(false), []);

  const setMonth = (next: string) => {
    setMonthState(next);
    setDay(null);
    setPicked(new Set());
  };
  // Only this month's bills still to pay take a tick: the phone's Pay several pays the months its list holds.
  const tickable = (bill: MonthlyBill) => isCurrent && isToPay(bill);
  const toggle = (bill: MonthlyBill) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(bill.id)) next.delete(bill.id);
      else next.add(bill.id);
      return next;
    });
  const chosen = pickedTotal(readRows, picked);

  // The side peek: which bill it shows, stepped through the table's order.
  const [peekId, setPeekId] = useState<string | null>(null);
  const step = (by: -1 | 1) => {
    if (!peekId) return;
    const at = tableIds.indexOf(peekId);
    const next = at < 0 ? undefined : tableIds[Math.min(tableIds.length - 1, Math.max(0, at + by))];
    if (next) setPeekId(next);
  };
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);
  const peeking = peekId !== null;
  // The page makes room for the peek a moment after it opens, not at once: a double-click on a row (its page) lands both
  // clicks on the row before the table moves; a single click sees the peek straight away, over the page for that moment.
  const [room, setRoom] = useState(false);
  useEffect(() => {
    if (!peeking) return setRoom(false);
    const timer = window.setTimeout(() => setRoom(true), ROOM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [peeking]);
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

  // Keys while the peek is open: Esc closes it, ↑ ↓ step — never while typing, or under a sheet.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (!peekId) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (event.key === 'Escape') setPeekId(null);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'ArrowDown') step(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  async function undo() {
    if (!toast) return;
    const t = toast;
    setToast(null);
    try {
      await t.undo();
    } catch (e) {
      setError(e);
    }
    await invalidate();
  }
  const onToast = useCallback((t: PeekToast) => setToast(t), []);
  const openFee = (fee: DueFee) =>
    void navigate({
      to: '/cards/$cardId/settings/fee-waiver',
      params: { cardId: fee.cardId },
    });
  const accountNameOf = (bill: MonthlyBill) => billAccountName(bill, accounts, bill.paymentId ? payerOf(bill.paymentId) : null, memberPayers);

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="bills-page" data-desk="true">
      <header ref={bar} className="sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Bills</h1>
        <span className="flex-1" />
        <div className="flex items-center gap-[2px] text-[13px] text-[var(--ph-ink)]">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className={STEP}>
            <ChevronLeft size={15} aria-hidden />
          </button>
          <span data-testid="bills-month" className="px-1 whitespace-nowrap tabular-nums">
            {monthLabel(month)}
          </span>
          <button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className={STEP}>
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
        <button type="button" onClick={() => void navigate({ to: '/bills/yearly' })} className={GBTN}>
          Yearly bills
        </button>
        <button type="button" onClick={() => void navigate({ to: '/bills/new' })} className={PBTN}>
          ＋ New bill
        </button>
      </header>

      {/*
       * The peek makes room on the whole page, so it covers no figure. The page goes by the room it has (a container
       * query): wide, the calendar and the bars in a column on the left; narrower (the peek open on a smaller window),
       * the two side by side on top and everything else under them.
       */}
      <div className={cx('@container px-[20px] py-[16px]', room && 'mr-[322px]')}>
        <ErrorBox error={error ?? live.error ?? read.error} />
        <Unconverted missing={unconverted} currency={readCurrency} />
        <div className="grid grid-cols-1 items-start gap-[14px] @min-[900px]:grid-cols-[270px_minmax(0,1fr)]">
          <div className="grid grid-cols-1 items-start gap-[14px] @min-[560px]:grid-cols-[270px_minmax(0,1fr)] @min-[900px]:grid-cols-1">
            <CalendarBox month={month} today={today} rows={rows} day={day} onDay={setDay} onMonth={setMonth} currencyOf={currencyOf} />
            <BarsBox bars={monthBars} currency={readCurrency} />
          </div>
          <div className="min-w-0 space-y-[14px]">
            <div className="grid grid-cols-1 items-stretch gap-[14px] @min-[560px]:grid-cols-2">
              <MonthBoxView month={month} box={box} loaded={loaded} empty={rows.length === 0} monthStart={monthStart} currency={readCurrency} />
              <SetAsideBox funds={funds} setAside={setAside} currency={readCurrency} onOpen={setPeekId} />
            </div>
            <section ref={tableRef} className={cx(BOX, 'overflow-clip')} aria-label="All bills" data-testid="all-bills">
              <h2 className={H2}>
                All bills
                <span className={NOTE}>Click a day to find its bills · tick to pay several</span>
              </h2>
              <div className="border-t border-[var(--ph-hair)]">
                <table className="w-full table-fixed border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-[var(--mac-head)] text-left text-[11px] font-semibold text-[var(--ph-ink-3)]">
                      <th className="w-[34px] border-b border-[var(--ph-hair)] py-[7px]">
                        <span className="sr-only">Tick</span>
                      </th>
                      <th className="border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold">Bill</th>
                      {cols.category && <th className="w-[132px] border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold">Category</th>}
                      <th className="w-[62px] border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold">Due</th>
                      <th className="w-[104px] border-b border-[var(--ph-hair)] px-[8px] py-[7px] text-right font-semibold">Amount</th>
                      {cols.paidWith && <th className="w-[120px] border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold">Paid with</th>}
                      <th className="w-[140px] border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold">Status</th>
                    </tr>
                  </thead>
                  {loaded && rows.length === 0 && shownFees.length === 0 && instalments.length === 0 && (
                    <tbody>
                      <tr>
                        <td colSpan={span} className="px-3 py-6 text-center text-[13px] text-[var(--ph-ink-3)]">
                          No bills in {monthName(month, 'long')}.{' '}
                          <button type="button" onClick={() => void navigate({ to: '/bills/new' })} className="text-[var(--mac-accent)] hover:underline">
                            New bill
                          </button>{' '}
                          sets one up.
                        </td>
                      </tr>
                    </tbody>
                  )}
                  {(() => {
                    let index = 0;
                    return groups.map((group) => (
                      <tbody key={group.key} data-testid={`bills-${group.key === 'dueSoon' ? 'due-soon' : group.key}`}>
                        <GroupHead title={group.title} span={span} />
                        {group.rows.map((bill) => (
                          <BillTableRow
                            key={bill.id}
                            cols={cols}
                            bill={bill}
                            today={today}
                            striped={index++ % 2 === 1}
                            accounts={accounts}
                            accountName={accountNameOf(bill)}
                            note={countedNote(bill, month)}
                            currency={currencyOf(bill)}
                            readCurrency={readCurrency}
                            tickable={tickable(bill)}
                            picked={picked.has(bill.id)}
                            onDay={day !== null && dueOf(bill) === day}
                            peeked={peekId === bill.id}
                            onToggle={() => toggle(bill)}
                            onPeek={() => setPeekId(bill.id)}
                            onOpen={() =>
                              void navigate({
                                to: '/bills/$billId',
                                params: { billId: bill.id },
                              })
                            }
                          />
                        ))}
                      </tbody>
                    ));
                  })()}
                  {/* A card's annual fee: read-only and in no total, so never under Due soon — a group of its own. */}
                  {shownFees.length > 0 && (
                    <tbody data-testid="bills-card-fees">
                      <GroupHead title="Card fees" span={span} />
                      {shownFees.map((fee, i) => (
                        <FeeTableRow
                          key={fee.card.cardId}
                          cols={cols}
                          fee={fee.card}
                          on={fee.on}
                          today={today}
                          readCurrency={readCurrency}
                          striped={i % 2 === 1}
                          onOpen={() => openFee(fee.card)}
                        />
                      ))}
                    </tbody>
                  )}
                  {instalments.length > 0 && (
                    <tbody data-testid="monthly-instalments">
                      <GroupHead title="Instalments" span={span} />
                      {instalments.map((line, i) => (
                        <InstalmentTableRow
                          key={line.id}
                          cols={cols}
                          line={line}
                          readCurrency={readCurrency}
                          striped={i % 2 === 1}
                          onOpen={() =>
                            void navigate({
                              to: '/cards/$cardId/settings/instalments',
                              params: { cardId: line.cardId },
                            })
                          }
                        />
                      ))}
                    </tbody>
                  )}
                </table>
              </div>
              {picked.size > 0 && (
                <div
                  role="toolbar"
                  aria-label="Selected bills"
                  data-testid="select-bar"
                  className="sticky bottom-0 z-[1] flex items-center gap-[10px] border-t border-[var(--ph-hair)] bg-[var(--ph-surface)] bg-[linear-gradient(var(--mac-accent-wash),var(--mac-accent-wash))] px-[14px] py-[8px] text-[13px]"
                >
                  <span className="font-semibold text-[var(--ph-ink)]">{picked.size} selected</span>
                  <span className="text-[var(--ph-ink-3)] tabular-nums" data-testid="select-total">
                    {chosen.approximate && '~'}
                    {formatMinor(chosen.minor, readCurrency)}
                  </span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => setPicked(new Set())} className={GBTN}>
                    Clear
                  </button>
                  <button type="button" onClick={() => setPayingSeveral(true)} className={PBTN}>
                    Pay {picked.size} {picked.size === 1 ? 'bill' : 'bills'}
                  </button>
                </div>
              )}
            </section>
            {/* The phone's other parts of the month: goals whose monthly comes due like a bill, and the regular buys. */}
            {isCurrent && (
              <div className="max-w-2xl">
                <GoalsThisMonth onToast={setToast} />
                <MonthlyBuys />
              </div>
            )}
          </div>
        </div>
      </div>

      {peekId && (
        <BillPeek
          key={peekId}
          billId={peekId}
          top={peekTop}
          first={tableIds.indexOf(peekId) <= 0}
          last={tableIds.indexOf(peekId) === -1 || tableIds.indexOf(peekId) === tableIds.length - 1}
          onStep={step}
          onClose={() => setPeekId(null)}
          onToast={onToast}
        />
      )}

      {toast && <UndoToast icon={toast.icon} text={toast.text} onUndo={() => void undo()} onDone={clearToast} />}

      {payingSeveral && (
        <PaySeveralSheet
          bills={rows.filter(isToPay)}
          picked={picked}
          today={today}
          onClose={closeSeveral}
          onPaid={(ids, names) => {
            setPayingSeveral(false);
            setPicked(new Set());
            setToast({
              icon: 'paid',
              text: paidText(names),
              undo: () => undoBillPayments(database, ws, ids),
            });
          }}
        />
      )}
    </div>
  );
}

function GroupHead({ title, span }: { title: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className="bg-[var(--ph-surface)] px-[10px] pt-[12px] pb-[4px] text-[11px] font-semibold tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">
        {title}
      </td>
    </tr>
  );
}

/** The month's calendar, Mac Calendar's sidebar style: today ringed, a mark under each day a bill is due, a day picked out. */
function CalendarBox({
  month,
  today,
  rows,
  day,
  onDay,
  onMonth,
  currencyOf,
}: {
  month: string;
  today: string;
  rows: readonly MonthlyBill[];
  day: string | null;
  onDay: (day: string | null) => void;
  onMonth: (month: string) => void;
  currencyOf: (bill: MonthlyBill) => string;
}) {
  const marks = dayMarks(rows, today);
  const onIt = day ? billsOn(rows, day) : [];
  return (
    <section className={BOX} aria-label="Calendar" data-testid="bills-calendar">
      <h2 className={H2}>
        {monthName(month, 'long')}
        <span className="flex items-center gap-[2px]">
          <button type="button" aria-label="Calendar: month before" onClick={() => onMonth(addMonths(month, -1))} className={STEP}>
            <ChevronLeft size={14} aria-hidden />
          </button>
          <button type="button" aria-label="Calendar: month after" onClick={() => onMonth(addMonths(month, 1))} className={STEP}>
            <ChevronRight size={14} aria-hidden />
          </button>
        </span>
      </h2>
      <div role="grid" aria-label={`${monthLabel(month)}`} className="px-[10px] pb-[8px]">
        <div role="row" className="grid grid-cols-7">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} role="columnheader" className="py-[2px] text-center text-[10px] text-[var(--ph-ink-3)]">
              {d}
            </span>
          ))}
        </div>
        {calendarWeeks(month).map((week) => (
          <div role="row" key={week[0]!.date} className="grid grid-cols-7">
            {week.map((cell) => {
              const mark = marks.get(cell.date);
              const chosen = day === cell.date;
              const isToday = cell.date === today;
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  aria-selected={chosen}
                  aria-label={`${dayMonth(cell.date)}${mark ? (mark === 'paid' ? ', bills paid' : ', bills due') : ''}`}
                  data-date={cell.date}
                  data-mark={mark ?? undefined}
                  onClick={() => onDay(chosen ? null : cell.date)}
                  className="flex flex-col items-center py-[3px]"
                >
                  <span
                    className={cx(
                      'flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] tabular-nums',
                      chosen
                        ? 'bg-[var(--mac-accent)] font-semibold text-white'
                        : isToday
                          ? 'text-[var(--mac-accent)] ring-1 ring-[var(--mac-accent)]'
                          : cell.inMonth
                            ? 'text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]'
                            : 'text-[var(--ph-chevron)] hover:bg-[var(--ph-fill)]',
                    )}
                  >
                    {cell.day}
                  </span>
                  <span aria-hidden className={cx('mt-[2px] block h-[5px] w-[5px] rounded-full', mark ? MARK[mark] : 'invisible')} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {day && (
        <div className="border-t border-[var(--ph-hair)] px-[14px] pt-[8px] pb-[10px] text-[12px]" data-testid="calendar-day">
          <div className="mb-[4px] font-semibold text-[var(--ph-ink)]">
            {weekday(day)}, {dayMonth(day)}
          </div>
          {onIt.length === 0 && <div className="text-[var(--ph-ink-3)]">No bills due</div>}
          {onIt.map((bill) => (
            <div key={bill.id} className={cx('flex justify-between gap-2', (isSettled(bill) || isPaused(bill)) && 'text-[var(--ph-ink-3)]')}>
              <span className="min-w-0 truncate">{bill.name}</span>
              <span className="shrink-0 tabular-nums">
                {bill.amountMinor === null && bill.state !== 'paid' && '~'}
                {formatMinor(bill.state === 'paid' ? (bill.paidMinor ?? 0) : amountOf(bill), bill.state === 'paid' ? (bill.paidCurrency ?? currencyOf(bill)) : currencyOf(bill))}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className={cx('flex flex-wrap gap-x-[10px] gap-y-[2px] px-[14px] pb-[10px] text-[11px] text-[var(--ph-ink-3)]', !day && 'border-t border-[var(--ph-hair)] pt-[8px]')}>
        <span className="inline-flex items-center gap-[4px]">
          <i className={cx('block h-[6px] w-[6px] rounded-full', MARK.soon)} /> late or due soon
        </span>
        <span className="inline-flex items-center gap-[4px]">
          <i className={cx('block h-[6px] w-[6px] rounded-full', MARK.later)} /> later
        </span>
        <span className="inline-flex items-center gap-[4px]">
          <i className={cx('block h-[6px] w-[6px] rounded-full', MARK.paid)} /> paid
        </span>
      </div>
    </section>
  );
}

/** Bills each month: five months paid, then the month shown, hatched while it is still to come (paid and to pay). */
function BarsBox({ bars, currency }: { bars: readonly MonthBar[]; currency: string }) {
  const max = Math.max(1, ...bars.map((b) => b.minor));
  const scale = barScale(max, currency);
  const caption = trendCaption(bars, currency);
  const [ref, measured] = useWidth<HTMLDivElement>();
  // Drawn at the box's own width, so its words stay the size of the page's and the bars spread rather than grow.
  const W = Math.max(200, measured || 240);
  const top = 14;
  const bottom = 104;
  const slot = W / Math.max(6, bars.length);
  const barWidth = Math.min(slot * 0.64, 30);
  return (
    <section className={BOX} aria-label="Bills each month" data-testid="bills-each-month">
      <h2 className={H2}>
        Bills each month
        <span className={NOTE}>{scale.unit}</span>
      </h2>
      <div className="px-[12px] pb-[10px]">
        <div ref={ref}>
          <svg width={W} height={bottom + 16} viewBox={`0 0 ${W} ${bottom + 16}`} className="block" role="img" aria-label="Bills paid each month, with the month shown expected">
            <defs>
              <pattern id="bills-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--ov-expected-fill)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ov-expected-line)" strokeWidth="2" />
              </pattern>
            </defs>
            {bars.map((b, i) => {
              const h = (b.minor / max) * (bottom - top);
              const w = barWidth;
              const x = slot * i + (slot - w) / 2;
              return (
                <g key={b.month} data-testid="bills-bar" data-month={b.month} data-minor={b.minor}>
                  {h > 0 && (
                    <rect x={x} y={bottom - h} width={w} height={h} rx="3" fill={b.expected ? 'url(#bills-hatch)' : 'var(--ph-up)'} stroke={b.expected ? 'var(--ov-expected-line)' : 'none'}>
                      <title>{`${monthLabel(b.month)}: ${b.expected ? 'expected' : 'paid'} ${formatMinor(b.minor, currency)}`}</title>
                    </rect>
                  )}
                  {b.minor > 0 && (
                    <text x={x + w / 2} y={bottom - h - 4} textAnchor="middle" fontSize="9.5" fill="var(--ph-ink)">
                      {scale.label(b.minor)}
                    </text>
                  )}
                  <text x={x + w / 2} y={bottom + 12} textAnchor="middle" fontSize="10" fill="var(--ph-ink-3)">
                    {monthName(b.month, 'short')}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        {caption && (
          <div className="mt-[2px] text-[11.5px] text-[var(--ph-ink-3)]" data-testid="bills-trend">
            {caption}
          </div>
        )}
      </div>
    </section>
  );
}

/** The month's box: what is left to pay, a bar of what is paid, and "Paid Rp x of Rp y · n of m". */
function MonthBoxView({ month, box, loaded, empty, monthStart, currency }: { month: string; box: MonthBox; loaded: boolean; empty: boolean; monthStart: number; currency: string }) {
  const name = monthName(month, 'long');
  let body: ReactNode;
  if (!loaded) body = null;
  else if (empty) body = <p className="px-[14px] pb-[12px] text-[15px] font-semibold text-[var(--ph-ink-2)]">No monthly bills in {name}</p>;
  else if (box.allPaused) body = <p className="px-[14px] pb-[12px] text-[15px] font-semibold text-[var(--ph-ink-2)]">Nothing to pay in {name}</p>;
  else
    body = (
      <>
        <div className="px-[14px]">
          {box.allPaid ? (
            <p data-testid="bills-total" className="text-[20px] leading-[30px] font-semibold text-[var(--ph-up)]">
              All paid for {name} <span aria-hidden>✓</span>
            </p>
          ) : (
            <p className="flex flex-wrap items-baseline gap-x-[6px]">
              <span data-testid="bills-total" className="text-[24px] leading-[30px] font-semibold text-[var(--ph-ink)] tabular-nums">
                {box.approximate && <span className="text-[var(--ph-ink-3)]">≈ </span>}
                {formatMinor(box.leftMinor, currency)}
              </span>
              <span className="text-[12px] text-[var(--ph-ink-3)]">left to pay</span>
            </p>
          )}
        </div>
        <div aria-hidden className="mx-[14px] mt-[10px] mb-[8px] h-[6px] overflow-hidden rounded-full bg-[var(--ph-track)]">
          <div
            className="h-full rounded-full bg-[var(--ph-up)]"
            style={{
              width: `${box.totalMinor > 0 ? (box.paidMinor / box.totalMinor) * 100 : 0}%`,
            }}
          />
        </div>
        <p data-testid="bills-month-total" className="px-[14px] pb-[12px] text-[12.5px] text-[var(--ph-ink-3)] tabular-nums">
          Paid {formatMinor(box.paidMinor, currency)} of {formatMinor(box.totalMinor, currency)} · {box.paidCount} of {box.count}
        </p>
      </>
    );
  return (
    <section className={BOX} aria-label={`${name} bills`} data-testid="bills-summary">
      <h2 className={H2}>
        {name}
        <span className={NOTE}>month starts on the {ordinal(monthStart)}</span>
      </h2>
      {body}
    </section>
  );
}

/** What the yearly bills' sinking funds hold: each fund's name and month, saved of its target. */
function SetAsideBox({
  funds,
  setAside,
  currency,
  onOpen,
}: {
  funds: readonly {
    billId: string;
    name: string;
    dueMonth: string;
    savedMinor: number;
    targetMinor: number;
    currency: string;
  }[];
  setAside: { monthlyMinor: number; approximate: boolean };
  currency: string;
  onOpen: (billId: string) => void;
}) {
  return (
    <section className={BOX} aria-label="Set aside for yearly bills" data-testid="bills-set-aside">
      <h2 className={H2}>
        Set aside for yearly bills
        {funds.length > 0 && (
          <span className={NOTE}>
            {setAside.approximate && '~'}
            {formatMinor(setAside.monthlyMinor, currency)} a month
          </span>
        )}
      </h2>
      {funds.length === 0 && <p className="px-[14px] pb-[12px] text-[12.5px] text-[var(--ph-ink-3)]">Nothing set aside yet. A yearly bill can save up for itself each month (Edit bill).</p>}
      <ul className="pb-[4px]">
        {funds.map((fund) => (
          <li key={fund.billId} className="border-t border-[var(--ph-hair)] first:border-t-0">
            <button
              type="button"
              data-testid="set-aside-row"
              onClick={() => onOpen(fund.billId)}
              className="flex w-full items-baseline gap-[10px] px-[14px] py-[7px] text-left text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
            >
              <span className="min-w-0 flex-1 truncate">
                {fund.name} · {monthName(fund.dueMonth, 'short')}
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {formatMinor(fund.savedMinor, fund.currency)} <span className="text-[var(--ph-ink-3)]">of {compactMoney(fund.targetMinor, fund.currency)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TickCircle({ picked }: { picked: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('flex h-[15px] w-[15px] items-center justify-center rounded-full', picked ? 'bg-[var(--mac-accent)] text-white' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset')}
    >
      {picked && <Check size={10} strokeWidth={3} />}
    </span>
  );
}

const CELL = 'px-[8px] py-[5px] whitespace-nowrap';

/** Which of the columns that step aside the table has room for. */
interface Columns {
  category: boolean;
  paidWith: boolean;
}

/** One bill in the table: a tick, the bill, its category, due day, amount, account and where it stands. */
function BillTableRow({
  cols,
  bill,
  today,
  striped,
  accounts,
  accountName,
  note,
  currency,
  readCurrency,
  tickable,
  picked,
  onDay,
  peeked,
  onToggle,
  onPeek,
  onOpen,
}: {
  cols: Columns;
  bill: MonthlyBill;
  today: string;
  striped: boolean;
  accounts: Parameters<typeof CategoryIcon>[0]['accounts'];
  accountName: string;
  /** "due 5 Dec · counted in Nov" on a bill due after the month it counts in. */
  note: string | null;
  currency: string;
  readCurrency: string;
  tickable: boolean;
  picked: boolean;
  /** Due on the calendar's picked day. */
  onDay: boolean;
  peeked: boolean;
  onToggle: () => void;
  onPeek: () => void;
  onOpen: () => void;
}) {
  const status = deskStatus(bill, today);
  const done = isSettled(bill) || isPaused(bill);
  const category = accounts.find((a) => a.id === bill.categoryAccountId);
  return (
    <tr
      data-testid="bill-row"
      data-bill-id={bill.id}
      data-on-day={onDay || undefined}
      aria-current={peeked ? 'true' : undefined}
      onClick={onPeek}
      onDoubleClick={onOpen}
      className={cx('cursor-default text-[var(--ph-ink)]', onDay || picked ? 'bg-[var(--mac-accent-wash)]' : striped && 'bg-[var(--mac-zebra)]', peeked && 'shadow-[inset_3px_0_0_var(--mac-accent)]')}
    >
      <td className="py-[5px] pl-[10px]">
        {tickable ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={picked}
            aria-label={`Select ${bill.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="flex h-[20px] w-[20px] items-center justify-center rounded-full"
          >
            <TickCircle picked={picked} />
          </button>
        ) : (
          <span className="flex h-[20px] w-[20px] items-center justify-center opacity-40">
            <TickCircle picked={false} />
          </span>
        )}
      </td>
      <td className={cx(CELL, 'overflow-hidden', done && 'opacity-55')}>
        <button type="button" onClick={(event) => (event.stopPropagation(), onPeek())} title={bill.name} className="block max-w-full truncate text-left hover:underline">
          {bill.name}
        </button>
        {/* Under the name, wrapping rather than cut: why a bill due next month is counted in this one. */}
        {note && (
          <span data-testid="bill-counted-note" className="block text-[11px] leading-[14px] whitespace-normal text-[var(--ph-ink-3)]">
            {note}
          </span>
        )}
      </td>
      {cols.category && (
        <td className={cx(CELL, 'overflow-hidden text-[var(--ph-ink-3)]', done && 'opacity-55')}>
          <span className="flex min-w-0 items-center gap-[6px]">
            <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="xs" />
            <span className="truncate" title={category?.name}>
              {category?.name ?? ''}
            </span>
          </span>
        </td>
      )}
      <td className={cx(CELL, 'tabular-nums', done && 'opacity-55')}>{bill.state === 'paused' ? '—' : dayMonth(dueOf(bill))}</td>
      <td className={cx(CELL, 'text-right tabular-nums', done && 'opacity-55')} data-testid="bill-amount">
        {bill.state === 'paid' ? (
          figure(bill.paidMinor ?? 0, bill.paidCurrency ?? currency, readCurrency)
        ) : bill.amountMinor !== null ? (
          figure(bill.amountMinor, currency, readCurrency)
        ) : bill.estimateMinor !== null ? (
          <span className="text-[var(--ph-ink-3)]" title="Amount varies">
            ~{figure(bill.estimateMinor, currency, readCurrency)}
          </span>
        ) : (
          <span className="text-[var(--ph-ink-3)]">Amount varies</span>
        )}
      </td>
      {cols.paidWith && (
        <td className={cx(CELL, 'overflow-hidden text-ellipsis', done && 'opacity-55')} title={accountName}>
          {accountName}
        </td>
      )}
      <td className={cx(CELL, 'overflow-hidden text-ellipsis', toneClass(status.tone), done && 'opacity-70')} data-testid="bill-status" title={status.text}>
        {status.text}
      </td>
    </tr>
  );
}

/** A card's annual fee within the phone's 30 days, under Card fees: read-only, in no total. */
function FeeTableRow({
  cols,
  fee,
  on,
  today,
  readCurrency,
  striped,
  onOpen,
}: {
  cols: Columns;
  fee: DueFee;
  on: string | null;
  today: string;
  readCurrency: string;
  striped: boolean;
  onOpen: () => void;
}) {
  return (
    <tr data-testid="annual-fee-row" onClick={onOpen} className={cx('cursor-default text-[var(--ph-ink)]', striped && 'bg-[var(--mac-zebra)]')}>
      <td />
      <td className={cx(CELL, 'overflow-hidden text-ellipsis')}>Annual fee</td>
      {cols.category && (
        <td className={cx(CELL, 'text-[var(--ph-ink-3)]')}>
          <span className="flex items-center gap-[6px]">
            <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-2)]">
              <CreditCard size={11} />
            </span>
            Card fee
          </span>
        </td>
      )}
      <td className={cx(CELL, 'tabular-nums')}>{on ? dayMonth(on) : '—'}</td>
      <td className={cx(CELL, 'text-right tabular-nums')}>
        {fee.annualFeeMinor !== null ? figure(fee.annualFeeMinor, fee.currency, readCurrency) : <span className="text-[var(--ph-ink-3)]">Not set</span>}
      </td>
      {cols.paidWith && (
        <td className={cx(CELL, 'overflow-hidden text-ellipsis')} title={fee.name}>
          {fee.name}
        </td>
      )}
      {/* Orange only within Due soon's few days, as a bill's Status reads; further off, quiet. */}
      <td className={cx(CELL, 'overflow-hidden text-ellipsis', toneClass(on && daysFrom(today, on) <= BILL_DUE_SOON_DAYS ? 'warn' : 'ink-3'))} title={on ? feeDateText(on) : undefined}>
        {on ? feeStatus(on, today) : ''}
      </td>
    </tr>
  );
}

/** A card instalment plan still running, as the phone's Instalments group: on the card's statement, in no total. */
function InstalmentTableRow({ cols, line, readCurrency, striped, onOpen }: { cols: Columns; line: InstalmentLine; readCurrency: string; striped: boolean; onOpen: () => void }) {
  // "3 of 12 paid · on the statement": how far through goes with the plan's name, where it is paid in Status.
  const progress = line.detail.split(' · ')[0];
  return (
    <tr data-testid="instalment-line" onClick={onOpen} className={cx('cursor-default text-[var(--ph-ink)]', striped && 'bg-[var(--mac-zebra)]')}>
      <td />
      <td className={cx(CELL, 'overflow-hidden text-ellipsis')} title={line.title}>
        {line.description} · {progress}
      </td>
      {cols.category && (
        <td className={cx(CELL, 'text-[var(--ph-ink-3)]')}>
          <span className="flex items-center gap-[6px]">
            <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-2)]">
              <CalendarClock size={11} />
            </span>
            Card instalment
          </span>
        </td>
      )}
      <td className={cx(CELL, 'text-[var(--ph-ink-3)]')}>—</td>
      <td className={cx(CELL, 'text-right tabular-nums')}>{figure(line.monthlyMinor, line.currency, readCurrency)}</td>
      {cols.paidWith && (
        <td className={cx(CELL, 'overflow-hidden text-ellipsis')} title={line.cardName}>
          {line.cardName}
        </td>
      )}
      <td className={cx(CELL, 'overflow-hidden text-ellipsis text-[var(--ph-ink-3)]')} title={line.detail}>
        On the statement
      </td>
    </tr>
  );
}
