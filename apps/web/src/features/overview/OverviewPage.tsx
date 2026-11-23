import { DeskNotices } from '../../app/DeskNotices';
import { addMonths, dayMonth, formatMinor, householdEmergencyMonths, isoDate, monthName, monthOf, parsePeriod, periodMonthOf, sumToBase, balanceSheet } from '@expanses/core';
import { budgetSheetFor, listTransactionsIn, pocketParentIds } from '@expanses/db';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  ClipboardList,
  Clock,
  CreditCard,
  Diamond,
  Equal,
  Landmark,
  type LucideIcon,
  Plus,
  ScanLine,
  Search,
  Zap,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { billsDueCount, compactMoney } from '../../app/sidebar-model';
import { useAccounts } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { Card, DeskBar, DeskTitle, PILL, PILL_BLUE, StatTile, Tag, TileRow, tileMoney, Track } from '../../ui/desk';
import { macV2 } from '../../ui/mac-detail';
import { useScanReceipt } from '../../capture/use-scan';
import { parentTotal, pocketsOf } from '../accounts/pockets';
import { daysSince, getLastBackupAt } from '../backup/backupState';
import { useMonthlyBills } from '../bills/queries';
import { useAccountNumberLast4, useCardsWithArchived, useWalletLast4 } from '../cards/card-queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { cardPay } from '../debt-plan/pay-target';
import { useLateDebtCount, usePlanMonth } from '../debt-plan/queries';
import { useGoals } from '../goals/queries';
import { useNetWorthSeries, useSheet } from '../networth/queries';
import { useDrafts, usePendingDraftCount } from '../review/queries';
import { useOpenBookReadOnly } from '../sharing/queries';
import { deskAmount } from '../transactions/cashflow-desk-model';
import { openCashflowForPaste, useCashflowTotals } from '../transactions/DesktopCashflow';
import { buildRows, EMPTY_FILTERS, filterRows, type ListRow, outsideEvents, sortRows } from '../transactions/list-model';
import { leavesOutNotMonthly, readNotMonthlyShown } from '../transactions/not-monthly';
import { useMoneyOnHand } from '../wallet/use-money-on-hand';
import { walletCredit, walletMoney } from '../wallet/wallet-model';
import { WorkspaceSheet } from '../workspaces/WorkspaceSheet';
import { useMonthStart, useOpenBook } from '../workspaces/queries';
import {
  accountBars,
  averageOf,
  billLines,
  changeText,
  type ChartMonth,
  chartMonths,
  expectedLegend,
  expectedSpending,
  firstMonth,
  greeting,
  howLongItLasts,
  leftShare,
  monthsText,
  netWorthChange,
  nextFortnight,
  projectedBalance,
  rangeLabel,
  targetMonths,
  worthALook,
} from './overview-model';

const SPENT = '#248a3d';
const HIGHEST = '#b25000';
const LINK = 'text-[13px] font-semibold text-[var(--mk-blue)] hover:underline';
const HAIR = 'border-t border-[var(--mk-line)]';

/** The 12 bars, the expected ones hatched, the Today marker and the dotted balance line ahead. */
function Chart({ months, current, currency }: { months: ChartMonth[]; current: string; currency: string }) {
  const W = 646;
  const H = 228;
  const left = 46;
  const top = 10;
  const bottom = 206;
  const slot = (W - left) / months.length;
  // The bars on the left scale; the balance line on its own (it runs in hundreds where a month's spending runs in
  // tens), labelled where it starts and ends.
  const max = Math.max(1, ...months.map((m) => m.minor ?? 0));
  const y = (minor: number) => bottom - (Math.max(0, minor) / max) * (bottom - top);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const ahead = months.flatMap((m, i) => (m.balanceMinor === null ? [] : [{ i, minor: m.balanceMinor }]));
  const low = Math.min(...ahead.map((p) => p.minor));
  const high = Math.max(...ahead.map((p) => p.minor));
  const yLine = (minor: number) => (high === low ? top + (bottom - top) * 0.3 : top + 12 + ((high - minor) / (high - low)) * (bottom - top) * 0.55);
  const line = ahead.map((p) => `${left + slot * p.i + slot / 2},${yLine(p.minor)}`);
  const todayAt = months.findIndex((m) => m.month === current);
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="block h-auto w-full" role="img" aria-label="Spending by month, with what is expected ahead">
      <defs>
        <pattern id="ov-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--ov-expected-fill)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ov-expected-line)" strokeWidth="2" />
        </pattern>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={W} y1={y(tick)} y2={y(tick)} stroke="var(--mk-line)" />
          <text x={left - 6} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="var(--mk-ink-2)">
            {compactMoney(Math.round(tick), currency)}
          </text>
        </g>
      ))}
      {months.map((m, i) => {
        const x = left + slot * i + slot * 0.2;
        const w = slot * 0.6;
        const h = m.minor === null ? 0 : bottom - y(m.minor);
        const fill = m.kind === 'expected' ? 'url(#ov-hatch)' : m.kind === 'highest' ? HIGHEST : SPENT;
        return (
          <g key={m.month}>
            {h > 0 && (
              <rect x={x} y={bottom - h} width={w} height={h} rx="3" fill={fill} stroke={m.kind === 'expected' ? 'var(--ov-expected-line)' : 'none'}>
                <title>{`${monthName(m.month, 'long')} ${m.month.slice(0, 4)}: ${m.kind === 'expected' ? 'expected' : 'spent'} ${m.minor === null ? '' : formatMinor(m.minor, currency)}`}</title>
              </rect>
            )}
            <text x={left + slot * i + slot / 2} y={H + 8} textAnchor="middle" fontSize="10" fill="var(--mk-ink-2)">
              {monthName(m.month, 'short')}
            </text>
          </g>
        );
      })}
      {todayAt >= 0 && todayAt < months.length - 1 && (
        <g>
          <line x1={left + slot * (todayAt + 1)} x2={left + slot * (todayAt + 1)} y1={top} y2={bottom} stroke="var(--mk-ink-2)" strokeDasharray="3 3" />
          <text x={left + slot * (todayAt + 1) + 4} y={top + 8} fontSize="10" fill="var(--mk-ink-2)">
            Today
          </text>
        </g>
      )}
      {line.length > 1 && (
        <g>
          <polyline points={line.join(' ')} fill="none" stroke="var(--mk-ink-2)" strokeWidth="1.5" strokeDasharray="2 3" />
          {[ahead[0]!, ahead[ahead.length - 1]!].map((p, k) => (
            <text key={k} x={left + slot * p.i + slot / 2} y={yLine(p.minor) - 6} textAnchor={k === 0 ? 'start' : 'end'} fontSize="10" fill="var(--mk-ink-2)">
              {compactMoney(p.minor, currency)}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

/** The gauge: a half ring, filled to the share of the target the money covers. */
function Gauge({ share, label, sub }: { share: number; label: string; sub: string }) {
  const r = 80;
  const angle = Math.PI * (1 - share);
  const x = 100 + r * Math.cos(angle);
  const yy = 105 - r * Math.sin(angle);
  return (
    <svg viewBox="0 0 200 124" className="mx-auto block w-[200px]" role="img" aria-label={`${label}, ${sub}`}>
      <path d="M20 105 A80 80 0 0 1 180 105" fill="none" stroke="var(--mk-track)" strokeWidth="14" strokeLinecap="round" />
      {share > 0 && <path d={`M20 105 A80 80 0 0 1 ${x.toFixed(1)} ${yy.toFixed(1)}`} fill="none" stroke="var(--mk-blue)" strokeWidth="14" strokeLinecap="round" />}
      <text x="100" y="92" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--mk-ink)">
        {label}
      </text>
      <text x="100" y="118" textAnchor="middle" fontSize="11" fill="var(--mk-ink-2)">
        {sub}
      </text>
    </svg>
  );
}

/** A card's title that opens its page. */
const titleLink = (title: string, to: string) => (
  <Link to={to} className="hover:underline">
    {title}
  </Link>
);

/**
 * v2: Money on hand, with twelve months of spending and the range stepper in its own header, and How long it lasts —
 * each a figure the app already works out on its own page, which the card's title opens.
 */
function MoneyCards() {
  const { database, ws } = useApp();
  const today = isoDate();
  const monthStart = useMonthStart();
  const current = periodMonthOf(today, monthStart);
  const [shift, setShift] = useState(0);
  const first = firstMonth(current, shift);

  const onHand = useMoneyOnHand();
  const onHandMinor = onHand.ready ? onHand.box.balanceMinor : null;

  // Each month's Budget sheet: what was earned, the budget total (the figures Budget shows).
  const past = Array.from({ length: 12 }, (_, i) => addMonths(first, i)).filter((m) => m <= current);
  const lastThree = [1, 2, 3].map((back) => addMonths(current, -back));
  const wanted = [...new Set([...past, ...lastThree, current])];
  const sheets = useQueries({ queries: wanted.map((month) => ({ queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, month], queryFn: () => budgetSheetFor(database, ws, month) })) });
  const sheetOf = (month: string) => sheets[wanted.indexOf(month)]?.data;
  /*
   * What each month spent follows Cashflow's not-monthly rule (owner, 2026-11-18): a bill paid yearly or every 2 months
   * or more is left out of the month it is paid in, as Cashflow's month leaves it while its Not monthly is Hidden
   * (`not-monthly.ts`), so no month spikes here either — the bars, Spent a month, Expected's average and How long it
   * lasts. Budget's own figures (the budget total, what is over) stay Budget's.
   */
  const leaveOut = leavesOutNotMonthly({ kind: 'month', from: '', to: '' }, readNotMonthlyShown());
  const spentSheets = useQueries({
    queries: wanted.map((month) => ({
      queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, month, ...(leaveOut ? ['not-monthly-out'] : [])],
      queryFn: () => budgetSheetFor(database, ws, month, { leaveOutNotMonthly: leaveOut }),
    })),
  });
  const spentOf = (month: string) => spentSheets[wanted.indexOf(month)]?.data?.spendingActualMinor ?? null;
  const sheetCurrency = sheetOf(current)?.currency ?? ws.baseCurrency;
  const spent = Object.fromEntries(wanted.map((month) => [month, spentOf(month)]));
  const avgSpent = averageOf(lastThree.map(spentOf));
  const avgIncome = averageOf(lastThree.map((month) => sheetOf(month)?.incomeActualMinor ?? null));
  const expected = expectedSpending(sheetOf(current)?.capsTotalMinor ?? null, lastThree.map(spentOf));
  // The line ahead adds income less spending to today's money on hand: only when both read in the same currency.
  const line = projectedBalance(sheetCurrency === ws.baseCurrency ? onHandMinor : null, avgIncome, avgSpent);
  const months = chartMonths({ first, current, spent, expected, balanceAhead: line });

  const goals = useGoals();
  const target = targetMonths(householdEmergencyMonths(goals.data ?? []));
  const lasts = howLongItLasts(onHandMinor, sheetCurrency === ws.baseCurrency ? avgSpent : null, target, current);
  const figure = onHandMinor === null ? '–' : formatMinor(onHandMinor, ws.baseCurrency);

  const stepper = (
    <span className="flex items-center gap-[2px] text-[12.5px] font-semibold text-[var(--mk-ink)]">
      <button type="button" aria-label="Earlier months" onClick={() => setShift(shift - 1)} className="flex h-[24px] w-[22px] items-center justify-center rounded-full text-[var(--mk-ink-2)] hover:bg-[var(--mk-pill)]">
        <ChevronLeft size={15} aria-hidden />
      </button>
      <span data-testid="overview-range" className="tabular-nums">
        {rangeLabel(first)}
      </span>
      <button type="button" aria-label="Later months" onClick={() => setShift(shift + 1)} className="flex h-[24px] w-[22px] items-center justify-center rounded-full text-[var(--mk-ink-2)] hover:bg-[var(--mk-pill)]">
        <ChevronRight size={15} aria-hidden />
      </button>
    </span>
  );
  return (
    <div className="grid grid-cols-1 gap-[16px] @min-[860px]:grid-cols-[2fr_1fr]">
      <Card title={titleLink('Money on hand', '/wallet')} label="Money on hand" icon={Banknote} note={stepper} bodyClassName="px-[20px] pb-[16px]">
        <p className="flex items-baseline gap-[10px]">
          <span className="text-[30px] leading-[36px] font-extrabold tracking-[-0.3px] text-[var(--mk-ink)] tabular-nums" data-testid="overview-on-hand">
            {figure}
          </span>
          <span className="text-[12.5px] text-[var(--mk-ink-2)]">as on Wallet</span>
        </p>
        <div className="flex flex-wrap gap-3 pt-[8px] text-[12px] text-[var(--mk-ink-2)]">
          <span>
            <i className="mr-1 inline-block h-[9px] w-[9px] rounded-[2px] align-[-1px]" style={{ background: SPENT }} />
            Spent
          </span>
          <span>
            <i className="mr-1 inline-block h-[9px] w-[9px] rounded-[2px] align-[-1px]" style={{ background: HIGHEST }} />
            Highest
          </span>
          <span title={expectedLegend(expected)} data-testid="overview-expected">
            <i className="mr-1 inline-block h-[9px] w-[9px] rounded-[2px] border border-[var(--ov-expected-line)] bg-[var(--ov-expected-fill)] align-[-1px]" />
            {expectedLegend(expected)}
          </span>
          {months.some((m) => m.balanceMinor !== null) && <span>┄ Balance ahead</span>}
        </div>
        <div className="pt-[10px]">
          <Chart months={months} current={current} currency={sheetCurrency} />
        </div>
      </Card>

      <Card title={titleLink('How long it lasts', '/net-worth/health')} label="How long it lasts" icon={Clock} bodyClassName="px-[20px] pb-[12px]">
        <div className="pt-[10px] pb-[8px]">
          <Gauge share={lasts.share} label={lasts.months === null ? '–' : monthsText(lasts.months)} sub={lasts.until ? `lasts until ${lasts.until}` : 'nothing spent to measure by'} />
        </div>
        <div className={cx('flex items-center py-[10px] text-[13.5px]', HAIR)}>
          <span className="flex-1 text-[var(--mk-ink)]">Spent a month</span>
          <span className="font-semibold text-[var(--mk-ink)] tabular-nums">{avgSpent === null ? '–' : compactMoney(avgSpent, sheetCurrency)}</span>
        </div>
        <div className={cx('flex items-center py-[10px] text-[13.5px]', HAIR)}>
          <span className="flex-1 text-[var(--mk-ink)]">Target</span>
          <span className="font-semibold text-[var(--mk-ink)] tabular-nums">{target} months</span>
        </div>
      </Card>
    </div>
  );
}

/** v2: the money accounts with their bars and the next 14 days side by side, then what is worth a look. */
function MoreCards() {
  const { database, ws } = useApp();
  const today = isoDate();
  const monthStart = useMonthStart();
  const current = periodMonthOf(today, monthStart);
  const onHand = useMoneyOnHand();
  const sheet = useQuery({ queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, current], queryFn: () => budgetSheetFor(database, ws, current) });

  // The money accounts, each in its own currency, its bar against the largest in the base currency.
  const parents = pocketParentIds(onHand.everything);
  const money = walletMoney(onHand.everything);
  const rows = money.map((account) => {
    if (parents.has(account.id)) {
      const total = parentTotal(pocketsOf(account.id, onHand.book), onHand.all, ws.baseCurrency, onHand.held).totalMinor;
      return { id: account.id, name: account.name, minor: total, currency: ws.baseCurrency, baseMinor: total };
    }
    const minor = onHand.all[account.id] ?? 0;
    const currency = account.currency ?? ws.baseCurrency;
    return { id: account.id, name: account.name, minor, currency, baseMinor: sumToBase({ amounts: [{ minor, currency }], baseCurrency: ws.baseCurrency, ratesToBase: onHand.held }).totalMinor };
  });
  const bars = accountBars(rows);

  const review = usePendingDraftCount().data ?? 0;
  const late = useLateDebtCount();
  const bills = useMonthlyBills(today).data ?? [];
  const lastBackup = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  const look = worthALook({
    review,
    late,
    over: sheet.data?.overCount ?? 0,
    billsSoon: billsDueCount(bills, today),
    backupDays: lastBackup.data ? daysSince(lastBackup.data) : null,
    hasData: onHand.everything.length > 0,
  });

  // Loans, card statements and bills due, from the Debt-free plan's schedule for this month and the next.
  const thisMonth = usePlanMonth(monthOf(today));
  const nextMonth = usePlanMonth(addMonths(monthOf(today), 1));
  const upcoming = thisMonth.items && nextMonth.items ? nextFortnight([...thisMonth.items, ...nextMonth.items], today) : null;

  return (
    <>
      <div className="grid grid-cols-1 gap-[16px] @min-[860px]:grid-cols-2">
        <Card title={titleLink('Accounts', '/wallet')} label="Accounts" icon={Landmark} note={`${bars.length} ${bars.length === 1 ? 'account' : 'accounts'}`} bodyClassName="px-[20px] pb-[14px]">
          {bars.length === 0 && <p className="pb-2 text-[13px] text-[var(--mk-ink-2)]">No money accounts yet.</p>}
          {bars.map((bar, i) => (
            <Link key={bar.id} to="/accounts/$accountId" params={{ accountId: bar.id }} className={cx('block rounded-[8px] py-[9px] hover:bg-[var(--mk-pill)]', i > 0 && HAIR)}>
              <span className="flex justify-between gap-2 text-[13.5px] text-[var(--mk-ink)]">
                <span className="min-w-0 truncate font-semibold">{bar.name}</span>
                <b className="font-semibold tabular-nums">{bar.minor === null ? '–' : compactMoney(bar.minor, bar.currency)}</b>
              </span>
              <Track share={bar.share} colour="var(--mk-blue)" className="mt-[7px] w-[70%]" />
            </Link>
          ))}
        </Card>

        <Card title={titleLink('Next 14 days', '/bills')} label="Next 14 days" icon={CalendarClock} note={<Link to="/bills" className={LINK}>See all</Link>} bodyClassName="px-[20px] pb-[12px]">
          {upcoming && upcoming.length === 0 && <p className="pb-3 text-[13px] text-[var(--mk-ink-2)]">Nothing due in the next 14 days.</p>}
          {(upcoming ?? []).map((row, i) => (
            <div key={row.key} className={cx('flex items-center gap-[12px] py-[9px] text-[13.5px]', i > 0 && HAIR)}>
              <span className="w-[36px] shrink-0 rounded-[8px] bg-[var(--mk-pill)] py-[3px] text-center text-[13px] leading-[1.1] font-bold text-[var(--mk-ink)]">
                {Number(row.dueOn.slice(8, 10))}
                <small className="block text-[9.5px] font-semibold text-[var(--mk-ink-2)]">{dayMonth(row.dueOn).split(' ')[1]}</small>
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--mk-ink)]">{row.title}</span>
              <span className={cx('font-semibold tabular-nums', row.incoming ? 'text-[var(--mk-t-green)]' : 'text-[var(--mk-ink)]')}>
                {row.minor === null ? '–' : `${row.incoming ? '+' : ''}${compactMoney(row.minor, row.currency)}`}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <Card title={titleLink('Worth a look', '/review')} label="Worth a look" icon={Search} note="worked out on this device" bodyClassName="px-[20px] pb-[18px]">
        {look.length === 0 && <p className="rounded-[12px] bg-[var(--mk-panel)] px-[14px] py-[12px] text-[13px] text-[var(--mk-ink-2)]">Nothing needs a look.</p>}
        <div className="grid grid-cols-1 gap-[12px] @min-[700px]:grid-cols-3">
          {look.map((item) => (
            <Link key={item.key} to={item.to} className="block rounded-[12px] bg-[var(--mk-panel)] px-[14px] py-[12px] hover:bg-[var(--mk-pill)]">
              <b className="block text-[13.5px] font-bold text-[var(--mk-ink)]">{item.title}</b>
              <span className="mt-[2px] block text-[12.5px] text-[var(--mk-ink-2)]">{item.detail}</span>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}

/** The latest rows Cashflow lists this month: its own reading (`buildRows`, `filterRows`), newest first. */
function useRecent(month: string): ListRow[] {
  const { database, ws } = useApp();
  const monthStart = useMonthStart();
  const accounts = useAccounts().data ?? [];
  const everyCard = useCardsWithArchived().data ?? [];
  const wallets = useWalletLast4().data;
  const numbers = useAccountNumberLast4().data;
  const drafts = useDrafts().data ?? [];
  const eventsInCaps = useOpenBook()?.countEventsInBudget ?? false;
  const period = parsePeriod(month, monthStart);
  const range = period?.from ? { from: period.from, to: period.to! } : {};
  // Cashflow's own read of this month, filters off: the same key, so the two pages share it.
  const list = useQuery({
    queryKey: ['transactions', ws.workspaceId, ws.bookId ?? null, false, 'all', month, monthStart, false],
    queryFn: () => listTransactionsIn(database, ws, { ...range, includeVoid: false, limit: undefined }),
  });
  const recorded = outsideEvents(list.data?.transactions ?? [], eventsInCaps);
  const rows = buildRows(recorded, drafts, accounts, everyCard, { ...(numbers ?? {}), ...(wallets ?? {}) }, ws.bookId);
  const listed = filterRows(rows, { ...EMPTY_FILTERS, month, monthStart, showOpening: false }, accounts, true);
  return sortRows(listed, { key: 'date', dir: 'desc' }).slice(0, 3);
}

/** One of the Quick actions: a pastel tile with its icon over its name. */
function QuickTile({ icon: Icon, label, tint, ink, onClick, disabled }: { icon: LucideIcon; label: string; tint: string; ink: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[84px] min-w-0 flex-col items-center justify-center gap-[8px] rounded-[14px] text-[13.5px] font-semibold text-[var(--mk-ink)] hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mk-blue)] disabled:opacity-50"
      style={{ background: `var(--mk-p-${tint})` }}
    >
      <Icon size={21} strokeWidth={2.1} aria-hidden style={{ color: `var(--mk-c-${ink})` }} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Overview (v1, owner approved 2026-11-23; docs/mockups/2026-11-21-mac-redesign-sidebar.html): a greeting, this month's
 * four tiles — Cashflow's Spent, Received and Left, and Net worth with its change since last month-end — the month's
 * bills, the latest rows and four quick actions. Every figure is one another page works out, which its tile or card
 * opens. With `macV2` the money on hand chart, how long it lasts, the accounts, what is worth a look and the next 14
 * days come back (`MoneyCards`, `MoreCards`).
 */
export function DesktopOverviewPage() {
  const { ws, workspaceName } = useApp();
  const navigate = useNavigate();
  const openBook = useOpenBook();
  const readOnly = useOpenBookReadOnly();
  const today = isoDate();
  const monthStart = useMonthStart();
  const current = periodMonthOf(today, monthStart);
  const [choosing, setChoosing] = useState(false);
  const scan = useScanReceipt();

  // The tiles: Cashflow's own figures for this month, the not-monthly rule as its month reads it (`useCashflowTotals`).
  const leaveOut = leavesOutNotMonthly(parsePeriod(current, monthStart), readNotMonthlyShown());
  const totals = useCashflowTotals(current, undefined, leaveOut, 0);
  const { spentMinor, receivedMinor, leftMinor } = totals.figures;
  const left = leftShare(leftMinor, receivedMinor);

  // Net worth: the Net worth page's own sheet today, against its line's point at the end of last month.
  const sheetInputs = useSheet();
  const sheet = sheetInputs.data && sheetInputs.data.missing.length === 0 ? balanceSheet(sheetInputs.data.assets, sheetInputs.data.liabilities) : null;
  const series = useNetWorthSeries([addMonths(monthOf(today), -1)]);
  const lastEnd = series.data?.[0];
  const monthEndMinor = lastEnd && lastEnd.missing.length === 0 ? lastEnd.netWorthMinor : null;
  const change = netWorthChange(sheet?.netWorthMinor ?? null, monthEndMinor);

  const bills = billLines(useMonthlyBills(today).data ?? [], today);
  const recent = useRecent(current);
  const accounts = useAccounts().data ?? [];
  // Pay a card: one credit card goes straight to paying it (its page's Pay, `cardPay`); several, to Wallet to pick one.
  const credit = walletCredit(accounts);
  const payCard = () => void (credit.length === 1 ? navigate(cardPay(credit[0]!.id)) : navigate({ to: '/wallet' }));
  const pasteRows = () => {
    openCashflowForPaste();
    void navigate({ to: '/transactions' });
  };

  const BILL_DOT: Record<string, string> = { paid: 'var(--mk-c-green)', week: 'var(--mk-c-blue)', later: 'var(--mk-c-orange)', late: 'var(--mk-c-red)' };
  const month = `${monthName(current, 'long')} ${current.slice(0, 4)}`;
  const money = (minor: number | null) => (minor === null ? '–' : tileMoney(minor, totals.currency));
  const recentLine = (row: ListRow): ReactNode => [row.categoryName ?? 'Uncategorised', [row.accountLabel, row.last4].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]">
      <DeskBar crumb="Overview">
        {/* Not named "Workspace": that is the sidebar's own switcher, which the journeys find by its name. */}
        <button type="button" data-testid="overview-workspace" title="Switch workspace" onClick={() => setChoosing(true)} className={PILL}>
          <span className="max-w-[180px] truncate">{openBook?.name ?? workspaceName}</span>
          <ChevronDown size={13} strokeWidth={2.4} aria-hidden className="text-[var(--mk-ink-2)]" />
        </button>
        {!readOnly && (
          <button type="button" disabled={scan.busy} onClick={() => void scan.scan()} className={PILL}>
            {scan.busy ? 'Reading the receipt…' : 'Scan receipt'}
          </button>
        )}
        {!readOnly && (
          <button type="button" onClick={() => void navigate({ to: '/transactions/new' })} className={PILL_BLUE}>
            <Plus size={14} strokeWidth={2.6} aria-hidden /> Add
          </button>
        )}
      </DeskBar>
      {choosing && <WorkspaceSheet onClose={() => setChoosing(false)} />}
      {/* The app's notices, under the title bar rather than above it. */}
      <DeskNotices />
      <DeskTitle title={greeting(new Date().getHours())} line={`${month} at a glance`} testId="overview-title" />

      <div className="@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]">
        <ErrorBox error={scan.error} />
        <TileRow testId="overview-tiles">
          <StatTile icon={ArrowUpRight} colour="red" value={money(spentMinor)} label="Spent this month" to="/transactions" testId="overview-spent" />
          <StatTile icon={ArrowDownLeft} colour="green" value={money(receivedMinor)} label="Received" to="/transactions" testId="overview-received" />
          <StatTile
            icon={Equal}
            colour="blue"
            value={money(leftMinor)}
            label="Left to spend"
            badge={left === null ? undefined : <Tag tone={left < 0 ? 'red' : 'blue'}>{left}% left</Tag>}
            to="/transactions"
            testId="overview-left"
          />
          <StatTile
            icon={Diamond}
            colour="purple"
            value={sheet ? tileMoney(sheet.netWorthMinor, ws.baseCurrency) : '–'}
            label="Net worth"
            badge={change === null ? undefined : <Tag tone={change < 0 ? 'red' : 'green'}>{changeText(change)}</Tag>}
            to="/net-worth"
            testId="overview-net-worth"
          />
        </TileRow>

        {macV2 && <MoneyCards />}

        <div className="grid grid-cols-1 gap-[16px] @min-[860px]:grid-cols-2">
          <Card title="Bills this month" icon={CalendarDays} note={<Link to="/bills" className={LINK}>See all</Link>} testId="overview-bills" bodyClassName="px-[20px] pt-[2px] pb-[16px]">
            {bills.map((line) => (
              <div key={line.key} data-testid={`bills-${line.key}`} className="flex items-center gap-[12px] py-[9px] text-[14px]">
                <i aria-hidden className="block h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: BILL_DOT[line.key] }} />
                <span className="min-w-0 flex-1 truncate text-[var(--mk-ink)]">{line.label}</span>
                <span className="w-[28px] text-right text-[var(--mk-ink-2)] tabular-nums">{line.count}</span>
                <Track share={line.share} colour={BILL_DOT[line.key]!} className="w-[90px] shrink-0" />
              </div>
            ))}
          </Card>

          <Card title="Recent" icon={ArrowLeftRight} note={<Link to="/transactions" className={LINK}>Cashflow ›</Link>} testId="overview-recent" bodyClassName="px-[20px] pt-[2px] pb-[12px]">
            {recent.length === 0 && <p className="py-[10px] text-[13px] text-[var(--mk-ink-2)]">Nothing recorded this month yet.</p>}
            {recent.map((row) => {
              const amount = deskAmount(row);
              const inner = (
                <>
                  <CategoryIcon categoryId={row.categoryId} accounts={accounts} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-[var(--mk-ink)]">{row.description || row.categoryName || 'No note'}</span>
                    <span className="block truncate text-[12.5px] text-[var(--mk-ink-2)]">{recentLine(row)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-[3px]">
                    <span className={cx('text-[14px] font-bold whitespace-nowrap tabular-nums', amount.tone === 'up' ? 'text-[var(--mk-t-green)]' : amount.tone === 'grey' ? 'text-[var(--mk-ink-2)]' : 'text-[var(--mk-ink)]')}>
                      {amount.sign}
                      {formatMinor(amount.minor, row.currency)}
                    </span>
                    {row.kind === 'draft' ? <Tag tone="orange">To review</Tag> : <Tag tone="blue">Recorded</Tag>}
                  </span>
                </>
              );
              const line = 'flex items-center gap-[12px] rounded-[10px] py-[8px] hover:bg-[var(--mk-pill)]';
              return row.kind === 'draft' ? (
                <Link key={row.id} to="/review" data-testid="overview-recent-row" className={line}>
                  {inner}
                </Link>
              ) : (
                <Link key={row.id} to="/transactions/$transactionId" params={{ transactionId: row.tx?.id ?? row.id }} data-testid="overview-recent-row" className={line}>
                  {inner}
                </Link>
              );
            })}
          </Card>
        </div>

        {macV2 && <MoreCards />}

        {!readOnly && (
          <Card title="Quick actions" icon={Zap} testId="overview-quick" bodyClassName="grid grid-cols-2 gap-[14px] px-[20px] pb-[20px] @min-[700px]:grid-cols-4">
            <QuickTile icon={CirclePlus} label="New expense" tint="blue" ink="blue" onClick={() => void navigate({ to: '/transactions/new' })} />
            <QuickTile icon={ClipboardList} label="Paste rows" tint="pink" ink="pink" onClick={pasteRows} />
            <QuickTile icon={CreditCard} label="Pay a card" tint="green" ink="green" onClick={payCard} />
            <QuickTile icon={ScanLine} label={scan.busy ? 'Reading…' : 'Scan receipt'} tint="grey" ink="grey" disabled={scan.busy} onClick={() => void scan.scan()} />
          </Card>
        )}
      </div>
    </div>
  );
}
