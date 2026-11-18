import { formatMinor, isoDate, monthOf, type PayoffMethod } from '@expanses/core';
import type { DebtPlanSettings } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { GripVertical, SlidersHorizontal } from 'lucide-react';
import { type DragEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { cx, ErrorBox } from '../../ui';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { movedBy } from '../transactions/DayReorder';
import { BOX, BoxHead, NOTE } from '../transactions/CashflowBoxes';
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

export const GBTN =
  'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';
export const PBTN =
  'inline-flex h-[26px] min-w-0 items-center gap-[3px] rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)]';
export const TH = 'border-b border-[var(--ph-hair)] bg-[var(--mac-head)] px-[10px] py-[6px] text-left text-[11px] font-semibold whitespace-nowrap text-[var(--ph-ink-3)]';
export const TD = 'px-[10px] py-[6px] align-middle';

export type DeskView = 'plan' | 'schedule' | 'report';

const VIEWS: { key: DeskView; label: string; to: string }[] = [
  { key: 'plan', label: 'Plan', to: '/net-worth/plan' },
  { key: 'schedule', label: 'Schedule', to: '/net-worth/plan/schedule' },
  { key: 'report', label: 'Report', to: '/net-worth/plan/report' },
];

/** A switch in the title bar: words on a grey track, the chosen one raised. */
export function Segments<T extends string>({ label, value, onChange, options, fill = false }: { label: string; value: T; onChange: (next: T) => void; options: readonly { key: T; label: string }[]; /** Each the same width, across the whole box. */ fill?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          onClick={() => onChange(option.key)}
          className={cx(
            'rounded-[5px] px-[11px] py-[3px] whitespace-nowrap',
            fill && 'min-w-0 flex-1',
            value === option.key ? 'bg-[var(--ph-selected)] font-medium text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'text-[var(--ph-ink-2)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
      <header ref={bar} className="sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="shrink-0 text-[15px] font-semibold text-[var(--ph-ink)]">Debt-free plan</h1>
        <span className="flex-1" />
        {!none && <Segments label="View" value={view} onChange={(next) => void navigate({ to: VIEWS.find((v) => v.key === next)!.to })} options={VIEWS} />}
        {view === 'schedule' && !none && (
          <button type="button" className={GBTN} aria-label="Show" aria-expanded={choosing} title="Which kinds the Schedule shows" onClick={() => setChoosing(true)}>
            <SlidersHorizontal size={13} aria-hidden />
            Show
          </button>
        )}
        <button type="button" className={GBTN} onClick={() => void navigate({ to: '/debts/new' })}>
          <span aria-hidden>＋</span>Add debt
        </button>
        {payNext?.item.pay && (
          <PayLink target={payNext.item.pay} className={cx(PBTN, 'max-w-[260px]')} testId="plan-pay-next" label={`Pay next · ${payNext.debt.name}`}>
            <span className="truncate">Pay next · {payNext.debt.name}</span>
          </PayLink>
        )}
      </header>
      <DeskNotices />
      <ErrorBox error={error ?? facts.error} />
      {none && (
        <div className="px-[20px] py-[16px]">
          <section className={cx(BOX, 'px-[14px] py-[16px] text-[13px] text-[var(--ph-ink-3)]')}>
            Nothing owed. Debts added on{' '}
            <Link to="/net-worth/loans" className="text-[var(--mac-accent)] hover:underline">
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
      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', peeking && 'mr-[322px]')}>
        <ErrorBox error={saveError} />
        <div className="grid grid-cols-1 items-stretch gap-[14px] @min-[560px]:grid-cols-2 @min-[960px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
          <LeftBox model={model} currency={ctx.baseCurrency} />
          <PayFirstBox
            model={model}
            saved={saved}
            save={(next) => {
              if (next.method !== model.method) setMoved(null);
              save(next);
            }}
            currency={ctx.baseCurrency}
          />
          <div className="min-w-0 @min-[560px]:col-span-2 @min-[960px]:col-span-1">
            <ChartBox lines={lines} extraMinor={model.extraMinor} why={model.summary.debtFree.why} currency={ctx.baseCurrency} />
          </div>
        </div>

        <section className={cx(BOX, 'overflow-clip')} aria-label="Debts" data-testid="plan-debts">
          <BoxHead title="Debts" note={byHand ? 'late first (!), then the order set here · drag to reorder · click one to see it' : 'in the order they get paid: late first (!), then by the chosen order · click one to see it'} />
          <table className="w-full border-collapse text-[13px]" data-testid="plan-table">
            <thead>
              <tr>
                <th className={cx(TH, 'w-[40px] pl-[14px]')}>#</th>
                <th className={TH}>Debt</th>
                <th className={cx(TH, 'hidden @min-[920px]:table-cell')}>Rate</th>
                <th className={cx(TH, 'hidden @min-[720px]:table-cell')}>Progress</th>
                <th className={cx(TH, 'text-right')}>Left</th>
                <th className={cx(TH, 'hidden @min-[860px]:table-cell')}>Next</th>
                <th className={TH}>Late</th>
                <th className={cx(TH, 'pr-[14px]')}>
                  <span className="sr-only">Pay</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <DebtTableRow
                  key={row.row.debt.key}
                  row={row}
                  zebra={index % 2 === 1}
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
        </section>
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

/** The ring of what is repaid. */
function Ring({ percent }: { percent: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg width={86} height={86} viewBox="0 0 86 86" role="img" aria-label={`${percent}% repaid`} data-testid="plan-ring" className="shrink-0">
      <circle cx={43} cy={43} r={r} fill="none" stroke="var(--ph-track)" strokeWidth={9} />
      {percent > 0 && <circle cx={43} cy={43} r={r} fill="none" stroke="var(--ph-up)" strokeWidth={9} strokeLinecap="round" strokeDasharray={`${(c * percent) / 100} ${c}`} transform="rotate(-90 43 43)" />}
      <text x={43} y={48} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--ph-ink)">
        {percent}%
      </text>
    </svg>
  );
}

/** Left to pay: the phone's header — the ring, the figure, repaid of borrowed, the Debt-free month, the three counts. */
function LeftBox({ model, currency }: { model: DebtPlanModel; currency: string }) {
  const { summary } = model;
  const { counts, debtFree } = summary;
  return (
    <section className={BOX} aria-label="Left to pay" data-testid="plan-header">
      <BoxHead title="Left to pay" note={`${counts.active} ${counts.active === 1 ? 'debt' : 'debts'}`} />
      <div className="flex items-center gap-[14px] px-[14px] pb-[8px]">
        <Ring percent={summary.percent} />
        <div className="min-w-0">
          {summary.leftMinor === null ? (
            <div data-testid="plan-left" className="text-[15px] font-semibold text-[var(--ph-warn)]">
              No {summary.missing.join(', ')} rate yet
            </div>
          ) : (
            <div data-testid="plan-left" className="text-[20px] leading-[26px] font-semibold whitespace-nowrap text-[var(--ph-ink)] tabular-nums">
              {formatMinor(summary.leftMinor, currency)}
            </div>
          )}
          {summary.repaidMinor !== null && summary.borrowedMinor !== null && (
            <div data-testid="plan-repaid" className="text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
              repaid {formatMinor(summary.repaidMinor, currency)} of {formatMinor(summary.borrowedMinor, currency)}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-baseline gap-3 border-t border-[var(--ph-hair)] px-[14px] py-[8px] text-[13px]">
        <span className="flex-1 text-[var(--ph-ink)]">Debt-free</span>
        <span data-testid="plan-debt-free" className="font-semibold text-[var(--ph-ink)]">
          {debtFree.month ?? (counts.active > 0 ? 'Unknown' : '—')}
        </span>
      </div>
      {debtFree.why && (
        <p data-testid="plan-debt-free-why" className="-mt-[4px] px-[14px] pb-[6px] text-right text-[11.5px] text-[var(--ph-ink-3)]">
          {debtFree.why}
        </p>
      )}
      <div className="grid grid-cols-3 border-t border-[var(--ph-hair)] text-center">
        <Count testId="plan-count-active" n={counts.active} word="active" tone="text-[var(--ph-ink)]" />
        <Count testId="plan-count-late" n={counts.late} word="late" tone={counts.late > 0 ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink)]'} />
        <Count testId="plan-count-paid-off" n={counts.paidOff} word="paid off" tone={counts.paidOff > 0 ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]'} />
      </div>
    </section>
  );
}

function Count({ testId, n, word, tone }: { testId: string; n: number; word: string; tone: string }) {
  return (
    <div data-testid={testId} className="py-[8px]">
      <span className={cx('block text-[18px] leading-[22px] font-semibold', tone)}>{n}</span>
      <span className="block text-[11.5px] text-[var(--ph-ink-3)]">{word}</span>
    </div>
  );
}

/** Pay first: the order (today's setting), what it means, the suggestion, Extra a month typed in place, where it goes. */
function PayFirstBox({ model, saved, save, currency }: { model: DebtPlanModel; saved: DebtPlanSettings; save: (next: DebtPlanSettings) => void; currency: string }) {
  const suggestion = suggestionWords(model.suggestion, model.debts);
  const line = LINES.find((l) => l.method === model.method)!;
  const extra = useExtraField(model, saved, save, currency);
  const rolls = rollsWords(model.effect.plan.order, model.debts);
  return (
    <section className={BOX} aria-label="Pay first" data-testid="plan-pay-first">
      <BoxHead title="Pay first" />
      <div className="px-[14px]">
        <Segments fill label="Order" value={model.method} onChange={(key) => save(withMethod(model, saved, key as PayoffMethod))} options={METHODS as unknown as { key: PayoffMethod; label: string }[]} />
        <p data-testid="plan-method-lines" className="mt-[8px] mb-[6px] text-[12px] leading-[17px] text-[var(--ph-ink)]">
          <b>{line.name}:</b> {line.text}
        </p>
        {suggestion && (
          <p data-testid="plan-suggestion" className="rounded-[6px] bg-[var(--ph-info-panel)] px-[8px] py-[6px] text-[11.5px] leading-[15px] text-[var(--ph-info-ink)]">
            {suggestion}
          </p>
        )}
      </div>
      <label className="mt-[8px] flex items-center gap-3 border-t border-[var(--ph-hair)] px-[14px] py-[6px] text-[13px]">
        <span className="flex-1 text-[var(--ph-ink)]">Extra a month</span>
        <span className="flex h-[24px] items-center gap-[4px] rounded-[5px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[7px] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--mac-accent)]">
          <span className="text-[12px] text-[var(--ph-ink-3)]">{currency}</span>
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
            className="w-[104px] bg-transparent text-right text-[13px] text-[var(--ph-ink)] tabular-nums outline-none"
          />
        </span>
      </label>
      {extra.error && <p className="px-[14px] pb-[4px] text-right text-[11.5px] text-[var(--ph-alarm)]">{extra.error}</p>}
      {model.extraMissing && <p className="px-[14px] pb-[4px] text-right text-[11.5px] text-[var(--ph-warn)]">No {model.extraMissing} rate yet, so the extra is left out</p>}
      {rolls && (
        <div className="flex items-baseline gap-3 border-t border-[var(--ph-hair)] px-[14px] py-[8px] text-[13px]">
          <span className="shrink-0 text-[var(--ph-ink)]">Goes to</span>
          <span data-testid="plan-rolls" className="min-w-0 flex-1 text-right text-[11.5px] text-[var(--ph-ink-3)]">
            {rolls.replace(/^Goes to /, '')}
          </span>
        </div>
      )}
    </section>
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
    <section className={cx(BOX, 'h-full')} aria-label="Left to pay over time" data-testid="plan-chart">
      <BoxHead title="Left to pay over time" note={extraMinor > 0 ? `with ${formatMinor(extraMinor, currency)} extra a month` : 'no extra a month'} />
      <div ref={box} className="px-[14px]" style={{ minHeight: CHART_H }}>
        {!lines && <p className="pt-[30px] text-center text-[12.5px] text-[var(--ph-ink-3)]">{why ?? 'Nothing left to pay.'}</p>}
        {lines && width > 0 && <PayoffDrawing lines={lines} width={width - 28} currency={currency} />}
      </div>
      {lines && (
        <div className="flex flex-col gap-[2px] px-[14px] pt-[2px] pb-[10px] text-[11.5px]" data-testid="plan-chart-legend">
          <span data-testid="plan-chart-with" className="font-semibold text-[var(--ph-up)]">
            ━ {lines.without ? 'with extra · ' : ''}debt-free {shortMonth(lines.plan.endMonth)}
          </span>
          {lines.without && (
            <span data-testid="plan-chart-without" className="text-[var(--ph-ink-3)]">
              ┅ without · {shortMonth(lines.without.endMonth)}
            </span>
          )}
        </div>
      )}
    </section>
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
            <line x1={GUTTER} x2={GUTTER + plotW} y1={y(v)} y2={y(v)} stroke="var(--ph-hair)" strokeWidth={1} />
            <text x={GUTTER - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--ph-ink-3)">
              {v === 0 ? '0' : shortMoney(v, currency)}
            </text>
          </g>
        ))}
        {yearTicks(lines.startMonth, span).map((tick) => (
          <text key={tick.label} x={x(tick.at)} y={CHART_H - 4} textAnchor={tick.at === 0 ? 'start' : 'middle'} fontSize={10} fill="var(--ph-ink-3)">
            {tick.label}
          </text>
        ))}
        {lines.without && <path data-testid="plan-line-without" d={path(lines.without.points)} fill="none" stroke="var(--ph-ink-3)" strokeWidth={1.6} strokeDasharray="4 4" />}
        <path data-testid="plan-line" d={path(lines.plan.points)} fill="none" stroke="var(--ph-up)" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx={x(end)} cy={y(0)} r={4} fill="var(--ph-up)" />
      </g>
    </svg>
  );
}

/** One debt in the table: badge, kind and name, rate, bar, left, next, late, Pay; narrower, the rest fold under the name. */
function DebtTableRow({
  row,
  zebra,
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
  zebra: boolean;
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
  const grey = selected ? 'text-white/85' : 'text-[var(--ph-ink-3)]';
  const late = row.late;
  const pill = (words: string): ReactNode => (
    <span className={cx('rounded-[4px] px-[5px] text-[11px] font-semibold whitespace-nowrap', selected ? 'bg-white/20 text-white' : 'bg-[var(--ph-alarm-panel)] text-[var(--ph-alarm)]')}>{words}</span>
  );
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
        'cursor-default scroll-mt-[64px] scroll-mb-[16px]',
        selected ? 'bg-[var(--mac-accent)] text-white' : zebra ? 'bg-[var(--mac-zebra)]' : undefined,
        dropTarget && 'shadow-[inset_0_2px_0_var(--mac-accent)]',
      )}
    >
      <td className={cx(TD, 'pl-[14px]')}>
        <span className="flex items-center gap-[2px]">
          <span aria-hidden className={cx('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white', place === null ? 'bg-[var(--ph-alarm)]' : selected ? 'bg-white/25' : 'bg-[var(--ph-ink)]')}>
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
              className={cx('flex h-[22px] w-[16px] cursor-grab items-center justify-center rounded', grey)}
            >
              <GripVertical size={14} aria-hidden />
            </button>
          )}
        </span>
      </td>
      <td className={TD}>
        <span className="flex min-w-0 items-center gap-[9px]">
          <DebtKindIcon debt={debt} size={24} />
          <span className="min-w-0">
            <Link
              {...debtDestination(debt)}
              draggable={false}
              onClick={onClick}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="block min-w-0 break-words"
              data-testid="plan-table-name"
            >
              {debt.name}
            </Link>
            {/* Narrower, the rate, the share repaid and the next payment fold under the name, so no figure is cut. */}
            <span className={cx('block text-[11.5px] @min-[920px]:hidden', grey)}>
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
          <span className="block h-[4px] w-[64px] shrink-0 overflow-hidden rounded-full bg-[var(--ph-track)]">
            <span className="block h-full rounded-full" style={{ width: `${row.progress}%`, background: selected ? 'white' : 'var(--ph-up)' }} />
          </span>
          <span data-testid="plan-table-progress" className={cx('text-[11.5px] whitespace-nowrap tabular-nums', grey)}>
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
            {pill(late.words)}
            <span className={cx('text-[12px] whitespace-nowrap tabular-nums', grey)}>{formatMinor(late.minor, late.currency)}</span>
          </span>
        ) : (
          <span className={grey}>—</span>
        )}
      </td>
      <td className={cx(TD, 'pr-[14px] text-right')}>
        {pay && (
          // The Pay button is the debt's own sheet, never the row's peek.
          <span onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <PayLink
              target={pay}
              label={`Pay ${debt.name}`}
              className={cx('inline-flex h-[22px] items-center rounded-[6px] px-[10px] text-[12px] font-medium', selected ? 'bg-white text-[var(--mac-accent)]' : 'bg-[var(--ph-ink)] text-[var(--ph-surface)]')}
            >
              Pay
            </PayLink>
          </span>
        )}
      </td>
    </tr>
  );
}

/** A box's note, for the other views' boxes. */
export const BoxNote = ({ children }: { children: ReactNode }) => <span className={NOTE}>{children}</span>;
