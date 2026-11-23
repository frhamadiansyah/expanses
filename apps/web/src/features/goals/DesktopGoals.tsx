import { formatMinor, fundingOrder, type GoalClass, goalClass, isoDate } from '@expanses/core';
import { type GoalPlanRow, reorderGoals, retagTrade } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { type DragEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { compactMoney } from '../../app/sidebar-model';
import { useEscape } from '../../app/use-escape';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { bareFigure } from '../networth/debt-rows';
import { useTrades } from '../networth/queries';
import { BOX, BoxHead, NOTE } from '../transactions/CashflowBoxes';
import { TagPurchaseSheet } from './FundingSheet';
import { fundingLines } from './funding-lines';
import { setAsideOf } from './goal-actions';
import { type GoalCard, goalCard, GOAL_KIND_MARKS, goalsTotals, onTrackLine, shortfallWhy } from './goal-cards';
import { movedOrder } from './goal-moves';
import { initialsLine } from './goal-sharing';
import { applyTagChanges } from './goal-tags';
import { GoalPeek, type GoalSheetName, Initials, KindIcon } from './GoalPeek';
import { MonthlySheet, UseSheet } from './GoalSheets';
import {
  type ChartPage,
  finishOn,
  fitLine,
  fitText,
  type Lane,
  readChartPage,
  savingBar,
  savingRows,
  type SavingRow,
  stepPage,
  swipeStep,
  timelineAxis,
  timelineLanes,
  writeChartPage,
} from './goals-desk-model';
import { useEarmarks, useGoalPlans, useGoalShares } from './queries';
import { SetAsideSheet } from './SetAside';
import { DeskBar, DeskTitle, PILL, PILL_BLUE } from '../../ui/desk';

const GBTN = PILL;
const PBTN = PILL_BLUE;
const TH = 'border-b border-[var(--ph-hair)] bg-[var(--mac-head)] px-[10px] py-[6px] text-left text-[11px] font-semibold whitespace-nowrap text-[var(--ph-ink-3)]';
const TD = 'px-[10px] py-[6px] align-middle';

/** The table's two sections, in funding order: what is saved reaches the compulsory goals first. */
const SECTIONS: { key: GoalClass; title: string; note: string }[] = [
  { key: 'compulsory', title: 'Compulsory', note: 'saving reaches these first' },
  { key: 'additional', title: 'Additional', note: 'in this order after them · drag to reorder' },
];

type Segment = 'active' | 'done';

/** One goal as the desk reads it: its plan, its card (the phone's), and on a shared goal its members' initials. */
interface DeskGoal {
  plan: GoalPlanRow;
  card: GoalCard;
  initials: string[] | null;
  /** Funded by, one name an account (pockets fold under theirs), as its page lists them. */
  fundedBy: string[];
}

/**
 * Goals on a wide screen (Mac Goals, owner 2026-11-17): a title bar with Active / Done, Set aside and ＋ Add goal; three
 * boxes — what is saved for the goals (the phone's card), what is needed, set up and saved each month, and a chart box of
 * two pages, swiped with two fingers or turned by its dots and arrows: where the month's saving goes in goal order, and
 * when each goal is due — over every goal in one table, compulsory first. A click opens the goal's side peek (its page in
 * brief, with its actions), a double-click its page. Every figure is the phone's own: the same plans, the same cards.
 */
export function DesktopGoals() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const summary = useGoalPlans(today);
  const shares = useGoalShares().data ?? {};
  const earmarks = useEarmarks();
  const accounts = useAccounts().data ?? [];
  const trades = useTrades().data ?? [];
  const currency = ws.baseCurrency;
  const [segment, setSegment] = useState<Segment>('active');
  const [error, setError] = useState<unknown>(null);

  // The phone's list, read the same way: funding order, each goal's card, the totals over all of them.
  const plans = summary.data?.plans ?? [];
  const ordered = fundingOrder(plans.map((plan) => ({ ...plan, kind: plan.goal.kind, rank: plan.goal.rank })));
  const goals: DeskGoal[] = ordered.map((plan) => {
    const share = shares[plan.goalId];
    return {
      plan,
      card: goalCard(plan, { me: share?.me ?? null, baseCurrency: ws.baseCurrency }),
      initials: share?.state === 'on' ? initialsLine(share.members.map((member) => member.name)) : null,
      fundedBy: fundingLines(plan.links, accounts, plan.currency).map((line) => (line.type === 'link' ? line.link.name : line.name)),
    };
  });
  const cards = goals.map((goal) => goal.card);
  const totals = goalsTotals(cards);
  const shortfall = (summary.data?.neededMonthlyMinor ?? 0) - (summary.data?.capacityMonthlyMinor ?? 0);
  const fitting = summary.data?.fits.filter((fit) => fit.fits === 'full').length ?? 0;
  const shown = goals.filter((goal) => (segment === 'done' ? goal.card.done : !goal.card.done));
  const byId = new Map(goals.map((goal) => [goal.card.goalId, goal]));
  // The table's order, section by section, is the peek's order for ⌃ ⌄.
  const order = SECTIONS.flatMap((section) => shown.filter((goal) => goalClass(goal.card.kind) === section.key)).map((goal) => goal.card.goalId);

  const saving = savingRows(
    summary.data?.fits ?? [],
    goals.map((goal) => ({ goalId: goal.card.goalId, name: goal.card.name, kind: goal.card.kind, neededBaseMinor: goal.plan.ownNeededMonthlyBaseMinor, done: goal.card.done })),
  );
  const running = goals.filter((goal) => !goal.card.done);
  const dues = running.map((goal) => ({ goal, dueOn: finishOn(goal.plan.stages) })).filter((row): row is { goal: DeskGoal; dueOn: string } => row.dueOn !== null);
  const axis = timelineAxis(
    dues.map((row) => row.dueOn),
    today,
  );
  const lanes = timelineLanes(
    dues.map(({ goal, dueOn }) => ({ goalId: goal.card.goalId, name: goal.card.name, kind: goal.card.kind, dueOn, progress: goal.card.progressPercent / 100, behind: goal.card.statusLabel === 'Behind' })),
    axis,
    today,
  );

  // ── The side peek ─────────────────────────────────────────────────────────────────────────────────────────────────
  const [peekId, setPeekId] = useState<string | null>(null);
  const peeked = peekId !== null && order.includes(peekId) ? byId.get(peekId) : undefined;
  const peeking = peeked !== undefined;
  const step = (by: -1 | 1) => {
    if (!peekId) return;
    const at = order.indexOf(peekId);
    const next = at < 0 ? undefined : order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setPeekId(next);
  };
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);
  // The page makes room for the peek as it opens, which can move the boxes under one another: the row picked is brought
  // back into view. A double-click whose second click lands off the moved row is still the row's (`usePeekDoubleClick`).
  useEffect(() => {
    if (!peekId) return;
    document.querySelector('[data-goal-row][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [peekId]);
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

  /** The goal's own page: today's, with its stages, Funded by, the months of its Monthly and the ⋯. */
  const open = (id: string) => {
    window.scrollTo(0, 0);
    void navigate({ to: '/goals/$goalId', params: { goalId: id } });
  };
  const onRow = (id: string) => (event: MouseEvent) => {
    event.preventDefault();
    setPeekId(id);
  };
  const doubleClick = usePeekDoubleClick(open);

  // ── The sheets, the goal page's own ───────────────────────────────────────────────────────────────────────────────
  const [aside, setAside] = useState<{ goalId: string; focus?: string } | null>(null);
  const [sheet, setSheet] = useState<{ goalId: string; name: GoalSheetName } | null>(null);
  const asideGoal = aside ? byId.get(aside.goalId) : undefined;
  const sheetGoal = sheet ? byId.get(sheet.goalId) : undefined;

  // ── Drag to reorder, within a section (today's Move up / Move down rule, `movedOrder`, written by `reorderGoals`) ──
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const sameSection = (a: string, b: string) => {
    const one = byId.get(a);
    const two = byId.get(b);
    return !!one && !!two && goalClass(one.card.kind) === goalClass(two.card.kind);
  };
  async function drop(target: string) {
    const dragged = dragging;
    setDragging(null);
    setOver(null);
    if (!dragged || dragged === target || !sameSection(dragged, target)) return;
    const ids = ordered.map((plan) => ({ goalId: plan.goalId, kind: plan.goal.kind }));
    const from = ids.findIndex((row) => row.goalId === dragged);
    const to = ids.findIndex((row) => row.goalId === target);
    const next = movedOrder(ids, dragged, to - from);
    if (!next) return;
    try {
      setError(null);
      await reorderGoals(database, ws, next);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }
  const drag = (id: string) =>
    segment === 'active'
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', id);
            setDragging(id);
          },
          onDragOver: (event: DragEvent) => {
            if (!dragging || !sameSection(dragging, id)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (over !== id) setOver(id);
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            void drop(id);
          },
          onDragEnd: () => {
            setDragging(null);
            setOver(null);
          },
        }
      : {};

  const ready = summary.data !== undefined;
  const anyGoals = goals.length > 0;

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="goals-page" data-desk="true" {...doubleClick}>
      <DeskBar crumb="Goals" barRef={bar}>
        <Segments
          label="Goals shown"
          value={segment}
          onChange={(next) => {
            setSegment(next);
            setPeekId(null);
          }}
          options={[
            { key: 'active', label: 'Active' },
            { key: 'done', label: 'Done' },
          ]}
        />
        <SetAsideButton goals={running} peeked={peeked && !peeked.card.done ? peeked.card.goalId : null} onPick={(goalId) => setAside({ goalId })} />
        <button type="button" className={PBTN} onClick={() => void navigate({ to: '/goals/new' })}>
          <span aria-hidden>＋</span>Add goal
        </button>
      </DeskBar>
      <DeskNotices />
      <DeskTitle title="Goals" />

      {/* The peek makes room on the whole page, so it covers no figure; the boxes go by the room they have. */}
      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peeking && 'mr-[322px]')}>
        <ErrorBox error={summary.error ?? error} />
        {ready && segment === 'active' && running.length > 0 && summary.data && (
          <div className="grid grid-cols-1 items-stretch gap-[14px] @min-[560px]:grid-cols-2 @min-[900px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.55fr)]">
            <section className={BOX} aria-label="Saved for goals" data-testid="goals-card">
              <BoxHead title="Saved for goals" />
              <div className="px-[14px] pb-[12px]">
                <div data-testid="goals-saved" className="text-[26px] leading-[32px] font-semibold tabular-nums text-[var(--ph-ink)]">
                  {formatMinor(totals.savedMinor, currency)}
                </div>
                <div data-testid="goals-on-track" className="mt-[2px] text-[12.5px] text-[var(--ph-ink-3)]">
                  {onTrackLine(totals)}
                </div>
                {shortfall > 0 && <ShortChip text={`Short ${formatMinor(shortfall, currency)} a month`} why={shortfallWhy(fitting, cards.length)} />}
                {fitLine(saving) && (
                  <p data-testid="goals-fit-line" className="mt-[10px] text-[11.5px] leading-[15px] text-[var(--ph-ink-3)]">
                    {fitLine(saving)}
                  </p>
                )}
              </div>
            </section>
            <section className={BOX} aria-label="Each month" data-testid="goals-each-month">
              <BoxHead title="Each month" />
              <MonthFigures needed={summary.data.neededMonthlyMinor} setUp={summary.data.plannedMonthlyMinor} saved={summary.data.capacityMonthlyMinor} currency={currency} />
            </section>
            {/* Two boxes a row in a narrower page (the peek open at 1280): the chart goes under them, the width of both. */}
            <div className="flex min-w-0 flex-col @min-[560px]:col-span-2 @min-[900px]:col-span-1">
              <ChartBox
                saving={saving}
                savedMinor={summary.data.capacityMonthlyMinor}
                lanes={lanes}
                axisTicks={axis.ticks}
                currency={currency}
                onGoal={(id) => setPeekId(id)}
              />
            </div>
          </div>
        )}

        <section className={cx(BOX, 'overflow-clip')} aria-label="Goals" data-testid="goals-table-box">
          <BoxHead title={segment === 'done' ? 'Done' : 'Goals'} note={shown.length > 0 ? 'click a goal to see it' : undefined} />
          {ready && shown.length === 0 && (
            <p className="px-[14px] pt-1 pb-4 text-[13px] text-[var(--ph-ink-3)]">{segment === 'done' ? 'No goal is done yet.' : anyGoals ? 'Every goal is done.' : 'No goals yet.'}</p>
          )}
          {shown.length > 0 && (
            <table className="w-full border-collapse text-[13px]" data-testid="goals-table">
              <thead>
                <tr>
                  <th className={cx(TH, 'pl-[14px]')}>Goal</th>
                  <th className={cx(TH, 'hidden @min-[1000px]:table-cell')}>By</th>
                  <th className={cx(TH, 'hidden @min-[760px]:table-cell')}>Status</th>
                  <th className={TH}>Progress</th>
                  <th className={cx(TH, 'text-right')}>Saved</th>
                  <th className={cx(TH, 'text-right', 'pr-[14px] @min-[1000px]:pr-[10px]')}>Set up a month</th>
                  <th className={cx(TH, 'hidden pr-[14px] @min-[1000px]:table-cell')}>Funded by</th>
                </tr>
              </thead>
              {SECTIONS.map((section) => {
                const rows = shown.filter((goal) => goalClass(goal.card.kind) === section.key);
                if (rows.length === 0) return null;
                return (
                  <tbody key={section.key} data-testid={`goals-${section.key}`}>
                    <tr>
                      <td colSpan={7} className="px-[14px] pt-[10px] pb-[4px] text-[11px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
                        {section.title}
                        <span className="ml-[8px] font-normal tracking-normal normal-case">{segment === 'active' ? section.note : section.note.split(' · ')[0]}</span>
                      </td>
                    </tr>
                    {rows.map((goal, index) => (
                      <GoalRow
                        key={goal.card.goalId}
                        goal={goal}
                        zebra={index % 2 === 1}
                        selected={peekId === goal.card.goalId}
                        dropTarget={over === goal.card.goalId && dragging !== goal.card.goalId}
                        onClick={onRow(goal.card.goalId)}
                        onOpen={() => open(goal.card.goalId)}
                        drag={drag(goal.card.goalId)}
                      />
                    ))}
                  </tbody>
                );
              })}
            </table>
          )}
        </section>
      </div>

      {peeked && (
        <GoalPeek
          key={peeked.card.goalId}
          plan={peeked.plan}
          card={peeked.card}
          initials={peeked.initials}
          held={setAsideOf(earmarks.data ?? [], peeked.card.goalId).length > 0}
          top={peekTop}
          first={order.indexOf(peeked.card.goalId) <= 0}
          last={order.indexOf(peeked.card.goalId) === order.length - 1}
          onStep={step}
          onClose={() => setPeekId(null)}
          onOpen={() => open(peeked.card.goalId)}
          onSetAside={(focus) => setAside({ goalId: peeked.card.goalId, focus })}
          onSheet={(name) => setSheet({ goalId: peeked.card.goalId, name })}
        />
      )}

      {/* Still needed unclamped, as the goal page passes it: an over-funded goal's take back reads no figure still needed. */}
      {asideGoal && (
        <SetAsideSheet
          goal={asideGoal.plan.goal}
          earmarks={earmarks.data ?? []}
          neededMinor={asideGoal.card.targetMinor > 0 ? asideGoal.card.targetMinor - asideGoal.card.paidMinor - asideGoal.card.currentMinor : null}
          focusAccountId={aside?.focus}
          onDone={() => setAside(null)}
        />
      )}
      {sheetGoal && sheet?.name === 'tag' && (
        <TagPurchaseSheet
          goalId={sheetGoal.card.goalId}
          tagged={trades.filter((trade) => trade.goalId === sheetGoal.card.goalId).map((trade) => trade.id)}
          onPickMany={(tradeIds) =>
            void applyTagChanges((tradeId, to) => retagTrade(database, ws, tradeId, to), sheetGoal.card.goalId, { tag: tradeIds, untag: [] }).then(({ failed }) => {
              void invalidate();
              if (failed.length > 0) setError(new Error(failed[0]!.message));
            })
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheetGoal && sheet?.name === 'use' && <UseSheet plan={sheetGoal.plan} earmarks={earmarks.data ?? []} onClose={() => setSheet(null)} />}
      {sheetGoal && sheet?.name === 'monthly' && <MonthlySheet plan={sheetGoal.plan} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** One goal in the table: its kind and name (initials on a shared goal), date, status, bar, saved, set up, funded by. */
function GoalRow({
  goal,
  zebra,
  selected,
  dropTarget,
  onClick,
  onOpen,
  drag,
}: {
  goal: DeskGoal;
  zebra: boolean;
  selected: boolean;
  dropTarget: boolean;
  onClick: (event: MouseEvent) => void;
  onOpen: () => void;
  drag: Record<string, unknown>;
}) {
  const { card } = goal;
  const warn = card.statusTone === 'warn';
  const grey = selected ? 'text-white/85' : 'text-[var(--ph-ink-3)]';
  const tone = (ink: string) => (selected ? 'text-white' : ink);
  const statusInk = tone(warn ? 'text-[var(--ph-warn)]' : card.done || card.statusLabel === 'Funded' ? 'text-[var(--ph-ink-2)]' : 'text-[var(--ph-up)]');
  const short = card.differenceMinor < 0 && !card.done && card.neededMonthlyMinor > 0;
  const status = <span className={statusInk}>{card.statusLabel}</span>;
  return (
    <tr
      data-goal-row
      data-peek-row={card.goalId}
      data-testid="goal-row"
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
        <span className="flex min-w-0 items-center gap-[9px]">
          <KindIcon kind={card.kind} size={24} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-[6px]">
              {/* The name is the goal's page, as a link: a click still opens the peek, a double-click the page. */}
              <Link
                to="/goals/$goalId"
                params={{ goalId: card.goalId }}
                draggable={false}
                onClick={onClick}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onOpen();
                }}
                className="min-w-0 break-words"
                data-testid="goal-row-name"
              >
                {card.name}
              </Link>
              {goal.initials && <Initials initials={goal.initials} testId="goal-row-initials" selected={selected} />}
            </span>
            {/* In a narrower page the date, the status and Funded by fold under the name, so no figure is cut. */}
            <span className={cx('block text-[11.5px] @min-[1000px]:hidden', grey)}>
              by {card.dueLabel}
              <span className="@min-[760px]:hidden"> · {status}</span>
              {goal.fundedBy.length > 0 ? ` · ${goal.fundedBy.join(' · ')}` : ''}
            </span>
          </span>
        </span>
      </td>
      <td className={cx(TD, 'hidden whitespace-nowrap @min-[1000px]:table-cell', grey)}>{card.dueLabel}</td>
      <td data-testid="goal-row-status" className={cx(TD, 'hidden whitespace-nowrap @min-[760px]:table-cell')}>
        {status}
      </td>
      <td className={TD}>
        <span className="flex items-center gap-[8px]">
          <span className="w-[56px] shrink-0">
            <span className="block h-[4px] overflow-hidden rounded-full bg-[var(--ph-track)]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${card.done ? 100 : card.progressPercent}%`, background: selected ? 'white' : warn ? 'var(--ph-warn)' : 'var(--ph-up)' }}
              />
            </span>
          </span>
          <span data-testid="goal-row-progress" className={cx('text-[12px] whitespace-nowrap tabular-nums', grey)}>
            {Math.round(card.done ? 100 : card.progressPercent)}%{card.targetMinor > 0 ? ` of ${compactMoney(card.targetMinor, card.currency)}` : ''}
          </span>
        </span>
      </td>
      <td data-testid="goal-row-saved" className={cx(TD, 'text-right font-semibold whitespace-nowrap tabular-nums')}>
        {formatMinor(card.currentMinor, card.currency)}
      </td>
      <td data-testid="goal-row-set-up" className={cx(TD, 'pr-[14px] text-right whitespace-nowrap tabular-nums @min-[1000px]:pr-[10px]')}>
        {card.neededMonthlyMinor === 0 && card.plannedMonthlyMinor === 0 ? (
          <span className={grey}>—</span>
        ) : short ? (
          <>
            <span className={tone('text-[var(--ph-warn)]')}>{formatMinor(card.plannedMonthlyMinor, card.currency)}</span>
            <span className={grey}> of {bareFigure(card.neededMonthlyMinor, card.currency)}</span>
          </>
        ) : (
          formatMinor(card.plannedMonthlyMinor, card.currency)
        )}
      </td>
      <td data-testid="goal-row-funded-by" className={cx(TD, 'hidden max-w-[220px] pr-[14px] @min-[1000px]:table-cell')}>
        {goal.fundedBy.length > 0 ? (
          <span className={cx('block truncate', grey)} title={goal.fundedBy.join(' · ')}>
            {goal.fundedBy.join(' · ')}
          </span>
        ) : (
          <span className={tone('text-[var(--ph-warn)]')}>Nothing yet</span>
        )}
      </td>
    </tr>
  );
}

/** "Short Rp 4.520.000 a month", with why behind its ⓘ: the phone's chip and words. */
function ShortChip({ text, why }: { text: string; why: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-[10px]">
      <div className="flex items-center gap-[6px]">
        <span data-testid="goals-short" className="rounded-full bg-[var(--ph-warn-panel)] px-[10px] py-[3px] text-[12px] font-medium whitespace-nowrap text-[var(--ph-warn-ink)]">
          {text}
        </span>
        <button
          type="button"
          aria-label="About the shortfall"
          aria-expanded={open}
          title={why}
          onClick={() => setOpen((was) => !was)}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[var(--ph-ink-3)] hover:text-[var(--ph-ink)]"
        >
          <Info size={14} aria-hidden />
        </button>
      </div>
      {open && (
        <p data-testid="goals-short-why" className="pt-[6px] text-[11.5px] leading-[15px] text-[var(--ph-ink-3)]">
          {why}
        </p>
      )}
    </div>
  );
}

/** Needed, Set up and Saved a month, each with a thin bar against the largest of the three. */
function MonthFigures({ needed, setUp, saved, currency }: { needed: number; setUp: number; saved: number; currency: string }) {
  const top = Math.max(1, needed, setUp, saved);
  const rows = [
    { label: 'Needed a month', minor: needed, colour: 'var(--ph-ink)', testId: 'goals-needed' },
    { label: 'Set up a month', minor: setUp, colour: 'var(--ph-ink-3)', testId: 'goals-set-up', why: 'Monthly buys and standing transfers set up for the goals.' },
    { label: 'Saved a month', minor: saved, colour: 'var(--ph-up)', testId: 'goals-saved-monthly' },
  ];
  return (
    <div className="pb-[10px]">
      {rows.map((row) => (
        <div key={row.label} className="px-[14px] py-[5px]" title={row.why}>
          <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-[var(--ph-ink)]">
            <span className="min-w-0 truncate">{row.label}</span>
            <span data-testid={row.testId} className="shrink-0 whitespace-nowrap tabular-nums">
              {formatMinor(row.minor, currency)}
            </span>
          </div>
          <div className="mt-[4px] h-[6px] overflow-hidden rounded-full bg-[var(--ph-track)]">
            <span className="block h-full rounded-full" style={{ width: `${(Math.max(0, row.minor) / top) * 100}%`, background: row.colour }} />
          </div>
        </div>
      ))}
      <p className="px-[14px] pt-[4px] text-[11.5px] leading-[15px] text-[var(--ph-ink-3)]">
        Saved a month: take-home pay minus spending minus loan principal, averaged over the last twelve full months. This month counts once it is over.
      </p>
    </div>
  );
}

/** The chart box's pages, as its header names them. */
const PAGE_TITLES: Record<ChartPage, { title: string; note: string }> = {
  saving: { title: 'Where saving goes', note: 'each month, in goal order' },
  due: { title: 'When each goal is due', note: 'filled = saved so far' },
};

/**
 * The chart box: two pages side by side, one shown — where saving goes, and when each goal is due. A two-finger swipe
 * (a sideways wheel) turns it, so do the dots under the box and the ‹ › in its header; the slide is animated unless
 * motion is reduced, and the page shown last is kept on this device.
 */
function ChartBox({
  saving,
  savedMinor,
  lanes,
  axisTicks,
  currency,
  onGoal,
}: {
  saving: readonly SavingRow[];
  savedMinor: number;
  lanes: readonly Lane[];
  axisTicks: readonly { label: string; at: number }[];
  currency: string;
  onGoal: (goalId: string) => void;
}) {
  const [page, setPage] = useState<ChartPage>(() => readChartPage());
  const turn = (next: ChartPage) => {
    setPage(next);
    writeChartPage(next);
  };
  const latest = useRef(page);
  latest.current = page;
  const box = useRef<HTMLElement>(null);
  // A two-finger swipe arrives as wheel events: gathered sideways until it is far enough, then one page, and nothing more
  // until the fingers rest (the trackpad's coasting would turn it again). Listened to directly, so it can be kept from the
  // window: a sideways swipe here is the box's.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let gathered = 0;
    let spent = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        gathered = 0;
        spent = false;
      }, 220);
      if (spent) return;
      gathered += event.deltaX;
      const by = swipeStep(gathered);
      if (by === 0) return;
      spent = true;
      gathered = 0;
      const next = stepPage(latest.current, by);
      if (next !== latest.current) {
        setPage(next);
        writeChartPage(next);
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      clearTimeout(quiet);
    };
  }, []);
  const at = page === 'saving' ? 0 : 1;
  const head = PAGE_TITLES[page];
  const pageStyle = (mine: ChartPage) =>
    // The page turned away is hidden once the slide is over, so neither a reader nor the keyboard finds it.
    mine === page ? { visibility: 'visible' as const, transition: 'visibility 0s' } : { visibility: 'hidden' as const, transition: 'visibility 0s linear 300ms' };
  return (
    <>
      <section ref={box} className={cx(BOX, 'flex-1 overflow-hidden')} aria-label="Goal charts" aria-roledescription="carousel" data-testid="goals-chart" data-page={page}>
        <h2 className="flex items-center gap-[8px] px-[14px] pt-[14px] pb-[8px] text-[15px] font-bold text-[var(--mk-ink-2)]">
          <span className="shrink-0" data-testid="goals-chart-title">
            {head.title}
          </span>
          <span className={cx(NOTE, 'min-w-0 flex-1 truncate text-right')}>{head.note}</span>
          <span className="flex shrink-0 items-center">
            <ArrowButton label="Previous chart" disabled={at === 0} onClick={() => turn(stepPage(page, -1))}>
              <ChevronLeft size={14} aria-hidden />
            </ArrowButton>
            <ArrowButton label="Next chart" disabled={at === 1} onClick={() => turn(stepPage(page, 1))}>
              <ChevronRight size={14} aria-hidden />
            </ArrowButton>
          </span>
        </h2>
        <div className="flex transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${at * 100}%)` }}>
          <div className="w-full shrink-0" role="group" aria-roledescription="slide" aria-label={PAGE_TITLES.saving.title} aria-hidden={page !== 'saving'} style={pageStyle('saving')} data-testid="goals-chart-saving">
            <SavingPage rows={saving} savedMinor={savedMinor} currency={currency} onGoal={onGoal} />
          </div>
          <div className="w-full shrink-0" role="group" aria-roledescription="slide" aria-label={PAGE_TITLES.due.title} aria-hidden={page !== 'due'} style={pageStyle('due')} data-testid="goals-chart-due">
            <DuePage lanes={lanes} ticks={axisTicks} />
          </div>
        </div>
      </section>
      <div role="tablist" aria-label="Chart pages" className="flex justify-center gap-[6px] pt-[7px]">
        {(['saving', 'due'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={page === key}
            aria-label={PAGE_TITLES[key].title}
            onClick={() => turn(key)}
            className="flex h-[12px] w-[12px] items-center justify-center"
          >
            <span className={cx('block h-[6px] w-[6px] rounded-full', page === key ? 'bg-[var(--ph-ink-2)]' : 'bg-[var(--ph-chevron)]')} />
          </button>
        ))}
      </div>
    </>
  );
}

function ArrowButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[20px] w-[20px] items-center justify-center rounded-[5px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)] hover:text-[var(--ph-ink)] disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** Page 1: each goal's need a month end to end in goal order, Saved a month's line, the short part hatched; then the rows. */
function SavingPage({ rows, savedMinor, currency, onGoal }: { rows: readonly SavingRow[]; savedMinor: number; currency: string; onGoal: (goalId: string) => void }) {
  if (rows.length === 0) return <p className="px-[14px] pb-[12px] text-[12.5px] text-[var(--ph-ink-3)]">No goal needs anything more a month.</p>;
  const bar = savingBar(rows, savedMinor);
  const label = `Saved ${compactMoney(savedMinor, currency)}`;
  return (
    <div className="pb-[6px]">
      <div className="px-[14px] pt-[14px]">
        <div className="relative h-[24px]" data-testid="goals-saving-bar" role="img" aria-label={`${rows.map((row) => `${row.name} ${formatMinor(row.neededMinor, currency)}`).join(', ')}; saved a month ${formatMinor(savedMinor, currency)}`}>
          <div className="absolute inset-0 overflow-hidden rounded-[4px] bg-[var(--ph-track)]">
            {bar.pieces.map((piece) => (
              <span
                key={piece.goalId}
                className="absolute top-0 bottom-0 border-r border-[var(--ph-surface)]"
                style={{ left: `${piece.from * 100}%`, width: `${piece.width * 100}%`, background: GOAL_KIND_MARKS[piece.kind].colour }}
              />
            ))}
            {bar.short && (
              <span
                data-testid="goals-saving-short"
                className="absolute top-0 bottom-0"
                style={{
                  left: `${bar.short.from * 100}%`,
                  width: `${bar.short.width * 100}%`,
                  background: 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ph-surface) 72%, transparent) 0 3px, transparent 3px 7px)',
                }}
              />
            )}
          </div>
          <span className="absolute -top-[5px] -bottom-[5px] w-[2px] -translate-x-1/2 bg-[var(--ph-ink)]" style={{ left: `${bar.line * 100}%` }} />
          <span
            data-testid="goals-saving-label"
            className="absolute -top-[19px] text-[10.5px] font-medium whitespace-nowrap text-[var(--ph-ink)]"
            style={bar.line > 0.5 ? { right: `${(1 - bar.line) * 100}%` } : { left: `${bar.line * 100}%` }}
          >
            {label}
          </span>
        </div>
        <div className="pt-[6px] text-[10px] text-[var(--ph-ink-3)]">0</div>
      </div>
      <ul aria-label="Where saving goes">
        {rows.map((row) => (
          <li key={row.goalId}>
            <button
              type="button"
              data-testid="goals-saving-row"
              onClick={() => onGoal(row.goalId)}
              className="flex w-full items-center gap-[8px] border-t border-[var(--ph-hair)] px-[14px] py-[4px] text-left text-[12.5px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
            >
              <KindIcon kind={row.kind} size={18} />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span data-testid="goals-saving-fit" className={cx('shrink-0 whitespace-nowrap tabular-nums', row.fits === 'full' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-warn)]')}>
                {fitText(row, currency)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Page 2: from today, each goal a lane — its track to its date, filled as far as it is saved, a ring at the date. */
function DuePage({ lanes, ticks }: { lanes: readonly Lane[]; ticks: readonly { label: string; at: number }[] }) {
  if (lanes.length === 0) return <p className="px-[14px] pb-[12px] text-[12.5px] text-[var(--ph-ink-3)]">No goal has a date.</p>;
  return (
    <div className="px-[14px] pt-[4px] pb-[10px]" data-testid="goals-timeline">
      <div className="relative">
        {lanes.map((lane) => {
          const ink = lane.behind ? 'var(--ph-warn)' : GOAL_KIND_MARKS[lane.kind].colour;
          return (
            <div key={lane.goalId} data-testid="goals-lane" data-beyond={lane.at === null ? 'true' : undefined} className="flex h-[24px] items-center gap-[10px] text-[12px] text-[var(--ph-ink)]">
              <span className="w-[112px] shrink-0 truncate">{lane.name}</span>
              <span className="relative h-full min-w-0 flex-1 pr-[72px]">
                <span className="relative block h-full">
                  <span className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[var(--ph-track)]" style={{ left: 0, width: `${(lane.at ?? 1) * 100}%` }} />
                  <span className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full" style={{ left: 0, width: `${lane.fill * 100}%`, background: GOAL_KIND_MARKS[lane.kind].colour }} />
                  {lane.at !== null ? (
                    <>
                      <span
                        className="absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--ph-surface)]"
                        style={{ left: `${lane.at * 100}%`, borderColor: ink }}
                      />
                      <span
                        data-testid="goals-lane-date"
                        className="absolute top-1/2 -translate-y-1/2 pl-[9px] text-[11px] whitespace-nowrap tabular-nums"
                        style={{ left: `${lane.at * 100}%`, color: lane.behind ? 'var(--ph-warn)' : 'var(--ph-ink-3)' }}
                      >
                        {lane.dueLabel}
                      </span>
                    </>
                  ) : (
                    <span data-testid="goals-lane-date" className="absolute top-1/2 left-full -translate-y-1/2 pl-[6px] text-[11px] whitespace-nowrap tabular-nums" style={{ color: lane.behind ? 'var(--ph-warn)' : 'var(--ph-ink-3)' }}>
                      → {lane.dueLabel}
                    </span>
                  )}
                </span>
              </span>
            </div>
          );
        })}
        {/* Today's line, down through the lanes. */}
        <span className="pointer-events-none absolute top-0 bottom-0 left-[122px] w-px bg-[var(--ph-ink)]" />
      </div>
      <div className="flex gap-[10px] pt-[6px]">
        <span className="w-[112px] shrink-0" />
        <span className="relative h-[14px] min-w-0 flex-1 pr-[72px]">
          <span className="relative block h-full text-[10.5px] text-[var(--ph-ink-3)]">
            <span className="absolute top-0 left-0 -translate-x-1/2 font-medium text-[var(--ph-ink)]">Today</span>
            {ticks.map((tick) => (
              <span key={tick.label} className="absolute top-0 -translate-x-1/2 tabular-nums" style={{ left: `${tick.at * 100}%` }}>
                {tick.label}
              </span>
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}

/** Set aside in the title bar: for the goal open in the peek, or — none open — a goal picked from the list. */
function SetAsideButton({ goals, peeked, onPick }: { goals: readonly DeskGoal[]; peeked: string | null; onPick: (goalId: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const away = (event: globalThis.MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const item = 'flex h-[26px] w-full items-center gap-[8px] rounded-[5px] px-[8px] text-left text-[13px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--mac-accent)] hover:text-white';
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className={GBTN}
        disabled={goals.length === 0}
        aria-haspopup={peeked ? undefined : 'menu'}
        aria-expanded={peeked ? undefined : open}
        onClick={() => (peeked ? onPick(peeked) : setOpen((was) => !was))}
      >
        Set aside
      </button>
      {open && !peeked && (
        <div role="menu" aria-label="Set aside for" className="absolute top-full right-0 z-30 mt-1 max-h-[60vh] min-w-[200px] overflow-y-auto rounded-[9px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-[6px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]">
          <div className="px-[8px] pt-[2px] pb-[4px] text-[11px] font-semibold text-[var(--ph-ink-3)]">Set aside for</div>
          {goals.map((goal) => (
            <button
              key={goal.card.goalId}
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                onPick(goal.card.goalId);
              }}
            >
              <KindIcon kind={goal.card.kind} size={18} />
              {goal.card.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A switch in the title bar: two words on a grey track, the chosen one raised. */
function Segments<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (next: T) => void; options: readonly { key: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-full bg-[var(--mk-seg)] p-[3px] text-[13px]">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          onClick={() => onChange(option.key)}
          className={cx(
            'rounded-full px-[13px] py-[4px] font-semibold whitespace-nowrap',
            value === option.key ? 'bg-[var(--mk-seg-on)] text-[var(--mk-seg-on-ink)] shadow-[var(--mk-seg-shadow)]' : 'text-[var(--mk-ink-2)] hover:text-[var(--mk-ink)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
