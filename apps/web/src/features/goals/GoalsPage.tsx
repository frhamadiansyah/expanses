import { formatUnits, type GoalKind, isoDate } from '@expanses/core';
import { archiveGoal, type GoalRow, reorderGoals, setStagePaid } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { Calculator, calculatorKindOf } from './Calculator';
import { GoalForm } from './GoalForm';
import { type GoalCard, goalCard, GOAL_TEMPLATES } from './goal-cards';
import { useEarmarks, useGoalCalculators, useGoalPlans, useGoals } from './queries';

function StatusPill({ card }: { card: GoalCard }) {
  const tone = card.statusTone === 'good' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tone}`}>{card.statusLabel}</span>;
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Goals"
        action={!adding && !editing ? <Button onClick={() => setAdding(GOAL_TEMPLATES[0]!.kind)}>Add goal</Button> : undefined}
      />
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
        <Card className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500">Goals need each month</div>
              <div className="text-xl font-semibold">
                <Money minor={summary.data.neededMonthlyMinor} currency={ws.baseCurrency} />
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Set up each month</div>
              <div className="text-xl font-semibold">
                <Money minor={summary.data.plannedMonthlyMinor} currency={ws.baseCurrency} />
              </div>
              <div className="text-xs text-slate-500">Monthly buys and standing transfers</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">You save each month</div>
              <div className="text-xl font-semibold">
                <Money minor={summary.data.capacityMonthlyMinor} currency={ws.baseCurrency} />
              </div>
              <div className="text-xs text-slate-500">Take-home pay − spending − debt payments</div>
            </div>
          </div>
          {shortfall > 0 && (
            <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
              Goals ask for <Money minor={shortfall} currency={ws.baseCurrency} /> more than you save. In this order,{' '}
              {summary.data.fits.filter((fit) => fit.fits === 'full').length} fit, and the rest wait. Move a date, lower a target, or reorder them.
            </p>
          )}
        </Card>
      )}

      {cards.length === 0 && !adding && summary.isSuccess && (
        <Empty>No goals yet. Start with an emergency fund, education or a holiday.</Empty>
      )}

      {!adding && !editing && (
        <div className="flex flex-wrap gap-2">
          {GOAL_TEMPLATES.map((template) => (
            <Button key={template.kind} variant="secondary" onClick={() => setAdding(template.kind)}>
              + {template.label}
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((card, index) => {
          const plan = plans[index]!;
          return (
            <Card key={card.goalId} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{card.name}</h2>
                  <div className="text-xs text-slate-500">
                    {card.kindLabel} · by {card.dueLabel}
                  </div>
                </div>
                <StatusPill card={card} />
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-semibold">
                    <Money minor={card.currentMinor} currency={ws.baseCurrency} />
                  </span>
                  <span className="text-xs text-slate-500">
                    of <Money minor={card.targetMinor} currency={ws.baseCurrency} />
                    {derived.has(card.goalId) && <span className="block text-emerald-700">Worked out from your figures</span>}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-emerald-600" style={{ width: `${card.progressPercent}%` }} />
                </div>
              </div>

              <div className="divide-y divide-slate-100 text-sm">
                {card.stageLines.map((line) => (
                  <div key={line.stageId} className="flex items-baseline justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      <span className="text-slate-500">{line.when}</span> {line.name}
                      <span className="block text-xs text-slate-400">
                        <Money minor={line.todayMinor} currency={ws.baseCurrency} /> today, <Money minor={line.targetMinor} currency={ws.baseCurrency} /> then
                      </span>
                    </span>
                    <button type="button" className="shrink-0 text-xs text-slate-600 underline" onClick={() => togglePaid(line.stageId, line.state === 'paid')}>
                      {line.stateLabel}
                    </button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Needed a month</div>
                  <Money minor={card.neededMonthlyMinor} currency={ws.baseCurrency} className="font-semibold" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">Set up a month</div>
                  <Money minor={card.plannedMonthlyMinor} currency={ws.baseCurrency} className="font-semibold" />
                </div>
                <div>
                  <div className="text-xs text-slate-500">{card.differenceMinor < 0 ? 'Short by' : 'Room'}</div>
                  <Money minor={Math.abs(card.differenceMinor)} currency={ws.baseCurrency} className="font-semibold" tone="none" />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">Funded by</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {plan.links.length === 0 && <span className="text-slate-500">Nothing yet. Tag a purchase or set money aside.</span>}
                  {plan.links.map((link) => (
                    <span key={`${link.accountId}-${link.kind}`} className="rounded bg-slate-100 px-2 py-1">
                      <b>{link.name}</b> {link.kind === 'tagged' && link.unitsMicro !== null ? formatUnits(link.unitsMicro) : 'set aside'} ·{' '}
                      <Money minor={link.valueMinor} currency={ws.baseCurrency} />
                    </span>
                  ))}
                </div>
                {plan.goal.standingNote && (
                  <p className="mt-1 text-xs text-slate-500">
                    {plan.goal.standingNote}, <Money minor={plan.goal.standingMonthlyMinor} currency={ws.baseCurrency} />
                  </p>
                )}
              </div>

              {card.riskWarning && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{card.riskWarning}</p>}
              {card.earmarkWarning && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{card.earmarkWarning}</p>}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditing(plan.goal)}>
                  Edit
                </Button>
                {calculatorKindOf(plan.goal.kind) && (
                  <Button variant="secondary" onClick={() => setCalculating(plan.goal)}>
                    Work out the amount
                  </Button>
                )}
                <Button variant="ghost" onClick={() => move(card.goalId, -1)} aria-label={`Move ${card.name} up`}>
                  Move up
                </Button>
                <Button variant="ghost" onClick={() => move(card.goalId, 1)} aria-label={`Move ${card.name} down`}>
                  Move down
                </Button>
                <Button variant="danger" onClick={() => archive(plan.goal)}>
                  Archive
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {plans.some((plan) => plan.links.length > 0) && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">What each asset is for</h2>
          <div className="divide-y divide-slate-100 text-sm">
            {plans.flatMap((plan) =>
              plan.links.map((link) => (
                <div key={`${plan.goalId}-${link.accountId}-${link.kind}`} className="flex items-baseline justify-between gap-3 py-2">
                  <span>
                    {link.name}
                    <span className="text-slate-500">
                      {' · '}
                      {link.kind === 'tagged' && link.unitsMicro !== null ? `${formatUnits(link.unitsMicro)} tagged` : 'set aside'} for {plan.goal.name}
                    </span>
                  </span>
                  <Money minor={link.valueMinor} currency={ws.baseCurrency} />
                </div>
              )),
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">Goals never change your net worth or the tax report; they only say what the money is for.</p>
        </Card>
      )}
    </div>
  );
}
