import { formatMinor, isoDate, monthOf, type PayoffMethod } from '@expanses/core';
import type { DebtPlanSettings } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarCheck, CircleAlert, CircleCheck, GripVertical, ListOrdered, type LucideIcon, SlidersHorizontal, TrendingDown, Wallet } from 'lucide-react';
import { type DragEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { cx, ErrorBox } from '../../ui';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { movedBy } from '../transactions/DayReorder';
import { useBoxWidth } from '../networth/DeskNetWorthChart';
import { gridStep, shortMoney } from '../networth/value-chart';
import { type DeskContext, type DeskDebtRow, deskDebtRows, type PayoffLines, payoffLines, payoffStartMinor, shortMonth, yearTicks } from './debt-plan-desk-model';
import { DebtKindIcon, DebtPeek } from './DebtPeek';
import { DeskReport } from './DeskReport';
import { DeskSchedule } from './DeskSchedule';
import { debtDestination } from './PayFirstRowView';
import { PayLink } from './PayLink';
import { LINES, METHODS, settingsOf, useExtraField, withMethod } from './PlanControls';
import { rollsWords, suggestionWords } from './plan-view';
import { type DebtPlanModel, useDebtPlan, useDebtPlanSettings, useLoanPlanFacts, useSaveDebtPlanSettings } from './queries';
import type { ReportPeriod } from './report-view';
import { ShowSheet } from './SchedulePage';
import type { MonthInput } from './schedule-view';
import { macV2 } from '../../ui/mac-detail';
import { CARD, Card, DeskBar, DeskTitle, type IconColour, PILL, PILL_BLUE, PILL_SMALL, RoundIcon, Seg, Tag, TileRow, Track } from '../../ui/desk';

/** A table's head cell in v1: grey words over a hairline, no fill. */
export const TH = 'border-b border-[var(--mk-head-line)] px-[10px] pt-[2px] pb-[8px] text-left text-[12.5px] font-semibold whitespace-nowrap text-[var(--mk-ink-2)]';
/** A table's cell: a hairline under every row but the last. */
export const TD = 'border-b border-[var(--mk-line)] px-[10px] py-[8px] align-middle group-last/row:border-b-0';
/** A row of a v1 table (pairs with `TD`'s last-row rule). */
export const TR = 'group/row';
/** The field a figure is typed into: white, rounded, a hairline. */
export const FIELD = 'flex h-[30px] items-center gap-[5px] rounded-[9px] border border-[var(--mk-field-line)] bg-[var(--mk-field)] px-[10px] focus-within:outline-2 focus-within:outline-[var(--mk-blue)]';

/** A figure's size on a tile: the exact amount always, a step smaller when it is long, so nothing is cut. */
export function tileFigureSize(text: string): string {
  if (text.length <= 14) return 'text-[26px] leading-[32px]';
  if (text.length <= 17) return 'text-[22px] leading-[32px]';
  return 'text-[19px] leading-[32px]';
}

/**
 * A stat tile (the kit's `StatTile` look) that keeps a money figure exact: a round icon and a badge, the figure, what
 * it is. Its parts are divs, label first after the icon row, so a test reads the figure as the tile's second div.
 */
export function MoneyTile({ icon, colour, value, label, badge, testId, valueTestId, tone }: { icon: LucideIcon; colour: IconColour; value: ReactNode; label: ReactNode; badge?: ReactNode; testId?: string; valueTestId?: string; tone?: string }) {
  const size = typeof value === 'string' ? tileFigureSize(value) : 'text-[26px] leading-[32px]';
  return (
    <div data-testid={testId} className={cx(CARD, 'block min-w-0 px-[20px] py-[18px] text-left')}>
      <div className="flex h-[26px] items-center justify-between gap-2">
        <RoundIcon icon={icon} colour={colour} />
        {badge}
      </div>
      <div data-testid={valueTestId} className={cx('mt-[14px] mb-[3px] truncate font-extrabold tracking-[-0.3px] whitespace-nowrap tabular-nums', size, tone ?? 'text-[var(--mk-ink)]')}>
        {value}
      </div>
      <div className="truncate text-[13px] text-[var(--mk-ink-2)]">{label}</div>
    </div>
  );
}

export type DeskView = 'plan' | 'schedule' | 'report';

const VIEWS: { value: DeskView; label: string; to: string }[] = [
  { value: 'plan', label: 'Plan', to: '/net-worth/plan' },
  { value: 'schedule', label: 'Schedule', to: '/net-worth/plan/schedule' },
  { value: 'report', label: 'Report', to: '/net-worth/plan/report' },
];

/**
 * The Debt-free plan on a wide screen (Mac Debt-free plan, owner 2026-11-18), edge to edge under its own title bar: Plan,
 * Schedule and Report as one switch (each its own address, as on the phone), ＋ Add debt and Pay next. Every figure is the
 * phone's plan's own (`useDebtPlan`, the same month items, the same Report); each Pay opens the debt's own sheet, and the
 * Schedule pays several instalments as the loan page's Pay does, with Undo.
 */
export function DesktopDebtPlan({ view, month, period, debt }: { view: DeskView; month?: string; period?: ReportPeriod; debt?: string }) {
  const { ws } = useApp();
  const navigate = useNavigate();
  const today = isoDate();
  const { model, error } = useDebtPlan();
  const facts = useLoanPlanFacts(today);
  const bar = useRef<HTMLElement>(null);
  const [show, setShow] = useState<MonthInput['show']>({ loans: true, cards: true, bills: true });
  const [choosing, setChoosing] = useState(false);
  const payNext = model?.summary.payNext ?? null;
  const ctx: DeskContext | null = model && facts.data ? { today, loanFacts: facts.data, baseCurrency: ws.baseCurrency, ratesToBase: model.ratesToBase } : null;
  const none = model !== null && model.debts.length === 0;

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="debt-plan-page" data-desk="true">
      <DeskBar crumb="Debt-free plan" barRef={bar}>
        {!none && <Seg label="View" value={view} onChange={(next) => void navigate({ to: VIEWS.find((v) => v.value === next)!.to })} options={VIEWS} />}
        {view === 'schedule' && !none && (
          <button type="button" className={PILL} aria-label="Show" aria-expanded={choosing} title="Which kinds the Schedule shows" onClick={() => setChoosing(true)}>
            <SlidersHorizontal size={13} aria-hidden />
            Show
          </button>
        )}
        <button type="button" className={PILL} onClick={() => void navigate({ to: '/debts/new' })}>
          <span aria-hidden>＋</span>Add debt
        </button>
        {payNext?.item.pay && (
          <PayLink target={payNext.item.pay} className={cx(PILL_BLUE, 'max-w-[260px]')} testId="plan-pay-next" label={`Pay next · ${payNext.debt.name}`}>
            <span className="truncate">Pay next · {payNext.debt.name}</span>
          </PayLink>
        )}
      </DeskBar>
      <DeskNotices />
      <DeskTitle title="Debt-free plan" line={model && !none ? <TitleLine model={model} /> : undefined} />
      <ErrorBox error={error ?? facts.error} />
      {none && (
        <div className="px-[32px] pt-[2px] pb-[32px]">
          <section className={cx(CARD, 'px-[20px] py-[18px] text-[13.5px] text-[var(--mk-ink-2)]')}>
            Nothing owed. Debts added on{' '}
            <Link to="/net-worth/loans" className="font-semibold text-[var(--mk-blue)] hover:underline">
              Liabilities
            </Link>{' '}
            show up here.
          </section>
        </div>
      )}
      {model && ctx && !none && view === 'plan' && <PlanView model={model} ctx={ctx} bar={bar} />}
      {model && ctx && !none && view === 'schedule' && <DeskSchedule model={model} ctx={ctx} month={month ?? monthOf(today)} show={show} debtKey={debt ?? null} />}
      {model && !none && view === 'report' && <DeskReport period={period ?? '3m'} />}
      {choosing && <ShowSheet show={show} onShow={setShow} onClose={() => setChoosing(false)} />}
    </div>
  );
}

/** Keys while a peek is open: Esc closes it, ↑ ↓ step — never while typing, or under a sheet. */
export function usePeekKeys(open: boolean, onClose: () => void, onStep: (by: -1 | 1) => void) {
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (!open) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowUp') onStep(-1);
    else if (event.key === 'ArrowDown') onStep(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);
}

/** Where the title bar ends on screen, followed while a peek is open: the peek hangs from it. */
export function usePeekTop(bar: React.RefObject<HTMLElement | null>, open: boolean): number {
  const [top, setTop] = useState(52);
  useEffect(() => {
    if (!open) return;
    const place = () => setTop(Math.max(0, bar.current?.getBoundingClientRect().bottom ?? 52));
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [open, bar]);
  return top;
}

/** Plan: Left to pay, Pay first and the payoff line along the top, then every debt in the order it gets paid. */
function PlanView({ model, ctx, bar }: { model: DebtPlanModel; ctx: DeskContext; bar: React.RefObject<HTMLElement | null> }) {
  const navigate = useNavigate();
  const settings = useDebtPlanSettings();
  const saveSettings = useSaveDebtPlanSettings();
  const [saveError, setSaveError] = useState<unknown>(null);
  const saved = settingsOf(settings.data);
  const save = (next: DebtPlanSettings) => {
    setSaveError(null);
    saveSettings(next).catch(setSaveError);
  };
  // The order just moved by hand, shown at once while it saves (Pay first's own rule).
  const [moved, setMoved] = useState<string[] | null>(null);
  const order = model.method === 'byHand' && moved ? [...model.effect.plan.order.filter((key) => !moved.includes(key)), ...moved] : model.effect.plan.order;
  const rows = deskDebtRows(model.debts, order, model.extraMinor, ctx);
  const keys = rows.map((row) => row.row.debt.key);

  // ── The side peek ──
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const peeked = peekKey ? rows.find((row) => row.row.debt.key === peekKey) : undefined;
  const peeking = peeked !== undefined;
  const step = (by: -1 | 1) => {
    if (!peekKey) return;
    const at = keys.indexOf(peekKey);
    const next = at < 0 ? undefined : keys[Math.min(keys.length - 1, Math.max(0, at + by))];
    if (next) setPeekKey(next);
  };
  usePeekKeys(peeking, () => setPeekKey(null), step);
  const top = usePeekTop(bar, peeking);
  useEffect(() => {
    if (!peekKey) return;
    document.querySelector('[data-debt-row][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [peekKey]);
  const open = (key: string) => {
    const debt = rows.find((row) => row.row.debt.key === key)?.row.debt;
    if (!debt) return;
    window.scrollTo(0, 0);
    void navigate(debtDestination(debt) as Parameters<typeof navigate>[0]);
  };
  const doubleClick = usePeekDoubleClick(open);

  // ── By hand: drag a debt (late ones stay on top), Pay first's own save ──
  const byHand = model.method === 'byHand';
  const movable = rows.filter((row) => row.row.place !== null).map((row) => row.row.debt.key);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const reorder = (next: string[]) => {
    setMoved(next);
    save({ ...saved, method: 'byHand', order: next });
  };
  const drop = (target: string) => {
    const dragged = dragging;
    setDragging(null);
    setOver(null);
    if (!dragged || dragged === target) return;
    const from = movable.indexOf(dragged);
    const to = movable.indexOf(target);
    if (from < 0 || to < 0) return;
    const next = [...movable];
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    reorder(next);
  };
  const drag = (key: string, late: boolean) =>
    byHand && !late
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', key);
            setDragging(key);
          },
          onDragOver: (event: DragEvent) => {
            if (!dragging || !movable.includes(key)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (over !== key) setOver(key);
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            drop(key);
          },
          onDragEnd: () => {
            setDragging(null);
            setOver(null);
          },
        }
      : {};
  const nudge = (key: string, by: -1 | 1) => {
    const next = movedBy(movable, key, by);
    if (next) reorder(next);
  };

  const start = payoffStartMinor(model.debts);
  const lines = payoffLines(model.effect, model.extraMinor, monthOf(ctx.today), start);

  return (
    <div {...doubleClick}>
      <div className={cx('@container px-[32px] pt-[2px] pb-[32px]', peeking && 'mr-[322px]')}>
        <ErrorBox error={saveError} />
        <PlanTiles model={model} currency={ctx.baseCurrency} />
        <div className="mb-[16px] grid grid-cols-1 items-stretch gap-[16px] @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <PayFirstBox
            model={model}
            saved={saved}
            save={(next) => {
              if (next.method !== model.method) setMoved(null);
              save(next);
            }}
            currency={ctx.baseCurrency}
          />
          <ChartBox lines={lines} extraMinor={model.extraMinor} why={model.summary.debtFree.why} currency={ctx.baseCurrency} />
        </div>

        <Card
          title="Debts"
          icon={ListOrdered}
          label="Debts"
          testId="plan-debts"
          className="overflow-clip"
          bodyClassName="px-[10px] pb-[8px]"
          note={byHand ? 'late first (!), then the order set here · drag to reorder' : 'late first (!), then the order they get paid'}
        >
          <table className="w-full border-collapse text-[13.5px]" data-testid="plan-table">
            <thead>
              <tr>
                <th className={cx(TH, 'w-[40px]')}>#</th>
                <th className={TH}>Debt</th>
                <th className={cx(TH, 'hidden @min-[920px]:table-cell')}>Rate</th>
                <th className={cx(TH, 'hidden @min-[720px]:table-cell')}>Progress</th>
                <th className={cx(TH, 'text-right')}>Left</th>
                <th className={cx(TH, 'hidden @min-[860px]:table-cell')}>Next</th>
                <th className={TH}>Late</th>
                <th className={TH}>
                  <span className="sr-only">Pay</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DebtTableRow
                  key={row.row.debt.key}
                  row={row}
                  selected={peekKey === row.row.debt.key}
                  dropTarget={over === row.row.debt.key && dragging !== row.row.debt.key}
                  byHand={byHand}
                  first={movable[0] === row.row.debt.key}
                  last={movable.at(-1) === row.row.debt.key}
                  onNudge={(by) => nudge(row.row.debt.key, by)}
                  onClick={(event) => {
                    event.preventDefault();
                    setPeekKey(row.row.debt.key);
                  }}
                  onOpen={() => open(row.row.debt.key)}
                  drag={drag(row.row.debt.key, row.row.place === null)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      {peeked && (
        <DebtPeek
          key={peeked.row.debt.key}
          debt={peeked.row.debt}
          ctx={ctx}
          effect={model.effect}
          extraMinor={model.extraMinor}
          top={top}
          first={keys.indexOf(peeked.row.debt.key) <= 0}
          last={keys.indexOf(peeked.row.debt.key) === keys.length - 1}
          onStep={step}
          onClose={() => setPeekKey(null)}
          onSchedule={() => void navigate({ to: '/net-worth/plan/schedule', search: { debt: peeked.row.debt.key } })}
        />
      )}
    </div>
  );
}

/** The grey line under the title: how many debts are still owed and the month the last one clears. */
function TitleLine({ model }: { model: DebtPlanModel }) {
  const { counts, debtFree } = model.summary;
  return (
    <>
      <span data-testid="plan-count-active">
        {counts.active} {counts.active === 1 ? 'debt' : 'debts'}
      </span>
      {debtFree.month && <> · debt-free {debtFree.month}</>}
    </>
  );
}

/** The share repaid as a small ring and its figure: the Left to pay tile's badge. */
function Ring({ percent }: { percent: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <span data-testid="plan-ring" role="img" aria-label={`${percent}% repaid`} className="flex items-center gap-[6px] text-[12.5px] font-bold text-[var(--mk-t-green)] tabular-nums">
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden className="shrink-0">
        <circle cx={12} cy={12} r={r} fill="none" stroke="var(--mk-track)" strokeWidth={3.5} />
        {percent > 0 && <circle cx={12} cy={12} r={r} fill="none" stroke="var(--mk-c-green)" strokeWidth={3.5} strokeLinecap="round" strokeDasharray={`${(c * percent) / 100} ${c}`} transform="rotate(-90 12 12)" />}
      </svg>
      {percent}% repaid
    </span>
  );
}

/**
 * The four tiles along the top (v1's stat cards): Left to pay with the share repaid, the Debt-free month, how many are
 * late, how many are paid off. Every figure is the phone's header's own; the repaid-of-borrowed line is a v2 part.
 */
function PlanTiles({ model, currency }: { model: DebtPlanModel; currency: string }) {
  const { summary } = model;
  const { counts, debtFree } = summary;
  const left = summary.leftMinor === null ? '—' : formatMinor(summary.leftMinor, currency);
  return (
    <>
      <TileRow testId="plan-header">
        <MoneyTile
          icon={Wallet}
          colour="blue"
          value={left}
          valueTestId="plan-left"
          badge={<Ring percent={summary.percent} />}
          label={summary.leftMinor === null ? <span className="text-[var(--mk-t-orange)]">No {summary.missing.join(', ')} rate yet</span> : 'Left to pay'}
        />
        <MoneyTile
          icon={CalendarCheck}
          colour="green"
          value={debtFree.month ?? (counts.active > 0 ? 'Unknown' : '—')}
          valueTestId="plan-debt-free"
          label={
            debtFree.why ? (
              <span data-testid="plan-debt-free-why" title={debtFree.why}>
                {debtFree.why}
              </span>
            ) : (
              'Debt-free'
            )
          }
        />
        <MoneyTile
          icon={CircleAlert}
          colour="red"
          value={<span data-testid="plan-count-late">{counts.late}</span>}
          tone={counts.late > 0 ? 'text-[var(--mk-t-red)]' : undefined}
          label="Late"
        />
        <MoneyTile
          icon={CircleCheck}
          colour="teal"
          value={<span data-testid="plan-count-paid-off">{counts.paidOff}</span>}
          label="Paid off"
        />
      </TileRow>
      {macV2 && summary.repaidMinor !== null && summary.borrowedMinor !== null && (
        <p data-testid="plan-repaid" className="-mt-[6px] mb-[14px] px-[4px] text-[13px] text-[var(--mk-ink-2)] tabular-nums">
          Repaid {formatMinor(summary.repaidMinor, currency)} of {formatMinor(summary.borrowedMinor, currency)} borrowed
        </p>
      )}
    </>
  );
}

/** A label left, its value right, a hairline above: a row inside a card. */
function CardRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-t border-[var(--mk-line)] py-[7px] text-[13.5px]">
      <span className="shrink-0 text-[var(--mk-ink)]">{label}</span>
      <span className="flex min-w-0 flex-1 justify-end">{children}</span>
    </div>
  );
}

/** Pay first: the order (today's setting), what it means, Extra a month typed in place, where it goes; the suggestion is v2's. */
function PayFirstBox({ model, saved, save, currency }: { model: DebtPlanModel; saved: DebtPlanSettings; save: (next: DebtPlanSettings) => void; currency: string }) {
  const suggestion = suggestionWords(model.suggestion, model.debts);
  const line = LINES.find((l) => l.method === model.method)!;
  const extra = useExtraField(model, saved, save, currency);
  const rolls = rollsWords(model.effect.plan.order, model.debts);
  return (
    <Card title="Pay first" icon={TrendingDown} label="Pay first" testId="plan-pay-first" bodyClassName="px-[20px] pb-[8px]">
      <Seg label="Order" value={model.method} onChange={(key) => save(withMethod(model, saved, key))} options={METHODS.map((m) => ({ value: m.key as PayoffMethod, label: m.label }))} />
      <p data-testid="plan-method-lines" className="mt-[10px] mb-[10px] text-[12.5px] leading-[17px] text-[var(--mk-ink-2)]">
        <b className="text-[var(--mk-ink)]">{line.name}:</b> {line.text}
      </p>
      {macV2 && suggestion && (
        <p data-testid="plan-suggestion" className="mb-[10px] rounded-[10px] bg-[var(--mk-t-blue-bg)] px-[10px] py-[7px] text-[12px] leading-[16px] text-[var(--mk-t-blue)]">
          {suggestion}
        </p>
      )}
      <CardRow label="Extra a month">
          <span className={FIELD}>
            <span className="text-[12.5px] text-[var(--mk-ink-2)]">{currency}</span>
            <input
              aria-label="Extra a month"
              inputMode="decimal"
              placeholder="Amount"
              value={extra.shown}
              onChange={(event) => extra.type(event.target.value)}
              onBlur={extra.commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  extra.commit();
                } else if (event.key === 'Escape') extra.reset();
              }}
              className="w-[112px] bg-transparent text-right text-[13.5px] text-[var(--mk-ink)] tabular-nums outline-none placeholder:text-[var(--mk-ink-3)]"
            />
          </span>
      </CardRow>
      {extra.error && <p className="pb-[4px] text-right text-[12px] text-[var(--mk-t-red)]">{extra.error}</p>}
      {model.extraMissing && <p className="pb-[4px] text-right text-[12px] text-[var(--mk-t-orange)]">No {model.extraMissing} rate yet, so the extra is left out</p>}
      {rolls && (
        <CardRow label="Goes to">
          <span data-testid="plan-rolls" className="min-w-0 text-right text-[12.5px] text-[var(--mk-ink-2)]">
            {rolls.replace(/^Goes to /, '')}
          </span>
        </CardRow>
      )}
    </Card>
  );
}

const CHART_H = 150;
const GUTTER = 46;
const FOOT = 18;
const TOP = 10;
const RIGHT = 10;

/** Left to pay over time: what is left each month until debt-free, with the extra (green) against without it (grey, dashed). */
function ChartBox({ lines, extraMinor, why, currency }: { lines: PayoffLines | null; extraMinor: number; why: string | null; currency: string }) {
  const [box, width] = useBoxWidth<HTMLDivElement>();
  return (
    <Card
      title="Left to pay over time"
      icon={TrendingDown}
      label="Left to pay over time"
      testId="plan-chart"
      className="h-full"
      note={extraMinor > 0 ? `with ${formatMinor(extraMinor, currency)} extra a month` : 'no extra a month'}
    >
      <div ref={box} className="px-[20px]" style={{ minHeight: CHART_H }}>
        {!lines && <p className="pt-[30px] text-center text-[13px] text-[var(--mk-ink-2)]">{why ?? 'Nothing left to pay.'}</p>}
        {lines && width > 0 && <PayoffDrawing lines={lines} width={width - 40} currency={currency} />}
      </div>
      {lines && (
        <div className="flex flex-wrap gap-x-[14px] gap-y-[2px] px-[20px] pt-[4px] pb-[16px] text-[12px]" data-testid="plan-chart-legend">
          <span data-testid="plan-chart-with" className="font-semibold text-[var(--ph-up)]">
            ━ {lines.without ? 'with extra · ' : ''}debt-free {shortMonth(lines.plan.endMonth)}
          </span>
          {lines.without && (
            <span data-testid="plan-chart-without" className="text-[var(--mk-ink-2)]">
              ┅ without · {shortMonth(lines.without.endMonth)}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

function PayoffDrawing({ lines, width, currency }: { lines: PayoffLines; width: number; currency: string }) {
  const span = Math.max(1, lines.span);
  const top = Math.max(1, lines.plan.points[0] ?? 1);
  const step = gridStep(top / 3);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const max = Math.max(top, ticks.at(-1) ?? top);
  const plotW = Math.max(10, width - GUTTER - RIGHT);
  const plotH = CHART_H - TOP - FOOT;
  const x = (i: number) => GUTTER + (i / span) * plotW;
  const y = (v: number) => TOP + plotH - (v / max) * plotH;
  const path = (points: readonly number[]) => points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const end = lines.plan.points.length - 1;
  return (
    <svg width={width} height={CHART_H} viewBox={`0 0 ${width} ${CHART_H}`} className="block" role="img" aria-label={`Left to pay falls to nothing by ${shortMonth(lines.plan.endMonth)}${lines.without ? `; without the extra by ${shortMonth(lines.without.endMonth)}` : ''}`}>
      <g aria-hidden>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={GUTTER} x2={GUTTER + plotW} y1={y(v)} y2={y(v)} stroke="var(--mk-line)" strokeWidth={1} />
            <text x={GUTTER - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--mk-ink-2)">
              {v === 0 ? '0' : shortMoney(v, currency)}
            </text>
          </g>
        ))}
        {yearTicks(lines.startMonth, span).map((tick) => (
          <text key={tick.label} x={x(tick.at)} y={CHART_H - 4} textAnchor={tick.at === 0 ? 'start' : 'middle'} fontSize={10.5} fill="var(--mk-ink-2)">
            {tick.label}
          </text>
        ))}
        {lines.without && <path data-testid="plan-line-without" d={path(lines.without.points)} fill="none" stroke="var(--mk-ink-3)" strokeWidth={1.6} strokeDasharray="4 4" />}
        <path data-testid="plan-line" d={path(lines.plan.points)} fill="none" stroke="var(--ph-up)" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx={x(end)} cy={y(0)} r={4} fill="var(--ph-up)" />
      </g>
    </svg>
  );
}

/** One debt in the table: badge, kind and name, rate, bar, left, next, late, Pay; narrower, the rest fold under the name. */
function DebtTableRow({
  row,
  selected,
  dropTarget,
  byHand,
  first,
  last,
  onNudge,
  onClick,
  onOpen,
  drag,
}: {
  row: DeskDebtRow;
  selected: boolean;
  dropTarget: boolean;
  byHand: boolean;
  first: boolean;
  last: boolean;
  onNudge: (by: -1 | 1) => void;
  onClick: (event: MouseEvent) => void;
  onOpen: () => void;
  drag: Record<string, unknown>;
}) {
  const { debt, place, pay } = row.row;
  const grey = 'text-[var(--mk-ink-2)]';
  const late = row.late;
  return (
    <tr
      data-debt-row
      data-peek-row={debt.key}
      data-testid="plan-table-row"
      data-name={debt.name}
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onOpen}
      {...drag}
      className={cx(
        TR,
        'cursor-default scroll-mt-[64px] scroll-mb-[16px] text-[var(--mk-ink)]',
        selected ? 'bg-[var(--mk-sel)]' : 'hover:bg-[var(--mk-hover)]',
        dropTarget && 'shadow-[inset_0_2px_0_var(--mk-blue)]',
      )}
    >
      <td className={TD}>
        <span className="flex items-center gap-[2px]">
          <span
            aria-hidden
            className={cx(
              'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
              place === null ? 'bg-[var(--mk-c-red)] text-white' : 'bg-[var(--mk-pill)] text-[var(--mk-ink-2)]',
            )}
          >
            {place === null ? '!' : place}
          </span>
          {byHand && place !== null && (
            <button
              type="button"
              data-reorder-handle=""
              aria-label={`Reorder ${debt.name}`}
              title="Drag to reorder, or ↑ ↓"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                event.stopPropagation();
                if ((event.key === 'ArrowUp' && !first) || (event.key === 'ArrowDown' && !last)) onNudge(event.key === 'ArrowUp' ? -1 : 1);
              }}
              className={cx('flex h-[22px] w-[16px] cursor-grab items-center justify-center rounded', 'text-[var(--mk-ink-3)]')}
            >
              <GripVertical size={14} aria-hidden />
            </button>
          )}
        </span>
      </td>
      <td className={TD}>
        <span className="flex min-w-0 items-center gap-[10px]">
          <DebtKindIcon debt={debt} size={26} />
          <span className="min-w-0">
            <Link
              {...debtDestination(debt)}
              draggable={false}
              onClick={onClick}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="block min-w-0 font-medium break-words"
              data-testid="plan-table-name"
            >
              {debt.name}
            </Link>
            {/* Narrower, the rate, the share repaid and the next payment fold under the name, so no figure is cut. */}
            <span className={cx('block text-[12px] @min-[920px]:hidden', grey)}>
              {row.rate}
              <span className="@min-[720px]:hidden"> · {row.progress}% repaid</span>
              {row.next !== '—' && <span className="@min-[860px]:hidden"> · {row.next === 'no fixed months' ? row.next : `next ${row.next}`}</span>}
            </span>
          </span>
        </span>
      </td>
      <td className={cx(TD, 'hidden whitespace-nowrap @min-[920px]:table-cell', grey)}>{row.rate}</td>
      <td className={cx(TD, 'hidden @min-[720px]:table-cell')}>
        <span className="flex items-center gap-[8px]">
          <Track share={row.progress / 100} colour="var(--mk-c-green)" className="w-[64px] shrink-0" />
          <span data-testid="plan-table-progress" className={cx('text-[12px] whitespace-nowrap tabular-nums', grey)}>
            {row.progress}%
          </span>
        </span>
      </td>
      <td data-testid="plan-table-left" className={cx(TD, 'text-right font-semibold whitespace-nowrap tabular-nums')}>
        {formatMinor(debt.leftMinor, debt.currency)}
      </td>
      <td data-testid="plan-table-next" className={cx(TD, 'hidden whitespace-nowrap tabular-nums @min-[860px]:table-cell', row.next === 'no fixed months' || row.next === '—' ? grey : undefined)}>
        {row.next}
      </td>
      <td data-testid="plan-table-late" className={TD}>
        {late ? (
          <span className="flex flex-wrap items-center gap-x-[6px] gap-y-[2px]">
            <Tag tone="red">{late.words}</Tag>
            <span className={cx('text-[12px] whitespace-nowrap tabular-nums', grey)}>{formatMinor(late.minor, late.currency)}</span>
          </span>
        ) : (
          <span className={grey}>—</span>
        )}
      </td>
      <td className={cx(TD, 'text-right')}>
        {pay && (
          // The Pay button is the debt's own sheet, never the row's peek.
          <span onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <PayLink target={pay} label={`Pay ${debt.name}`} className={PILL_SMALL}>
              Pay
            </PayLink>
          </span>
        )}
      </td>
    </tr>
  );
}
