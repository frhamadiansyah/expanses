import { addMonths, formatMinor, monthOf } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { BarChart3, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Minus, ReceiptText } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { iconTint, RowIcon } from '../../ui/native';
import { ToastCard, UndoToast } from '../../ui/UndoToast';
import { Card, PILL, PILL_BLUE, PILL_SMALL, Tag, TileRow, type Tone } from '../../ui/desk';
import { macV2 } from '../../ui/mac-detail';
import { monthYearLabel } from '../loans/loan-view';
import { comingUp, type DeskContext, groupWords, lateHead, type LateRow, lateRows, payOrder, tickable, tickedTotal, toggleTick } from './debt-plan-desk-model';
import { DebtKindIcon } from './DebtPeek';
import { MoneyTile, TD, TH, TR } from './DesktopDebtPlan';
import { DeskDueBars } from './DeskReport';
import { type LoanToPay, type PaidInstalments, paidWords, undoInstalments } from './pay-instalments';
import { PayInstalmentsSheet } from './PayInstalmentsSheet';
import { PayLink } from './PayLink';
import type { PlanItem } from './plan-inputs';
import { type DebtPlanModel, usePlanMonth, usePlanMonths } from './queries';
import { monthBars } from './report-view';
import { tagOf } from './SchedulePanel';
import { type MonthInput, monthSections, monthTotals } from './schedule-view';

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STEP = 'flex h-[28px] w-[28px] items-center justify-center rounded-full bg-[var(--mk-pill)] text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)]';
/** A tick's cell: the same hairline as the row's other cells. */
const TICK_TD = 'w-[34px] border-b border-[var(--mk-line)] py-[5px] pl-[10px] group-last/row:border-b-0';

/** A tick: blue and ticked, a dash for a debt's row with some of its instalments ticked, or an empty ring. */
function Tick({ state }: { state: 'on' | 'some' | 'off' }) {
  return (
    <span
      aria-hidden
      className={cx('flex h-[16px] w-[16px] items-center justify-center rounded-[5px]', state === 'off' ? 'bg-[var(--mk-field)] ring-[1.5px] ring-[var(--mk-ink-3)] ring-inset' : 'bg-[var(--mk-blue)] text-white')}
    >
      {state === 'on' && <Check size={10} strokeWidth={3} />}
      {state === 'some' && <Minus size={10} strokeWidth={3} />}
    </span>
  );
}

function TickCell({ label, state, onTick }: { label: string; state: 'on' | 'some' | 'off' | null; onTick: () => void }) {
  return (
    <td className={TICK_TD}>
      {state !== null && (
        <button type="button" role="checkbox" aria-checked={state === 'on' ? true : state === 'some' ? 'mixed' : false} aria-label={label} onClick={onTick} className="flex h-[20px] w-[20px] items-center justify-center">
          <Tick state={state} />
        </button>
      )}
    </td>
  );
}

/** The When cell's tag: how late (red), Today / Tomorrow (amber), the day, or when it was paid (green). */
function WhenTag({ tone, children }: { tone: 'alarm' | 'warn' | 'up' | 'quiet'; children: ReactNode }) {
  if (tone === 'quiet') return <span className="text-[12.5px] whitespace-nowrap text-[var(--mk-ink-2)]">{children}</span>;
  const tag: Record<'alarm' | 'warn' | 'up', Tone> = { alarm: 'red', warn: 'orange', up: 'green' };
  return <Tag tone={tag[tone]}>{children}</Tag>;
}

function SectionHead({ children, tone = 'grey', testId }: { children: ReactNode; tone?: 'alarm' | 'grey'; testId?: string }) {
  return (
    <tr>
      <td colSpan={5} data-testid={testId} className={cx('border-b border-[var(--mk-line)] px-[10px] pt-[14px] pb-[6px] text-[11.5px] font-bold tracking-[0.06em] uppercase', tone === 'alarm' ? 'text-[var(--mk-t-red)]' : 'text-[var(--mk-ink-3)]')}>
        {children}
      </td>
    </tr>
  );
}

/**
 * Schedule on a wide screen: this month's Due / Paid / Late (today's figures, ‹ › a month at a time) and paid against
 * due around it, then one table — Late, with a loan's two or more late instalments in ONE row (▶ opens them, Pay all
 * pays them in order), Coming up over the next 30 days, Paid. Ticked instalments pay together (the loan page's own Pay,
 * one after another) with Undo; every other Pay is the item's own sheet. `debtKey` narrows it to one debt.
 */
export function DeskSchedule({ model, ctx, month, show, debtKey }: { model: DebtPlanModel; ctx: DeskContext; month: string; show: MonthInput['show']; debtKey: string | null }) {
  const { ws, database } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = ctx.today;
  const isCurrent = month === monthOf(today);
  const { items, error } = usePlanMonth(month, show);
  const after = usePlanMonth(isCurrent ? addMonths(month, 1) : null, show);
  const barMonths = [-2, -1, 0, 1, 2].map((by) => addMonths(month, by));
  const { byMonth, error: barsError } = usePlanMonths(barMonths);
  const bars = byMonth ? monthBars(byMonth, barMonths, today) : null;

  const debt = debtKey ? model.debts.find((d) => d.key === debtKey) : undefined;
  const only = (list: readonly PlanItem[]) => (debtKey ? list.filter((i) => i.debtKey === debtKey) : [...list]);
  const all = items ? only(items) : null;
  const sections = all ? monthSections(all, month, today) : null;
  const totals = all ? monthTotals(all, month) : null;
  const coming = sections ? (isCurrent ? comingUp(sections.comingUp, only(after.items ?? []), today) : sections.comingUp) : [];
  const late = sections ? lateRows(sections.late) : [];
  const head = sections ? lateHead(sections.late) : null;

  const setMonth = (next: string) => {
    setPicked(new Set());
    void navigate({ to: '/net-worth/plan/schedule', search: { month: next, ...(debtKey ? { debt: debtKey } : {}) }, replace: true });
  };

  // ── Ticks: unpaid instalments in the base currency; a tick on one ticks its loan's earlier ones (`toggleTick`) ──
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const listed = [...(sections?.late ?? []), ...coming];
  const canTick = (item: PlanItem) => tickable(item, ws.baseCurrency);
  const toggle = (item: PlanItem) => setPicked((was) => toggleTick(was, item, listed.filter(canTick)));
  const toggleGroup = (items: readonly PlanItem[]) =>
    setPicked((was) => {
      const next = new Set(was);
      const on = items.every((i) => was.has(i.key));
      // Off: the group's own, and anything later of the same loan; on: every one of them.
      if (on) return toggleTick(was, items[0]!, listed.filter(canTick));
      for (const i of items) next.add(i.key);
      return next;
    });
  const chosen = listed.filter((i) => picked.has(i.key));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── Paying several, and Undo ──
  const [paying, setPaying] = useState<{ title: string; items: PlanItem[] } | null>(null);
  const [toast, setToast] = useState<{ text: string; detail: string; ids: string[]; undo: boolean } | null>(null);
  const [payError, setPayError] = useState<unknown>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const loansOf = (list: readonly PlanItem[]): (LoanToPay & { minor: number })[] => {
    const out: (LoanToPay & { minor: number })[] = [];
    for (const item of payOrder(list)) {
      const owner = model.debts.find((d) => d.key === item.debtKey);
      if (!owner?.accountId) continue;
      const found = out.find((loan) => loan.accountId === owner.accountId);
      if (found) {
        found.count += 1;
        found.minor += item.minor ?? 0;
      } else out.push({ accountId: owner.accountId, name: owner.name, currency: owner.currency, count: 1, minor: item.minor ?? 0 });
    }
    return out;
  };
  const paidAll = (loans: readonly LoanToPay[], paid: PaidInstalments) => {
    setPaying(null);
    setPicked(new Set());
    setPayError(paid.error);
    let left = paid.ids.length;
    const counted = loans.map((loan) => {
      const count = Math.min(loan.count, left);
      left -= count;
      return { name: loan.name, count };
    });
    const off = paid.paidOff.length > 0 ? ` · ${paid.paidOff.join(', ')} paid off` : '';
    setToast({ text: `${paidWords(counted)}${off}`, detail: formatMinor(paid.totalMinor, ws.baseCurrency), ids: paid.ids, undo: paid.paidOff.length === 0 });
  };
  async function undo() {
    if (!toast) return;
    const ids = toast.ids;
    setToast(null);
    try {
      await undoInstalments(database, ws, ids);
    } catch (e) {
      setPayError(e);
    }
    await invalidate();
  }

  const iconOf = (item: PlanItem) => {
    const owner = item.debtKey ? model.debts.find((d) => d.key === item.debtKey) : undefined;
    return owner ? (
      <DebtKindIcon debt={owner} size={24} />
    ) : (
      <RowIcon tint={iconTint('#8e8e93')} size={24}>
        <ReceiptText size={13} strokeWidth={2.2} aria-hidden />
      </RowIcon>
    );
  };

  const itemRow = (item: PlanItem, index: number, opts: { indent?: boolean } = {}) => {
    const tag = tagOf(item, today);
    const soFar = item.kind === 'card' && item.approximate && item.status !== 'paid';
    const tick = canTick(item) ? (picked.has(item.key) ? 'on' : 'off') : null;
    return (
      <tr key={item.key} data-testid="schedule-row" data-title={item.title} className={cx(TR, 'text-[var(--mk-ink)]', picked.has(item.key) ? 'bg-[var(--mk-sel)]' : 'hover:bg-[var(--mk-hover)]')}>
        <TickCell label={`Select ${item.title}`} state={tick} onTick={() => toggle(item)} />
        <td className={cx(TD, opts.indent && 'pl-[44px]')}>
          <span className="flex min-w-0 items-center gap-[9px]">
            {!opts.indent && <span className="w-[14px] shrink-0" aria-hidden />}
            {iconOf(item)}
            <span className="min-w-0">
              <span className="block font-medium break-words">{item.title}</span>
              <span className={cx('block text-[12px] text-[var(--mk-ink-2)]', item.inTotals === false && 'italic')}>{item.fromMessage ? 'from bank message' : item.detail}</span>
              {item.includes && (
                <span data-testid="schedule-includes" className="block text-[12px] text-[var(--mk-t-green)]">
                  {item.includes}
                </span>
              )}
            </span>
          </span>
        </td>
        <td className={TD}>
          <WhenTag tone={tag.tone}>{tag.text}</WhenTag>
        </td>
        <td className={cx(TD, 'text-right whitespace-nowrap tabular-nums', item.status === 'late' && 'font-semibold')}>
          {soFar && <span className="mr-[4px] text-[12px] font-normal text-[var(--mk-ink-2)]">so far</span>}
          {item.minor !== null ? formatMinor(item.minor, item.currency) : ''}
        </td>
        <td className={cx(TD, 'text-right')}>
          {item.pay && item.status !== 'paid' && (
            <PayLink target={item.pay} label={`Pay ${item.title}`} className={PILL_SMALL}>
              Pay
            </PayLink>
          )}
        </td>
      </tr>
    );
  };

  const groupRow = (row: Extract<LateRow, { type: 'group' }>, index: number) => {
    const open = expanded.has(row.key);
    const on = row.items.filter((i) => picked.has(i.key)).length;
    const tickState = row.items.every(canTick) ? (on === row.items.length ? 'on' : on > 0 ? 'some' : 'off') : null;
    const owner = model.debts.find((d) => d.key === row.debtKey);
    return [
      <tr key={row.key} data-testid="schedule-group" data-name={row.name} className={cx(TR, 'text-[var(--mk-ink)]', on > 0 ? 'bg-[var(--mk-sel)]' : 'hover:bg-[var(--mk-hover)]')}>
        <TickCell label={`Select every late instalment of ${row.name}`} state={tickState} onTick={() => toggleGroup(row.items)} />
        <td className={TD}>
          <span className="flex min-w-0 items-center gap-[9px]">
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} ${row.name}'s late instalments`}
              onClick={() =>
                setExpanded((was) => {
                  const next = new Set(was);
                  if (next.has(row.key)) next.delete(row.key);
                  else next.add(row.key);
                  return next;
                })
              }
              className="flex h-[16px] w-[14px] shrink-0 items-center justify-center text-[10px] text-[var(--mk-ink-2)]"
            >
              <span aria-hidden className={cx('inline-block transition-transform', open && 'rotate-90')}>
                ▶
              </span>
            </button>
            {owner ? <DebtKindIcon debt={owner} size={24} /> : null}
            <span className="min-w-0">
              <span className="block font-medium break-words">{row.name}</span>
              <span data-testid="schedule-group-range" className="block text-[12px] text-[var(--mk-ink-2)]">
                {row.range}
              </span>
            </span>
          </span>
        </td>
        <td className={TD}>
          <WhenTag tone="alarm">{groupWords(row)}</WhenTag>
        </td>
        <td data-testid="schedule-group-total" className={cx(TD, 'text-right font-semibold whitespace-nowrap tabular-nums')}>
          {formatMinor(row.minor, row.currency)}
        </td>
        <td className={cx(TD, 'text-right')}>
          {row.items.every(canTick) ? (
            <button type="button" aria-label={`Pay all ${row.name}`} onClick={() => setPaying({ title: `Pay all · ${row.name}`, items: row.items })} className={PILL_SMALL}>
              Pay all
            </button>
          ) : (
            row.items[0]?.pay && (
              <PayLink target={row.items[0].pay} label={`Pay ${row.name}`} className={PILL_SMALL}>
                Pay
              </PayLink>
            )
          )}
        </td>
      </tr>,
      ...(open ? row.items.map((item, i) => itemRow(item, i, { indent: true })) : []),
    ];
  };

  const monthName = `${LONG[Number(month.slice(5, 7)) - 1]}${month.slice(0, 4) === today.slice(0, 4) ? '' : ` ${month.slice(0, 4)}`}`;
  const payingLoans = paying ? loansOf(paying.items) : [];

  return (
    <div className="@container px-[32px] pt-[2px] pb-[32px]" data-testid="schedule-panel">
      <ErrorBox error={error ?? after.error ?? barsError ?? payError} />
      <div className="mb-[14px] flex min-h-[30px] flex-wrap items-center gap-x-[10px] gap-y-[8px]" data-testid="schedule-month-box">
        <button type="button" aria-label="Previous month" className={STEP} onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <h2 data-testid="schedule-month" className="min-w-[96px] text-center text-[17px] font-bold text-[var(--mk-ink)]">
          {monthName}
        </h2>
        <button type="button" aria-label="Next month" className={STEP} onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={16} aria-hidden />
        </button>
        <span className="text-[13px] text-[var(--mk-ink-2)]">due this month</span>
        {debt && (
          <span className="ml-auto flex items-center gap-[8px] text-[13px]" data-testid="schedule-only">
            <span className="text-[var(--mk-ink-2)]">Only</span>
            <span className="flex items-center gap-[6px] rounded-full bg-[var(--mk-card)] py-[3px] pr-[11px] pl-[4px] font-semibold text-[var(--mk-ink)]">
              <DebtKindIcon debt={debt} size={20} />
              {debt.name}
            </span>
            <button type="button" className={PILL} onClick={() => void navigate({ to: '/net-worth/plan/schedule', search: { month }, replace: true })}>
              Show all
            </button>
          </span>
        )}
      </div>
      {totals && (
        <TileRow count={3}>
          <MoneyTile testId="schedule-tile-due" icon={CalendarClock} colour="blue" value={formatMinor(totals.dueMinor, ws.baseCurrency)} label="Due" />
          <MoneyTile testId="schedule-tile-paid" icon={CircleCheck} colour="green" value={formatMinor(totals.paidMinor, ws.baseCurrency)} tone="text-[var(--ph-up)]" label="Paid" />
          <MoneyTile testId="schedule-tile-late" icon={CircleAlert} colour="red" value={formatMinor(totals.lateMinor, ws.baseCurrency)} tone={totals.lateMinor > 0 ? 'text-[var(--mk-t-red)]' : undefined} label="Late" />
        </TileRow>
      )}
      {totals && totals.missing.length > 0 && <p className="-mt-[6px] mb-[14px] text-[12.5px] text-[var(--mk-t-orange)]">No {totals.missing.join(', ')} rate yet, so those are not added up</p>}
      {macV2 && (
        <Card title="Paid against due" icon={BarChart3} note="grey due · green paid" testId="schedule-bars" className="mb-[16px]">
          {bars && <DeskDueBars bars={bars} currency={ws.baseCurrency} height={76} />}
        </Card>
      )}

      <Card title="Schedule" icon={CalendarDays} label="Schedule" testId="schedule-table-box" className="overflow-clip" bodyClassName="px-[10px] pb-[8px]" note="tick instalments to pay several · ▶ opens a debt’s late instalments">
        <table className="w-full border-collapse text-[13.5px]" data-testid="schedule-table">
          <thead>
            <tr>
              <th className={cx(TH, 'w-[34px]')}>
                <span className="sr-only">Tick</span>
              </th>
              <th className={TH}>Payment</th>
              <th className={TH}>When</th>
              <th className={cx(TH, 'text-right')}>Amount</th>
              <th className={cx(TH, 'w-[84px]')}>
                <span className="sr-only">Pay</span>
              </th>
            </tr>
          </thead>
          {sections && late.length > 0 && head && (
            <tbody data-testid="schedule-late">
              <SectionHead tone="alarm" testId="schedule-late-head">
                Late · {head.words}
                {head.totalMinor !== null && <> · {formatMinor(head.totalMinor, ws.baseCurrency)}</>}
              </SectionHead>
              {late.flatMap((row, index) => (row.type === 'group' ? groupRow(row, index) : [itemRow(row.item, index)]))}
            </tbody>
          )}
          {coming.length > 0 && (
            <tbody data-testid="schedule-coming-up">
              <SectionHead>{isCurrent ? 'Coming up · next 30 days' : 'Coming up'}</SectionHead>
              {coming.map((item, index) => itemRow(item, index))}
            </tbody>
          )}
          {sections && sections.paid.length > 0 && (
            <tbody data-testid="schedule-paid">
              <SectionHead>Paid</SectionHead>
              {sections.paid.map((item, index) => itemRow(item, index))}
            </tbody>
          )}
          {all && all.length === 0 && coming.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={5} className="px-[10px] py-[18px] text-center text-[13px] text-[var(--mk-ink-2)]">
                  Nothing due in {monthYearLabel(month)}.
                </td>
              </tr>
            </tbody>
          )}
        </table>
        {chosen.length > 0 && (
          <div
            role="toolbar"
            aria-label="Selected instalments"
            data-testid="select-bar"
            className="sticky bottom-[8px] z-[1] mx-[-2px] mt-[6px] flex items-center gap-[10px] rounded-[14px] bg-[var(--mk-sel)] px-[14px] py-[8px] text-[13px]"
          >
            <span className="font-semibold text-[var(--mk-ink)]">{chosen.length} selected</span>
            <span data-testid="select-total" className="text-[var(--mk-ink-2)] tabular-nums">
              {formatMinor(tickedTotal(chosen), ws.baseCurrency)}
            </span>
            <span className="flex-1" />
            <button type="button" onClick={() => setPicked(new Set())} className={PILL}>
              Clear
            </button>
            <button type="button" onClick={() => setPaying({ title: `Pay ${chosen.length}`, items: chosen })} className={PILL_BLUE}>
              Pay {chosen.length}
            </button>
          </div>
        )}
      </Card>

      {paying && payingLoans.length > 0 && (
        <PayInstalmentsSheet
          title={paying.title}
          loans={payingLoans}
          totalMinor={tickedTotal(paying.items)}
          today={today}
          onClose={() => setPaying(null)}
          onPaid={(paid) => paidAll(payingLoans, paid)}
        />
      )}
      {toast &&
        (toast.undo ? (
          <UndoToast icon="paid" text={toast.text} detail={toast.detail} testId="paid-toast" onUndo={() => void undo()} onDone={clearToast} />
        ) : (
          <TimedToast text={toast.text} detail={toast.detail} onDone={clearToast} />
        ))}
    </div>
  );
}

/** A toast with nothing to undo (a payment that cleared a loan marks it paid off, which Undo cannot reopen). */
function TimedToast({ text, detail, onDone }: { text: string; detail: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return <ToastCard icon="paid" text={text} detail={detail} data-testid="paid-toast" />;
}
