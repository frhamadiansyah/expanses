import { formatUnits, type GoalKind, isoDate } from '@expanses/core';
import { archiveGoal, type GoalLinkRow, type GoalRow, reorderGoals, setStagePaid } from '@expanses/db';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import {
  type CornerAction,
  DestructiveRow,
  type GroupChild,
  Hero,
  InsetGroup,
  InsetRow,
  LargeTitle,
  Panel,
  ProgressBar,
  SCREEN,
} from '../../ui/native';
import { Calculator, calculatorKindOf } from './Calculator';
import { GoalForm } from './GoalForm';
import { type GoalCard, goalCard, GOAL_TEMPLATES } from './goal-cards';
import { useEarmarks, useGoalCalculators, useGoalPlans, useGoals } from './queries';

/**
 * What one link is worth, in the money it actually is.
 *
 * `link.valueMinor` is the account's own currency — a US$100,03 set-aside is 10_003 — and this used to be
 * painted under a hardcoded `ws.baseCurrency`, so the chip read `Rp 10.003`. The figure is shown in its own
 * currency, with the base-currency translation beside it when a rate is known and a plain word when it is
 * not. There is one of these because there used to be two, and only one of them would ever have been fixed.
 */
function LinkAmount({ link }: { link: GoalLinkRow }) {
  const { ws } = useApp();
  if (link.currency === ws.baseCurrency) return <Money minor={link.valueMinor} currency={link.currency} />;
  return (
    <>
      <Money minor={link.valueMinor} currency={link.currency} />
      {link.baseMinor === null ? (
        <> · no {ws.baseCurrency} rate yet</>
      ) : (
        <>
          {' ('}
          <Money minor={link.baseMinor} currency={ws.baseCurrency} />
          {')'}
        </>
      )}
    </>
  );
}

/** What funds a goal, as one row of its group. Named so the group can hand it its place and a test can name it. */
function FundingRow({ link, position }: GroupChild & { link: GoalLinkRow }) {
  return (
    <div data-testid="goal-link">
      <InsetRow
        position={position}
        title={link.name}
        subtitle={link.kind === 'tagged' && link.unitsMicro !== null ? `${formatUnits(link.unitsMicro)} tagged` : 'set aside'}
        value={<LinkAmount link={link} />}
        valueTone="ink"
        chevron={false}
      />
    </div>
  );
}

/** The status the plan reached, on the group's own header line, keeping the tone the card decided. */
function StatusPill({ card }: { card: GoalCard }) {
  return <span className={card.statusTone === 'good' ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-warn)]'}>{card.statusLabel}</span>;
}

export function GoalsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const summary = useGoalPlans(today);
  const goals = useGoals();
  const earmarks = useEarmarks();
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [calculating, setCalculating] = useState<GoalRow | null>(null);
  const [adding, setAdding] = useState<GoalKind | null>(null);
  const [error, setError] = useState<unknown>(null);

  const calculators = useGoalCalculators();
  const derived = new Set((calculators.data ?? []).map((row) => row.goalId));
  const plans = summary.data?.plans ?? [];
  const cards = plans.map(goalCard);
  const shortfall = (summary.data?.neededMonthlyMinor ?? 0) - (summary.data?.capacityMonthlyMinor ?? 0);

  async function move(goalId: string, by: number) {
    setError(null);
    try {
      const order = plans.map((plan) => plan.goalId);
      const from = order.indexOf(goalId);
      const to = from + by;
      if (from < 0 || to < 0 || to >= order.length) return;
      order.splice(to, 0, ...order.splice(from, 1));
      await reorderGoals(database, ws, order);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function archive(goal: GoalRow) {
    if (!window.confirm(`Archive "${goal.name}"? Its tagged purchases keep their history.`)) return;
    await archiveGoal(database, ws, goal.id);
    await invalidate();
  }

  async function togglePaid(stageId: string, paid: boolean) {
    await setStagePaid(database, ws, stageId, paid ? null : today);
    await invalidate();
  }

  /* The primary action is a corner glyph at every width, not a dark rectangle beside the title. */
  const actions: CornerAction[] =
    adding || editing ? [] : [{ key: 'add', label: 'Add goal', glyph: <Plus size={22} aria-hidden />, run: () => setAdding(GOAL_TEMPLATES[0]!.kind) }];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Goals" actions={actions} />
      <ErrorBox error={summary.error ?? error} />

      {calculating && <Calculator goal={calculating} onDone={() => setCalculating(null)} />}

      {(adding || editing) && (
        <GoalForm
          goal={editing ?? undefined}
          startKind={adding ?? undefined}
          earmarks={earmarks.data ?? []}
          onDone={() => {
            setAdding(null);
            setEditing(null);
          }}
        />
      )}

      {summary.data && (
        <InsetGroup
          header="Every month"
          footer={
            shortfall > 0 ? (
              <>
                Goals ask for <Money minor={shortfall} currency={ws.baseCurrency} /> more than you save. In this order,{' '}
                {summary.data.fits.filter((fit) => fit.fits === 'full').length} fit, and the rest wait. Move a date, lower a target, or reorder them.
              </>
            ) : undefined
          }
        >
          <InsetRow
            title="Goals need each month"
            value={<Money minor={summary.data.neededMonthlyMinor} currency={ws.baseCurrency} />}
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Set up each month"
            subtitle="Monthly buys and standing transfers"
            value={<Money minor={summary.data.plannedMonthlyMinor} currency={ws.baseCurrency} />}
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="You save each month"
            subtitle="Take-home pay − spending − loan principal"
            value={<Money minor={summary.data.capacityMonthlyMinor} currency={ws.baseCurrency} />}
            valueTone="ink"
            chevron={false}
          />
        </InsetGroup>
      )}

      {cards.length === 0 && !adding && summary.isSuccess && <Empty>No goals yet. Start with an emergency fund, education or a holiday.</Empty>}

      {/* A chooser is a grouped list of rows with chevrons, not a wrapping set of outlined buttons. */}
      {!adding && !editing && (
        <InsetGroup header="Start from a template">
          {GOAL_TEMPLATES.map((template) => (
            <InsetRow key={template.kind} title={template.label} onClick={() => setAdding(template.kind)} />
          ))}
        </InsetGroup>
      )}

      <div className="grid gap-x-6 lg:grid-cols-2">
        {cards.map((card, index) => {
          const plan = plans[index]!;
          return (
            <section key={card.goalId}>
              <Panel wide header={card.name} trailing={<StatusPill card={card} />} footer={`${card.kindLabel} · by ${card.dueLabel}`}>
                <Hero
                  minor={card.currentMinor}
                  currency={ws.baseCurrency}
                  caption={
                    <>
                      of <Money minor={card.targetMinor} currency={ws.baseCurrency} />
                      {derived.has(card.goalId) && <span className="block text-[var(--ph-tint)]">Worked out from your figures</span>}
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
              {card.earmarkWarning && <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{card.earmarkWarning}</p>}

              <InsetGroup wide>
                <InsetRow title="Edit" onClick={() => setEditing(plan.goal)} />
                {calculatorKindOf(plan.goal.kind) && <InsetRow title="Work out the amount" onClick={() => setCalculating(plan.goal)} />}
                <InsetRow title="Move up" label={`Move ${card.name} up`} onClick={() => move(card.goalId, -1)} chevron={false} />
                <InsetRow title="Move down" label={`Move ${card.name} down`} onClick={() => move(card.goalId, 1)} chevron={false} />
              </InsetGroup>
              {/* Its own group is the point: a row's height away from Move down is the wrong tap to make. */}
              <InsetGroup wide>
                <DestructiveRow label="Archive" onClick={() => archive(plan.goal)} />
              </InsetGroup>
            </section>
          );
        })}
      </div>

      {plans.some((plan) => plan.links.length > 0) && (
        <InsetGroup header="What each asset is for" footer="Goals never change your net worth or the tax report; they only say what the money is for.">
          {plans.flatMap((plan) =>
            plan.links.map((link) => (
              <InsetRow
                key={`${plan.goalId}-${link.accountId}-${link.kind}`}
                testId="goal-asset"
                title={link.name}
                subtitle={`${link.kind === 'tagged' && link.unitsMicro !== null ? `${formatUnits(link.unitsMicro)} tagged` : 'set aside'} for ${plan.goal.name}`}
                value={<LinkAmount link={link} />}
                valueTone="ink"
                chevron={false}
              />
            )),
          )}
        </InsetGroup>
      )}
    </div>
  );
}
