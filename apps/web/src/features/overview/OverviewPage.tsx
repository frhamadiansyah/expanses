import { DeskNotices } from '../../app/DeskNotices';
import { addMonths, dayMonth, formatMinor, householdEmergencyMonths, isoDate, monthName, monthOf, periodMonthOf, sumToBase } from '@expanses/core';
import { budgetSheetFor, pocketParentIds } from '@expanses/db';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { billsDueCount, compactMoney } from '../../app/sidebar-model';
import { cx } from '../../ui';
import { parentTotal, pocketsOf } from '../accounts/pockets';
import { daysSince, getLastBackupAt } from '../backup/backupState';
import { useMonthlyBills } from '../bills/queries';
import { useLateDebtCount, usePlanMonth } from '../debt-plan/queries';
import { useGoals } from '../goals/queries';
import { usePendingDraftCount } from '../review/queries';
import { useMoneyOnHand } from '../wallet/use-money-on-hand';
import { walletMoney } from '../wallet/wallet-model';
import { useMonthStart } from '../workspaces/queries';
import {
  accountBars,
  averageOf,
  type ChartMonth,
  chartMonths,
  expectedLegend,
  expectedSpending,
  firstMonth,
  howLongItLasts,
  monthsText,
  nextFortnight,
  projectedBalance,
  rangeLabel,
  targetMonths,
  worthALook,
} from './overview-model';

const BOX = 'rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)]';
const NOTE = 'text-[11.5px] font-normal text-[var(--ph-ink-3)]';
const SPENT = '#248a3d';
const HIGHEST = '#b25000';

/** A box's header: its title opens its page; the note sits on the right. */
function BoxHead({ title, to, note }: { title: string; to: string; note?: ReactNode }) {
  return (
    <h2 className="flex items-baseline justify-between px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]">
      <Link to={to} className="hover:underline">
        {title}
      </Link>
      {note && <span className={NOTE}>{note}</span>}
    </h2>
  );
}

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
          <line x1={left} x2={W} y1={y(tick)} y2={y(tick)} stroke="var(--ph-hair)" />
          <text x={left - 6} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="var(--ph-ink-3)">
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
            <text x={left + slot * i + slot / 2} y={H + 8} textAnchor="middle" fontSize="10" fill="var(--ph-ink-3)">
              {monthName(m.month, 'short')}
            </text>
          </g>
        );
      })}
      {todayAt >= 0 && todayAt < months.length - 1 && (
        <g>
          <line x1={left + slot * (todayAt + 1)} x2={left + slot * (todayAt + 1)} y1={top} y2={bottom} stroke="var(--ph-ink-3)" strokeDasharray="3 3" />
          <text x={left + slot * (todayAt + 1) + 4} y={top + 8} fontSize="10" fill="var(--ph-ink-3)">
            Today
          </text>
        </g>
      )}
      {line.length > 1 && (
        <g>
          <polyline points={line.join(' ')} fill="none" stroke="var(--ph-ink-2)" strokeWidth="1.5" strokeDasharray="2 3" />
          {[ahead[0]!, ahead[ahead.length - 1]!].map((p, k) => (
            <text key={k} x={left + slot * p.i + slot / 2} y={yLine(p.minor) - 6} textAnchor={k === 0 ? 'start' : 'end'} fontSize="10" fill="var(--ph-ink-2)">
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
      <path d="M20 105 A80 80 0 0 1 180 105" fill="none" stroke="var(--ph-track)" strokeWidth="14" strokeLinecap="round" />
      {share > 0 && <path d={`M20 105 A80 80 0 0 1 ${x.toFixed(1)} ${yy.toFixed(1)}`} fill="none" stroke="var(--ph-ink)" strokeWidth="14" strokeLinecap="round" />}
      <text x="100" y="92" textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--ph-ink)">
        {label}
      </text>
      <text x="100" y="118" textAnchor="middle" fontSize="11" fill="var(--ph-ink-3)">
        {sub}
      </text>
    </svg>
  );
}

/**
 * Overview (Mac Overview A, 2026-11-17): the wide screen's first page. Money on hand with twelve months of spending,
 * how long the money lasts, the money accounts, what is worth a look and the next 14 days — each a figure the app
 * already works out on its own page, which the box's title opens.
 */
export function DesktopOverviewPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const today = isoDate();
  const monthStart = useMonthStart();
  const current = periodMonthOf(today, monthStart);
  const [shift, setShift] = useState(0);
  const first = firstMonth(current, shift);

  const onHand = useMoneyOnHand();
  const onHandMinor = onHand.ready ? onHand.box.balanceMinor : null;

  // Each month's Budget sheet: what was spent and earned (the figures Budget shows), the budget total, what is over.
  const past = Array.from({ length: 12 }, (_, i) => addMonths(first, i)).filter((m) => m <= current);
  const lastThree = [1, 2, 3].map((back) => addMonths(current, -back));
  const wanted = [...new Set([...past, ...lastThree, current])];
  const sheets = useQueries({ queries: wanted.map((month) => ({ queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, month], queryFn: () => budgetSheetFor(database, ws, month) })) });
  const sheetOf = (month: string) => sheets[wanted.indexOf(month)]?.data;
  const sheetCurrency = sheetOf(current)?.currency ?? ws.baseCurrency;
  const spent = Object.fromEntries(wanted.map((month) => [month, sheetOf(month)?.spendingActualMinor ?? null]));
  const avgSpent = averageOf(lastThree.map((month) => sheetOf(month)?.spendingActualMinor ?? null));
  const avgIncome = averageOf(lastThree.map((month) => sheetOf(month)?.incomeActualMinor ?? null));
  const expected = expectedSpending(sheetOf(current)?.capsTotalMinor ?? null, lastThree.map((month) => sheetOf(month)?.spendingActualMinor ?? null));
  // The line ahead adds income less spending to today's money on hand: only when both read in the same currency.
  const line = projectedBalance(sheetCurrency === ws.baseCurrency ? onHandMinor : null, avgIncome, avgSpent);
  const months = chartMonths({ first, current, spent, expected, balanceAhead: line });

  const goals = useGoals();
  const target = targetMonths(householdEmergencyMonths(goals.data ?? []));
  const lasts = howLongItLasts(onHandMinor, sheetCurrency === ws.baseCurrency ? avgSpent : null, target, current);

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
    over: sheetOf(current)?.overCount ?? 0,
    billsSoon: billsDueCount(bills, today),
    backupDays: lastBackup.data ? daysSince(lastBackup.data) : null,
    hasData: onHand.everything.length > 0,
  });

  // Loans, card statements and bills due, from the Debt-free plan's schedule for this month and the next.
  const thisMonth = usePlanMonth(monthOf(today));
  const nextMonth = usePlanMonth(addMonths(monthOf(today), 1));
  const upcoming = thisMonth.items && nextMonth.items ? nextFortnight([...thisMonth.items, ...nextMonth.items], today) : null;

  const figure = onHandMinor === null ? '–' : formatMinor(onHandMinor, ws.baseCurrency);
  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]">
      <header className="sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Overview</h1>
        <span className="flex-1" />
        <div className="flex items-center gap-[2px] text-[13px] text-[var(--ph-ink)]">
          <button type="button" aria-label="Earlier months" onClick={() => setShift(shift - 1)} className="flex h-[24px] w-[22px] items-center justify-center rounded text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
            <ChevronLeft size={15} aria-hidden />
          </button>
          <span data-testid="overview-range" className="tabular-nums">
            {rangeLabel(first)}
          </span>
          <button type="button" aria-label="Later months" onClick={() => setShift(shift + 1)} className="flex h-[24px] w-[22px] items-center justify-center rounded text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: '/transactions/new' })}
          className="flex items-center gap-1 rounded-[6px] bg-[var(--ph-ink)] px-[11px] py-[4px] text-[12.5px] font-medium text-[var(--ph-surface)]"
        >
          <Plus size={13} aria-hidden /> Add
        </button>
      </header>
      {/* The app's notices, under the title bar rather than above it. */}
      <DeskNotices />

      <div className="grid grid-cols-1 gap-[14px] px-[22px] py-[18px] lg:grid-cols-[2fr_1fr]">
        <section className={BOX} aria-label="Money on hand">
          <BoxHead title="Money on hand" to="/wallet" note="as on Wallet" />
          <p className="px-[14px] text-[24px] font-semibold text-[var(--ph-ink)] tabular-nums" data-testid="overview-on-hand">
            {figure}
          </p>
          <div className="flex flex-wrap gap-3 px-[14px] pt-[6px] text-[11px] text-[var(--ph-ink-3)]">
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
          <div className="px-[14px] pt-2 pb-[10px]">
            <Chart months={months} current={current} currency={sheetCurrency} />
          </div>
        </section>

        <section className={BOX} aria-label="How long it lasts">
          <BoxHead title="How long it lasts" to="/net-worth/health" />
          <div className="pt-[14px] pb-[6px]">
            <Gauge share={lasts.share} label={lasts.months === null ? '–' : monthsText(lasts.months)} sub={lasts.until ? `lasts until ${lasts.until}` : 'nothing spent to measure by'} />
          </div>
          <div className="flex items-center border-t border-[var(--ph-hair)] px-[14px] py-2 text-[13px]">
            <span className="flex-1 text-[var(--ph-ink)]">Spent a month</span>
            <span className="text-[var(--ph-ink)] tabular-nums">{avgSpent === null ? '–' : compactMoney(avgSpent, sheetCurrency)}</span>
          </div>
          <div className="flex items-center border-t border-[var(--ph-hair)] px-[14px] py-2 text-[13px]">
            <span className="flex-1 text-[var(--ph-ink)]">Target</span>
            <span className="text-[var(--ph-ink)] tabular-nums">{target} months</span>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-3 lg:col-span-2">
          <section className={BOX} aria-label="Accounts">
            <BoxHead title="Accounts" to="/wallet" note={`${bars.length} ${bars.length === 1 ? 'account' : 'accounts'}`} />
            <div className="px-[14px] py-[6px]">
              {bars.length === 0 && <p className="pb-2 text-[12.5px] text-[var(--ph-ink-3)]">No money accounts yet.</p>}
              {bars.map((bar) => (
                <Link key={bar.id} to="/accounts/$accountId" params={{ accountId: bar.id }} className="block rounded hover:bg-[var(--ph-fill)]">
                  <span className="flex justify-between gap-2 text-[13px] text-[var(--ph-ink)]">
                    <span className="min-w-0 truncate">{bar.name}</span>
                    <b className="font-semibold tabular-nums">{bar.minor === null ? '–' : compactMoney(bar.minor, bar.currency)}</b>
                  </span>
                  <span className="mt-[5px] mb-2 block h-1 overflow-hidden rounded-sm bg-[var(--ph-track)]">
                    <i className="block h-full rounded-sm bg-[var(--ph-ink)]" style={{ width: `${Math.round(bar.share * 100)}%` }} />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className={BOX} aria-label="Worth a look">
            <BoxHead title="Worth a look" to="/review" note="worked out on this device" />
            {look.length === 0 && <p className="mx-3 mt-1 mb-3 rounded-lg bg-[var(--ov-ground)] px-[10px] py-2 text-[12.5px] text-[var(--ph-ink-3)]">Nothing needs a look.</p>}
            {look.map((item) => (
              <Link key={item.key} to={item.to} className="mx-3 mt-1 mb-2 block rounded-lg bg-[var(--ov-ground)] px-[10px] py-2 hover:bg-[var(--ph-fill)]">
                <b className="block text-[12.5px] font-semibold text-[var(--ph-ink)]">{item.title}</b>
                <span className="block text-[11.5px] text-[var(--ph-ink-3)]">{item.detail}</span>
              </Link>
            ))}
          </section>

          <section className={BOX} aria-label="Next 14 days">
            <BoxHead title="Next 14 days" to="/bills" note={<Link to="/bills">See all</Link>} />
            {upcoming && upcoming.length === 0 && <p className="px-[14px] pb-3 text-[12.5px] text-[var(--ph-ink-3)]">Nothing due in the next 14 days.</p>}
            {(upcoming ?? []).map((row, i) => (
              <div key={row.key} className={cx('flex items-center gap-[10px] px-[14px] py-[6px] text-[13px]', i > 0 && 'border-t border-[var(--ph-hair)]')}>
                <span className="w-[34px] rounded-[6px] border border-[var(--ph-hair)] py-[2px] text-center text-[12px] leading-[1.1] font-semibold text-[var(--ph-ink)]">
                  {Number(row.dueOn.slice(8, 10))}
                  <small className="block text-[9px] font-normal text-[var(--ph-ink-3)]">{dayMonth(row.dueOn).split(' ')[1]}</small>
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--ph-ink)]">{row.title}</span>
                <span className={cx('tabular-nums', row.incoming ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]')}>
                  {row.minor === null ? '–' : `${row.incoming ? '+' : ''}${compactMoney(row.minor, row.currency)}`}
                </span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
