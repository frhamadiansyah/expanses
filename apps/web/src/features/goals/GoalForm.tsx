import { bandHint, CURRENCIES, type GoalKind, groupedMajorString, groupTypedAmount, isoDate, monthsUntil, parseGroupedMajor, returnBandFor } from '@expanses/core';
import { type GoalRow, goalIsFunded, saveGoal } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { type CornerAction, DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { Calculator, calculatorKindOf } from './Calculator';
import { canSaveGoal } from './goal-form-model';
import { GOAL_KIND_LABELS, GOAL_TEMPLATES, type GoalTemplate, prefilledReturnBps, templateDueOn, templateFor } from './goal-cards';
import { useEarmarks, useGoalPlans } from './queries';
import { SetAsideGroup, useSetAside } from './SetAside';

interface StageDraft {
  id?: string;
  name: string;
  amount: string;
  months: string;
  dueOn: string;
  usesMonths: boolean;
  paidOn: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function draftFromTemplate(template: GoalTemplate, today: string, currency: string): StageDraft {
  return {
    name: template.stage.name,
    amount: template.stage.targetMinor === null ? '' : groupTypedAmount(String(template.stage.targetMinor), currency),
    months: template.stage.targetMonths === null ? '' : String(template.stage.targetMonths),
    dueOn: templateDueOn(template, today),
    usesMonths: template.stage.targetMonths !== null,
    paidOn: null,
  };
}

/** /goals/new: a goal not saved yet. */
export function NewGoalRoute() {
  const earmarks = useEarmarks();
  if (!earmarks.isSuccess) return <div className={SCREEN} />;
  return <GoalForm earmarks={earmarks.data} />;
}

/** /goals/$goalId/edit: a saved goal's fields, once the goal and what is set aside for it have loaded. */
export function EditGoalRoute() {
  const { goalId } = useParams({ from: '/goals/$goalId/edit' });
  const summary = useGoalPlans(isoDate());
  const earmarks = useEarmarks();
  const goBack = useBack('/goals');
  if (!summary.data || !earmarks.isSuccess) return <div className={SCREEN} />;
  const goal = summary.data.plans.find((plan) => plan.goalId === goalId)?.goal;
  if (!goal) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Goal not here" back="Goals" onBack={goBack} />
        <InsetGroup>
          <InsetRow title="Back to Goals" to="/goals" />
        </InsetGroup>
      </div>
    );
  }
  return <GoalForm key={goal.id} goal={goal} earmarks={earmarks.data} />;
}

/**
 * A goal's page of fields, in the kit Add account is made of: a pushed page with ‹ at the left and ✓ at the right,
 * rows grouped, an ⓘ for every explanation. A new goal opens on a kind; choosing another kind re-applies that kind's
 * template (name, growth, return, first payment) while the goal is new.
 */
export function GoalForm({ goal, startKind, earmarks }: { goal?: GoalRow; startKind?: GoalKind; earmarks: Parameters<typeof useSetAside>[1] }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const goBack = useBack('/goals');
  const today = isoDate();

  const starting = goal ? undefined : (templateFor(startKind ?? GOAL_TEMPLATES[0]!.kind) ?? GOAL_TEMPLATES[0]!);
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? starting!.kind);
  const [name, setName] = useState(goal?.name ?? starting!.label);
  const [growth, setGrowth] = useState(String((goal?.growthBps ?? starting!.growthBps) / 100));
  const [expectedReturn, setExpectedReturn] = useState(String((goal?.returnBps ?? starting!.returnBps) / 100));
  // A goal already saved keeps its return; a new one's follows its first stage's date until one is typed.
  const [returnTyped, setReturnTyped] = useState(!!goal);
  const [currency, setCurrency] = useState(goal?.currency ?? ws.baseCurrency);
  // Money already counted toward a saved goal is in its currency, so the currency is shown but not changeable then.
  const [funded, setFunded] = useState(false);
  useEffect(() => {
    if (!goal) return;
    void goalIsFunded(database, goal.id).then(setFunded);
  }, [database, goal]);
  const [standing, setStanding] = useState(goal ? groupedMajorString(goal.standingMonthlyMinor, goal.currency) : '0');
  const [standingNote, setStandingNote] = useState(goal?.standingNote ?? '');
  const [stages, setStages] = useState<StageDraft[]>(
    goal
      ? goal.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          amount: stage.targetMinor === null ? '' : groupedMajorString(stage.targetMinor, goal.currency),
          months: stage.targetMonths === null ? '' : String(stage.targetMonths),
          dueOn: stage.dueOn,
          usesMonths: stage.targetMonths !== null,
          paidOn: stage.paidOn,
        }))
      : [draftFromTemplate(starting!, today, currency)],
  );
  const setAside = useSetAside(goal, earmarks);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The working opens in place of the fields: the goal's own page one step in, and Cancel brings the fields back.
  const [working, setWorking] = useState(false);

  const template = GOAL_TEMPLATES.find((row) => row.kind === kind);

  function pickKind(next: GoalKind) {
    setKind(next);
    const chosen = GOAL_TEMPLATES.find((row) => row.kind === next);
    if (!chosen || goal) return;
    setName(chosen.label);
    setGrowth(String(chosen.growthBps / 100));
    setExpectedReturn(String(chosen.returnBps / 100));
    setReturnTyped(false);
    setStages([draftFromTemplate(chosen, today, currency)]);
  }

  const setStage = (index: number, patch: Partial<StageDraft>) => {
    setStages((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    // A new goal's return follows its first stage's date until the user types one.
    if (index === 0 && patch.dueOn && DATE.test(patch.dueOn) && !returnTyped) setExpectedReturn(String(prefilledReturnBps(kind, patch.dueOn, today) / 100));
  };
  const firstDue = stages[0]?.dueOn && DATE.test(stages[0].dueOn) ? stages[0].dueOn : today;
  const returnInfo = kind === 'emergency' || kind === 'retirement' ? 'What the money funding it should earn.' : bandHint(returnBandFor(monthsUntil(today, firstDue)));
  const canSave = !busy && canSaveGoal(name, stages);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave) return;
    setError(null);
    setBusy(true);
    try {
      const goalId = await saveGoal(database, ws, {
        id: goal?.id,
        name,
        kind,
        growthBps: Math.round(Number(growth.replace(',', '.')) * 100),
        returnBps: Math.round(Number(expectedReturn.replace(',', '.')) * 100),
        standingMonthlyMinor: standing.trim() === '' ? 0 : parseGroupedMajor(standing, currency),
        standingNote: standingNote.trim() || null,
        currency,
        stages: stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          targetMinor: stage.usesMonths ? null : parseGroupedMajor(stage.amount, currency),
          targetMonths: stage.usesMonths ? Number(stage.months) : null,
          dueOn: stage.dueOn,
          paidOn: stage.paidOn,
        })),
      });
      await setAside.write(goalId);
      await invalidate();
      goBack();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // One page: the working replaces the fields while it is open, and Cancel hands them back with their edits.
  if (working && goal) {
    return (
      <div className={SCREEN}>
        <Calculator goal={goal} onDone={goBack} onCancel={() => setWorking(false)} />
      </div>
    );
  }

  const save: CornerAction = { key: 'save', label: 'Save goal', glyph: <Check size={22} aria-hidden />, run: () => void submit(), disabled: !canSave };

  return (
    <div className={SCREEN} data-testid="goal-form">
      <PushedTitle title={goal ? goal.name : 'New goal'} back="Goals" onBack={goBack} actions={[save]} />
      <ErrorBox error={error} />
      <form onSubmit={submit}>
        <InsetGroup>
          <SelectRow label="Kind" info={template?.hint} value={kind} onChange={(e) => pickKind(e.target.value as GoalKind)} disabled={!!goal}>
            {GOAL_TEMPLATES.map((row) => (
              <option key={row.kind} value={row.kind}>
                {row.label}
              </option>
            ))}
            <option value="other">{GOAL_KIND_LABELS.other}</option>
          </SelectRow>
          <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" required />
          <SelectRow
            label="Currency"
            info={funded ? 'Money is already counted toward this goal, so its currency is fixed.' : 'What the cost and the progress are counted in. Money in other currencies is converted at the day\'s rate.'}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={funded}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>

        {stages.map((stage, index) => (
          <InsetGroup key={stage.id ?? index} header={index === 0 ? 'Payments' : `Payment ${index + 1}`} info={index === 0 ? 'Add a payment for each one the scheme asks for.' : undefined}>
            {[
              <TextRow key="what" label="What" value={stage.name} onChange={(e) => setStage(index, { name: e.target.value })} placeholder="What this payment is" required />,
              stage.usesMonths ? (
                <TextRow key="amount" label="Months of outgoings" value={stage.months} onChange={(e) => setStage(index, { months: e.target.value })} inputMode="numeric" placeholder="Months" />
              ) : (
                <TextRow
                  key="amount"
                  label="Cost in today's money"
                  prefix={currency}
                  value={stage.amount}
                  onChange={(e) => setStage(index, { amount: groupTypedAmount(e.target.value, currency) })}
                  inputMode="decimal"
                  placeholder="Amount"
                  required
                />
              ),
              <TextRow key="due" label="Needed by" type="date" value={stage.dueOn} onChange={(e) => setStage(index, { dueOn: e.target.value })} />,
              ...(stages.length > 1
                ? [<DestructiveRow key="remove" label="Remove this payment" onClick={() => setStages((rows) => rows.filter((_, i) => i !== index))} />]
                : []),
            ]}
          </InsetGroup>
        ))}
        <InsetGroup>
          <InsetRow
            label="Add a payment"
            title="＋ Add a payment"
            action
            onClick={() => setStages((rows) => [...rows, { name: '', amount: '', months: '', dueOn: today, usesMonths: false, paidOn: null }])}
          />
        </InsetGroup>

        <InsetGroup header="Growth">
          <TextRow label="Cost growth a year" info="How fast this gets more expensive." suffix="%" value={growth} onChange={(e) => setGrowth(e.target.value)} inputMode="decimal" />
          <TextRow
            label="Expected return a year"
            info={returnInfo}
            suffix="%"
            value={expectedReturn}
            onChange={(e) => {
              setExpectedReturn(e.target.value);
              setReturnTyped(true);
            }}
            inputMode="decimal"
          />
        </InsetGroup>

        <InsetGroup header="Already moving">
          <TextRow
            label="Standing amount each month"
            prefix={currency}
            info="Optional. A transfer already made for this goal, outside monthly buys."
            value={standing}
            onChange={(e) => setStanding(groupTypedAmount(e.target.value, currency))}
            inputMode="decimal"
            placeholder="Amount"
          />
          <TextRow label="What that transfer is" value={standingNote} onChange={(e) => setStandingNote(e.target.value)} placeholder="Standing transfer to the time deposit" />
        </InsetGroup>

        <SetAsideGroup state={setAside} />

        {/* For the goals whose amount is worked out rather than typed: the working is part of editing them. */}
        {goal && calculatorKindOf(kind) && goal.currency === ws.baseCurrency && currency === ws.baseCurrency && (
          <InsetGroup>
            <InsetRow
              label="Calculator"
              title="Calculator"
              action
              onClick={() => setWorking(true)}
            />
          </InsetGroup>
        )}
      </form>
    </div>
  );
}
