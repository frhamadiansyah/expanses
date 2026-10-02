import { formatMinor, isoDate } from '@expanses/core';
import { archiveGoal, type GoalHistoryEntry, setStagePaid } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Archive, ArrowRightLeft, CalendarClock, Check, HandCoins, MoreHorizontal, Pencil, PiggyBank, ShoppingBag, Tag, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Sheet } from '../../app/Sheet';
import { ErrorBox, Money } from '../../ui';
import { ActionButtons, type CornerAction, InsetGroup, InsetRow, Panel, PushedTitle, type RoundAction, SCREEN } from '../../ui/native';
import { UseBar } from '../budget/budget-rows';
import { FundingRow } from './funding';
import { GoalForm } from './GoalForm';
import { MonthlySheet, MoveSheet, TakeBackSheet, useHasTaggedPurchase, UseSheet } from './GoalSheets';
import { setAsideOf } from './goal-actions';
import { cardHistory, dayMonth, fundedWindow, type GoalCard, goalCard, historyDay, monthsLeftLabel, stageShares } from './goal-cards';
import { InfoHeader } from './InfoHeader';
import { useDraws, useEarmarks, useGoalCalculators, useGoalHistory, useGoalPlans } from './queries';

export function GoalRoute() {
  const { goalId } = useParams({ from: '/goals/$goalId' });
  return <GoalPage goalId={goalId} />;
}

const HISTORY_TITLES: Record<GoalHistoryEntry['kind'], string> = {
  'set-aside': 'Set aside',
  'taken-back': 'Taken back',
  borrowed: 'Borrowed',
  spent: 'Spent',
  moved: 'Moved',
  reached: 'Reached the target',
};

/**
 * Under the figure, what the goal is short and — when it was whole before it lent money — the days it stood whole,
 * said as a fact rather than a failure (spec §7.2). The figures are the readers' own; nothing is worked out here.
 */
function ShortNote({ card, stood }: { card: GoalCard; stood: ReturnType<typeof fundedWindow> }) {
  if (card.shortLines.length === 0) return null;
  const many = card.shortLines.length > 1;
  return (
    <>
      {card.shortLines.map((line) => (
        <span key={line.accountName} className="mt-[2px] block text-[var(--ph-warn)]">
          Short by <Money minor={line.shortMinor} currency={line.currency} />
          {many && ` in ${line.accountName}`}
        </span>
      ))}
      {stood && (
        <span className="mt-[2px] block text-[var(--ph-ink-3)]">
          <span className="block">
            {stood.from === null
              ? `Fully funded until ${dayMonth(stood.until)}`
              : stood.from === stood.until
                ? `Fully funded on ${dayMonth(stood.until)}`
                : `Fully funded ${dayMonth(stood.from)} – ${dayMonth(stood.until)}`}
          </span>
          <span className="block">
            <Money minor={stood.amountMinor} currency={stood.currency} /> went to {stood.description}. Put it back and the fund is complete again.
          </span>
        </span>
      )}
    </>
  );
}

/** How many history lines show before "See all". */
const HISTORY_SHOWN = 3;

/** The one status chip under the bar: good for On track, Funded and Done; warn for Behind, with what is short a month. */
function StatusChip({ card, currency }: { card: GoalCard; currency: string }) {
  const warn = card.statusTone === 'warn';
  return (
    <span
      data-testid="goal-status"
      className={
        'inline-flex min-h-[26px] items-center rounded-full px-[10px] text-[13px] leading-[18px] font-medium ' +
        (warn ? 'bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)]' : 'bg-[var(--ph-tint-panel)] text-[var(--ph-tint-ink)]')
      }
    >
      {warn && card.differenceMinor < 0 ? `${card.statusLabel} · ${formatMinor(-card.differenceMinor, currency)} a month short` : card.statusLabel}
    </span>
  );
}

/**
 * A goal on its own: the figure, its stages, what funds it and what has happened to it — everything the list
 * had no room for. The list is where goals are read as a set; this is where one is read on its own.
 */
export function GoalPage({ goalId }: { goalId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const goBack = useBack('/goals');
  const today = isoDate();
  const summary = useGoalPlans(today);
  const earmarks = useEarmarks();
  const history = useGoalHistory().data ?? {};
  // A history line's key is its draw's id, so a borrow can be asked whether the goal was whole when it was taken.
  const wholeBorrows = new Set((useDraws().data ?? []).filter((draw) => draw.intent === 'borrow' && draw.wasWhole).map((draw) => draw.id));
  const calculators = useGoalCalculators();
  const [editing, setEditing] = useState(false);
  const [settingAside, setSettingAside] = useState(false);
  // The one sheet open from the round actions or the ⋯, if any.
  const [open, setOpen] = useState<'use' | 'monthly' | 'take-back' | 'move' | null>(null);
  const hasPurchase = useHasTaggedPurchase(goalId);
  const [allHistory, setAllHistory] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const plans = summary.data?.plans ?? [];
  const plan = plans.find((row) => row.goalId === goalId);

  async function archive(name: string) {
    if (!window.confirm(`Archive "${name}"? Its tagged purchases keep their history.`)) return;
    try {
      await archiveGoal(database, ws, goalId);
      await invalidate();
      // The list is where an archived goal stops being: staying here would read a page for nothing.
      await navigate({ to: '/goals' });
    } catch (e) {
      setError(e);
    }
  }

  async function togglePaid(stageId: string, paid: boolean) {
    await setStagePaid(database, ws, stageId, paid ? null : today);
    await invalidate();
  }

  if (!summary.data) {
    return (
      <div className={SCREEN}>
        <ErrorBox error={summary.error} />
      </div>
    );
  }

  if (!plan) {
    // Archived, or a link kept from before it was: the way out is the list, not a dead end.
    return (
      <div className={SCREEN}>
        <PushedTitle title="Goal not here" back="Goals" backTo="/goals" />
        <InsetGroup footer="It may have been archived. Its tagged purchases keep their history.">
          <InsetRow title="Back to Goals" to="/goals" />
        </InsetGroup>
      </div>
    );
  }

  const card = goalCard(plan);
  const currency = ws.baseCurrency;
  const warn = card.statusTone === 'warn';
  const derived = new Set((calculators.data ?? []).map((row) => row.goalId));
  const full = history[card.goalId] ?? [];
  const { stood } = cardHistory(full, (key) => wholeBorrows.has(key));
  const historyLines = allHistory ? full : full.slice(0, HISTORY_SHOWN);
  // A goal of one payment has no Stages group, so its paid mark waits behind the ⋯.
  const only = card.stageLines.length === 1 ? card.stageLines[0]! : null;

  const held = setAsideOf(earmarks.data ?? [], goalId).length > 0;
  const others = plans.filter((row) => row.goalId !== goalId);
  const menu: CornerAction[] = [
    { key: 'edit', label: 'Edit', glyph: <Pencil size={18} aria-hidden />, run: () => setEditing(true) },
    ...(held ? [{ key: 'take-back', label: 'Take back', glyph: <HandCoins size={18} aria-hidden />, run: () => setOpen('take-back') }] : []),
    ...(others.length > 0 && (held || hasPurchase)
      ? [{ key: 'move', label: 'Move to another goal', glyph: <ArrowRightLeft size={18} aria-hidden />, run: () => setOpen('move') }]
      : []),
    ...(only
      ? [
          only.state === 'paid'
            ? { key: 'unpaid', label: 'Mark not paid', glyph: <Undo2 size={18} aria-hidden />, run: () => void togglePaid(only.stageId, true) }
            : { key: 'paid', label: 'Mark paid', glyph: <Check size={18} aria-hidden />, run: () => void togglePaid(only.stageId, false) },
        ]
      : []),
    {
      key: 'archive',
      label: 'Archive',
      glyph: <Archive size={18} aria-hidden />,
      // What archiving a finished goal does, said where archiving is.
      detail: card.done ? 'Keeps the history, stops it claiming money.' : undefined,
      run: () => void archive(card.name),
    },
  ];
  const actions: CornerAction[] = [{ key: 'more', label: 'More', glyph: <MoreHorizontal size={20} aria-hidden />, menu }];

  // Set aside opens the form's set-aside part; tagging happens on a buy, which Buy & sell records and retags. Use is
  // there only while something is set aside to use.
  const round: RoundAction[] = [
    { key: 'set-aside', label: 'Set aside', glyph: <PiggyBank size={20} aria-hidden />, run: () => setSettingAside(true) },
    { key: 'tag', label: 'Tag a purchase', glyph: <Tag size={20} aria-hidden />, to: '/net-worth/trades' },
    ...(held ? [{ key: 'use', label: 'Use', glyph: <ShoppingBag size={20} aria-hidden />, run: () => setOpen('use') }] : []),
    { key: 'monthly', label: 'Monthly', glyph: <CalendarClock size={20} aria-hidden />, run: () => setOpen('monthly') },
  ];

  const shares = stageShares(card);
  const due = card.kind === 'emergency' ? null : card.targetMinor > 0 || !card.done ? card.dueLabel : null;
  const right = card.coverLabel ?? (card.monthsLeft !== null ? monthsLeftLabel(card.monthsLeft) : null);

  return (
    <div className={SCREEN} data-testid="goal-page">
      <PushedTitle title={card.name} back="Goals" onBack={goBack} actions={actions} />
      <ErrorBox error={summary.error ?? error} />

      {editing && <GoalForm goal={plan.goal} earmarks={earmarks.data ?? []} onDone={() => setEditing(false)} />}
      {settingAside && (
        <Sheet title="Set aside" onClose={() => setSettingAside(false)}>
          <GoalForm part="set-aside" goal={plan.goal} earmarks={earmarks.data ?? []} onDone={() => setSettingAside(false)} />
        </Sheet>
      )}

      {open === 'use' && <UseSheet plan={plan} earmarks={earmarks.data ?? []} onClose={() => setOpen(null)} />}
      {open === 'monthly' && <MonthlySheet plan={plan} onClose={() => setOpen(null)} />}
      {open === 'take-back' && <TakeBackSheet plan={plan} earmarks={earmarks.data ?? []} onClose={() => setOpen(null)} />}
      {open === 'move' && <MoveSheet plan={plan} others={others} earmarks={earmarks.data ?? []} onClose={() => setOpen(null)} />}

      <Panel wide className="space-y-3" testId="goal-card">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Saved</p>
          <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="goal-saved">
            {formatMinor(card.currentMinor, currency)}
          </p>
        </div>
        {/* Clamped: saving more than was set out is not a warning, so the bar is full and in the tint, never past. */}
        <UseBar share={card.done ? 1 : Math.min(1, card.progressPercent / 100)} height={6} warn={warn} label={`${card.name} progress`} />
        <div className="flex items-baseline justify-between gap-3 text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
          <span data-testid="goal-target">
            {card.targetMinor > 0 && (
              <>
                of <Money minor={card.targetMinor} currency={currency} />
              </>
            )}
            {card.targetMinor > 0 && due && ' · '}
            {due}
          </span>
          {right && <span className="shrink-0">{right}</span>}
        </div>
        <div>
          <StatusChip card={card} currency={currency} />
        </div>
        {(derived.has(card.goalId) || card.shortLines.length > 0) && (
          <p className="text-[13px] leading-[18px]">
            {derived.has(card.goalId) && <span className="block text-[var(--ph-tint)]">Worked out from these figures</span>}
            <ShortNote card={card} stood={stood} />
          </p>
        )}
      </Panel>

      <ActionButtons actions={round} />

      {card.stageLines.length > 1 && (
        <InsetGroup wide header="Stages">
          {card.stageLines.map((line, index) => (
            /* The line itself is what marks a stage paid. */
            <InsetRow
              key={line.stageId}
              title={`${line.when} · ${line.name}`}
              subtitle={
                <span className="mt-[4px] block">
                  <UseBar share={shares[index]!} />
                </span>
              }
              value={
                <span className="block text-right">
                  <Money minor={line.targetMinor} currency={currency} />
                  <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{formatMinor(line.todayMinor, currency)} today</span>
                </span>
              }
              valueTone="ink"
              chevron={false}
              label={`${line.name}: ${line.stateLabel}`}
              onClick={() => togglePaid(line.stageId, line.state === 'paid')}
            />
          ))}
        </InsetGroup>
      )}

      <InsetGroup wide header="Each month">
        <InsetRow title="Needed a month" value={<Money minor={card.neededMonthlyMinor} currency={currency} />} valueTone="ink" chevron={false} />
        <InsetRow title="Set up a month" value={<Money minor={card.plannedMonthlyMinor} currency={currency} />} valueTone="ink" chevron={false} />
        <InsetRow
          title={card.differenceMinor < 0 ? 'Short by' : 'Room'}
          value={<Money minor={Math.abs(card.differenceMinor)} currency={currency} tone="none" />}
          valueTone={card.differenceMinor < 0 ? 'warn' : 'ink'}
          chevron={false}
        />
      </InsetGroup>

      <section className="w-full">
        <InfoHeader
          title="Funded by"
          info={
            plan.goal.standingNote ? (
              <>
                {plan.goal.standingNote}, <Money minor={plan.goal.standingMonthlyMinor} currency={currency} />
              </>
            ) : undefined
          }
        />
        <InsetGroup wide>
          {plan.links.length === 0 ? (
            <InsetRow title="Nothing yet" subtitle="Tag a purchase or set money aside." chevron={false} />
          ) : (
            plan.links.map((link) => <FundingRow key={`${link.accountId}-${link.kind}`} link={link} />)
          )}
        </InsetGroup>
      </section>

      {card.riskWarning && <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{card.riskWarning}</p>}
      {/* The short part of the old warning is said under the figure and on the Funded-by row; only the no-rate sentence is left. */}
      {plan.unconvertedWarning && <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{plan.unconvertedWarning}</p>}

      {full.length > 0 && (
        <InsetGroup wide header="History">
          {[
            ...historyLines.map((entry) => (
              <InsetRow
                key={entry.key}
                testId="goal-history"
                title={HISTORY_TITLES[entry.kind]}
                subtitle={entry.text ? `${historyDay(entry.occurredOn, today)} · ${entry.text}` : historyDay(entry.occurredOn, today)}
                value={entry.amountMinor === null ? undefined : <Money minor={entry.amountMinor} currency={entry.currency} />}
                valueTone="ink"
                chevron={false}
              />
            )),
            ...(full.length > HISTORY_SHOWN
              ? [
                  <InsetRow
                    key="see-all"
                    title={<span className="font-normal text-[var(--ph-tint)]">{allHistory ? 'Show fewer' : 'See all'}</span>}
                    label={allHistory ? 'Show fewer' : 'See all'}
                    chevron={false}
                    onClick={() => setAllHistory((was) => !was)}
                  />,
                ]
              : []),
          ]}
        </InsetGroup>
      )}
    </div>
  );
}
