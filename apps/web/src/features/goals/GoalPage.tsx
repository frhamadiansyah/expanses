import { fundingOrder, isoDate } from '@expanses/core';
import { archiveGoal, type GoalHistoryEntry, reorderGoals, setStagePaid } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { DestructiveRow, Hero, InsetGroup, InsetRow, LargeTitle, Panel, ProgressBar, SCREEN } from '../../ui/native';
import { Calculator, calculatorKindOf } from './Calculator';
import { FundingRow } from './funding';
import { GoalForm } from './GoalForm';
import { movedOrder } from './goal-moves';
import { cardHistory, dayMonth, fundedWindow, type GoalCard, goalCard, historyDay } from './goal-cards';
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

/** The status the plan reached, beside the goal's own name, keeping the tone the card decided. */
function StatusPill({ card }: { card: GoalCard }) {
  return <span className={card.statusTone === 'good' ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-warn)]'}>{card.statusLabel}</span>;
}

/**
 * A goal on its own: the figure, its stages, what funds it and what has happened to it — everything the list
 * had no room for. The list is where goals are read as a set; this is where one is read on its own, so a long
 * page of figures is no longer the place every goal shares.
 */
export function GoalPage({ goalId }: { goalId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const summary = useGoalPlans(today);
  const earmarks = useEarmarks();
  const history = useGoalHistory().data ?? {};
  // A history line's key is its draw's id, so a borrow can be asked whether the goal was whole when it was taken.
  const wholeBorrows = new Set((useDraws().data ?? []).filter((draw) => draw.intent === 'borrow' && draw.wasWhole).map((draw) => draw.id));
  const calculators = useGoalCalculators();
  const [editing, setEditing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const plans = summary.data?.plans ?? [];
  const plan = plans.find((row) => row.goalId === goalId);
  // The order the list reads in, so a move from here lands where the list would put it.
  const ordered = fundingOrder(plans.map((row) => ({ ...row, kind: row.goal.kind, rank: row.goal.rank })));

  async function move(by: number) {
    setError(null);
    try {
      // A move never crosses a section: an emergency fund cannot be ranked below a holiday it is funded before.
      const order = movedOrder(ordered, goalId, by);
      if (!order) return;
      await reorderGoals(database, ws, order);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function archive(name: string) {
    if (!window.confirm(`Archive "${name}"? Its tagged purchases keep their history.`)) return;
    await archiveGoal(database, ws, goalId);
    await invalidate();
    // The list is where an archived goal stops being: staying here would read a page for nothing.
    await navigate({ to: '/goals' });
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
        <LargeTitle title="Goal not here" back="Goals" backTo="/goals" />
        <InsetGroup footer="It may have been archived. Its tagged purchases keep their history.">
          <InsetRow title="Back to Goals" to="/goals" />
        </InsetGroup>
      </div>
    );
  }

  const card = goalCard(plan);
  const derived = new Set((calculators.data ?? []).map((row) => row.goalId));
  const { lines: historyLines, stood } = cardHistory(history[card.goalId] ?? [], (key) => wholeBorrows.has(key));

  return (
    <div className={SCREEN} data-testid="goal-page">
      <LargeTitle
        title={card.name}
        back="Goals"
        backTo="/goals"
        oneLine
        subtitle={
          <>
            <StatusPill card={card} /> · {card.kindLabel} · by {card.dueLabel}
          </>
        }
      />
      <ErrorBox error={summary.error ?? error} />

      {editing && <GoalForm goal={plan.goal} earmarks={earmarks.data ?? []} onDone={() => setEditing(false)} />}
      {calculating && <Calculator goal={plan.goal} onDone={() => setCalculating(false)} />}

      <Panel wide footer={`${card.kindLabel} · by ${card.dueLabel}`}>
        <Hero
          minor={card.currentMinor}
          currency={ws.baseCurrency}
          caption={
            <>
              of <Money minor={card.targetMinor} currency={ws.baseCurrency} />
              {derived.has(card.goalId) && <span className="block text-[var(--ph-tint)]">Worked out from your figures</span>}
              <ShortNote card={card} stood={stood} />
            </>
          }
        />
        {/*
         * The bar is drawn from a clamped figure rather than through `Hero`'s own `progress`: the kit
         * turns a bar alarm-red once its target is passed, which is what a budget means by it and the
         * opposite of what a goal does. Saving more than you set out to is not a warning.
         */}
        <ProgressBar
          className="mx-auto max-w-[320px]"
          currentMinor={Math.min(card.currentMinor, card.targetMinor)}
          targetMinor={card.targetMinor}
          label={`${card.name} progress`}
        />
      </Panel>

      {card.stageLines.length > 0 && (
        <InsetGroup wide header="Stages">
          {card.stageLines.map((line) => (
            /* The small underlined button inside the line is gone: the line itself is what marks it paid. */
            <InsetRow
              key={line.stageId}
              title={`${line.when} ${line.name}`}
              subtitle={
                <>
                  <Money minor={line.todayMinor} currency={ws.baseCurrency} /> today, <Money minor={line.targetMinor} currency={ws.baseCurrency} /> then
                </>
              }
              value={line.stateLabel}
              valueTone="tint"
              chevron={false}
              label={`${line.name}: ${line.stateLabel}`}
              onClick={() => togglePaid(line.stageId, line.state === 'paid')}
            />
          ))}
        </InsetGroup>
      )}

      <InsetGroup wide>
        <InsetRow
          title="Needed a month"
          value={<Money minor={card.neededMonthlyMinor} currency={ws.baseCurrency} />}
          valueTone="ink"
          chevron={false}
        />
        <InsetRow
          title="Set up a month"
          value={<Money minor={card.plannedMonthlyMinor} currency={ws.baseCurrency} />}
          valueTone="ink"
          chevron={false}
        />
        <InsetRow
          title={card.differenceMinor < 0 ? 'Short by' : 'Room'}
          value={<Money minor={Math.abs(card.differenceMinor)} currency={ws.baseCurrency} tone="none" />}
          valueTone={card.differenceMinor < 0 ? 'alarm' : 'ink'}
          chevron={false}
        />
      </InsetGroup>

      {plan.links.length === 0 ? (
        <InsetGroup wide header="Funded by">
          <InsetRow title="Nothing yet" subtitle="Tag a purchase or set money aside." chevron={false} />
        </InsetGroup>
      ) : (
        <InsetGroup
          wide
          header="Funded by"
          footer={
            plan.goal.standingNote ? (
              <>
                {plan.goal.standingNote}, <Money minor={plan.goal.standingMonthlyMinor} currency={ws.baseCurrency} />
              </>
            ) : undefined
          }
        >
          {plan.links.map((link) => (
            <FundingRow key={`${link.accountId}-${link.kind}`} link={link} />
          ))}
        </InsetGroup>
      )}

      {card.riskWarning && <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{card.riskWarning}</p>}
      {/* The short part of the old warning is said under the figure and on the Funded-by row; only the no-rate sentence is left. */}
      {plan.unconvertedWarning && <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{plan.unconvertedWarning}</p>}

      {historyLines.length > 0 && (
        <InsetGroup wide header="History">
          {historyLines.map((entry) => (
            <InsetRow
              key={entry.key}
              testId="goal-history"
              title={HISTORY_TITLES[entry.kind]}
              subtitle={entry.text ? `${historyDay(entry.occurredOn, today)} · ${entry.text}` : historyDay(entry.occurredOn, today)}
              value={entry.amountMinor === null ? undefined : <Money minor={entry.amountMinor} currency={entry.currency} />}
              valueTone="ink"
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

      <InsetGroup wide>
        <InsetRow title="Edit" onClick={() => setEditing(true)} />
        {calculatorKindOf(plan.goal.kind) && <InsetRow title="Work out the amount" onClick={() => setCalculating(true)} />}
        <InsetRow title="Move up" label={`Move ${card.name} up`} onClick={() => move(-1)} chevron={false} />
        <InsetRow title="Move down" label={`Move ${card.name} down`} onClick={() => move(1)} chevron={false} />
      </InsetGroup>
      {/* Its own group is the point: a row's height away from Move down is the wrong tap to make. */}
      <InsetGroup wide footer={card.done ? 'Keeps the history, stops it claiming money.' : undefined}>
        <DestructiveRow label="Archive" onClick={() => archive(card.name)} />
      </InsetGroup>
    </div>
  );
}
