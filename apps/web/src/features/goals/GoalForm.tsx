import { bandHint, emergencyTargetMinor, type GoalKind, formatMinor, groupedMajorString, groupTypedAmount, isoDate, monthsUntil, parseGroupedMajor, parseMajor, returnBandFor } from '@expanses/core';
import { archiveGoal, deleteGoal, type EmergencyInputs, type GoalRow, goalIsFunded, leaveSharedGoal, retagTrade, saveGoal, setEmergencyOwnTarget, shareGoal, stopSharingGoal } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { type CornerAction, InsetGroup, InsetRow, PickerRow, PushedTitle, SCREEN, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { CurrencySheet } from '../transactions/CurrencySheet';
import { Sheet } from '../../app/Sheet';
import { useOwnTarget } from '../calculators/emergency-fields';
import { Calculator, calculatorKindOf } from './Calculator';
import { assumptionsSummary, canSaveGoal, editBaseOf, keepsCalculatorWorking, onlyPaymentName, setAsideSummary } from './goal-form-model';
import { applyTagChanges, fundingSummary, tagChanges, taggedIds } from './goal-tags';
import { FundingSheet, taggable } from './FundingSheet';
import { useTrades } from '../networth/queries';
import { CostRow, costLine, DATE, PaymentSheet, type StageDraft } from './PaymentRows';
import { GOAL_KIND_LABELS, GOAL_TEMPLATES, type GoalTemplate, monthYear, prefilledReturnBps, templateDueOn, templateFor } from './goal-cards';
import { GOAL_SHARING_COPY, shareRowState } from './goal-sharing';
import { useEarmarks, useGoalCalculators, useGoalPlans, useGoalShare, useGoalShareTargets } from './queries';
import { useSetAside } from './SetAside';

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
  const navigate = useNavigate();
  const today = isoDate();
  const calculators = useGoalCalculators();
  const targets = useGoalShareTargets();
  const shareNow = useGoalShare(goal?.id ?? '');
  // Not drawn until both have answered (final review M3): a switch drawn before the share is known would read off for a
  // goal shared now, and a tap on it then would mean nothing.
  const shareKnown = targets.isSuccess && (!goal || shareNow.isSuccess);
  const shareRow = shareKnown ? shareRowState(targets.data ?? [], goal ? (shareNow.data ?? null) : null) : ({ kind: 'hidden' } as const);
  const plansNow = useGoalPlans(today);
  // The wish to share: on for a saved goal that is shared now; for a new one it is applied after the goal is saved.
  const sharedAlready = shareNow.data?.state === 'on';
  const [wantsShare, setWantsShare] = useState<boolean | null>(null);
  const [shareBook, setShareBook] = useState<string | null>(null);
  const sharing = wantsShare ?? sharedAlready;

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
  // The goal as the form opened on it: the save sends only what this edit changed (I1), so another phone's paid mark or
  // added payment, arriving while the form is open, is kept.
  const [opened] = useState(() => (goal ? editBaseOf(goal) : undefined));
  const setAside = useSetAside(goal, earmarks);
  // An emergency goal with a working can be given a Target amount of its own, rounding up from months x monthly outgoing.
  const emergencyWorking = goal && goal.kind === 'emergency' ? ((calculators.data ?? []).find((row) => row.goalId === goal.id && row.kind === 'emergency')?.inputs as EmergencyInputs | undefined) : undefined;
  const [monthsEdited, setMonthsEdited] = useState<string | null>(null);
  const monthsText = monthsEdited ?? (stages[0]?.usesMonths ? stages[0].months : emergencyWorking ? String(emergencyWorking.months) : '');
  const monthsNumber = Number(monthsText.replace(',', '.'));
  const calculatedMinor =
    emergencyWorking?.monthlyOutgoingMinor && Number.isFinite(monthsNumber) && monthsNumber > 0 ? emergencyTargetMinor(monthsNumber, emergencyWorking.monthlyOutgoingMinor) : null;
  const ownTarget = useOwnTarget(calculatedMinor, emergencyWorking?.targetMinor);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The working opens in place of the fields: the goal's own page one step in, and Cancel brings the fields back.
  const [working, setWorking] = useState(false);
  // Which payment's sheet is open ('new' for one being added), whether Assumptions is, and the currency list for a goal counted in months.
  const [paymentOpen, setPaymentOpen] = useState<number | 'new' | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  // A new goal exists from the moment it is created; a retry after a purchase was refused saves that goal again, not a second one.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const goalIdNow = goal?.id ?? createdId ?? undefined;
  // The purchases tagged to the goal: what it already had, plus what the Funding sheet added, less what it took away.
  // Only ✓ writes them, once the goal exists.
  const trades = useTrades().data ?? [];
  const originalTags = goalIdNow ? taggable(trades).filter((trade) => trade.goalId === goalIdNow).map((trade) => trade.id) : [];
  const [addedTags, setAddedTags] = useState<string[]>([]);
  const [removedTags, setRemovedTags] = useState<string[]>([]);
  const taggedNow = taggedIds(originalTags, addedTags, removedTags);
  const tags = {
    ids: taggedNow,
    add: (id: string) => {
      setAddedTags((was) => (was.includes(id) ? was : [...was, id]));
      setRemovedTags((was) => was.filter((row) => row !== id));
    },
    remove: (id: string) => {
      setRemovedTags((was) => (was.includes(id) ? was : [...was, id]));
      setAddedTags((was) => was.filter((row) => row !== id));
    },
  };

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
  // One payment is the goal itself, so it is saved under the goal's name; with several, each keeps the name it was given.
  const single = stages.length === 1;
  const named = stages.map((stage) => (single ? { ...stage, name: onlyPaymentName(name, stage.name, goal?.name) } : stage));
  const canSave = !busy && canSaveGoal(name, named);
  const setAsideEntries = setAside.rows.map((account) => {
    const currencyOfRow = setAside.currencyOf(account);
    try {
      const typed = setAside.textOf(account);
      return { currency: currencyOfRow, minor: typed.trim() === '' ? 0 : parseMajor(typed, currencyOfRow) };
    } catch {
      return { currency: currencyOfRow, minor: 0 };
    }
  });
  const blankPayment: StageDraft = { name: '', amount: '', months: '', dueOn: today, usesMonths: false, paidOn: null };

  function savePayment(index: number | 'new', draft: StageDraft) {
    if (index === 'new') {
      // The first payment gets its name now that there is more than one, so each payment has a name.
      setStages((rows) => [...rows.map((row, i) => (rows.length === 1 && i === 0 ? { ...row, name: onlyPaymentName(name, row.name, goal?.name) } : row)), draft]);
      return;
    }
    setStage(index, draft);
  }

  async function archive() {
    if (!goal || !window.confirm(`Archive "${goal.name}"? Its tagged purchases keep their history.`)) return;
    try {
      await archiveGoal(database, ws, goal.id);
      await invalidate();
      // The list is where an archived goal stops being: staying here would read a page for nothing.
      await navigate({ to: '/goals' });
    } catch (e) {
      setError(e);
    }
  }

  async function remove() {
    if (!goal || !window.confirm(`Delete "${goal.name}"? Money set aside goes back to its accounts and tagged purchases are untagged. The goal and its history are removed.`)) return;
    try {
      await deleteGoal(database, ws, goal.id);
      await invalidate();
      await navigate({ to: '/goals' });
    } catch (e) {
      setError(e);
    }
  }

  /** Leave in place of Archive and Delete on a goal someone else shared: this phone's copy stays private. */
  async function leave() {
    if (!goal || !window.confirm(GOAL_SHARING_COPY.leaveConfirm(goal.name))) return;
    try {
      await leaveSharedGoal(database, ws, goal.id);
      await invalidate();
      await navigate({ to: '/goals' });
    } catch (e) {
      setError(e);
    }
  }

  const stopping = wantsShare === false && sharedAlready && (shareRow.kind === 'switch' || shareRow.kind === 'picker');

  /**
   * Turning sharing off asks first, before anything is written (final review M1): declining leaves the goal as it was.
   * A copy is promised only to the members whose money is in the goal.
   */
  function confirmStop(): boolean {
    if (!stopping) return true;
    const share = shareNow.data;
    const others = (share?.members ?? []).filter((member) => member.memberId !== share?.me);
    const plan = plansNow.data?.plans.find((row) => row.goalId === goal?.id);
    const funders = new Set((plan?.links ?? []).map((link) => link.owner).filter((owner): owner is string => owner !== undefined));
    return window.confirm(
      GOAL_SHARING_COPY.stopConfirm(
        goal?.name ?? name,
        others.map((member) => member.name),
        others.filter((member) => funders.has(member.memberId)).map((member) => member.name),
      ),
    );
  }

  /** After the goal is saved: turn sharing on or off as the switch was left (off was asked about before the save). */
  async function applyShare(goalId: string): Promise<void> {
    const bookId = shareRow.kind === 'switch' ? shareRow.bookId : shareBook;
    if (wantsShare === null || shareRow.kind === 'hidden' || shareRow.kind === 'locked') return;
    if (wantsShare && !sharedAlready) {
      if (!bookId) return;
      await shareGoal(database, ws, goalId, bookId);
    } else if (stopping) {
      await stopSharingGoal(database, ws, goalId);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave) return;
    if (!confirmStop()) return;
    setError(null);
    setBusy(true);
    try {
      const growthBps = Math.round(Number(growth.replace(',', '.')) * 100);
      const returnBps = Math.round(Number(expectedReturn.replace(',', '.')) * 100);
      const ownable = !!emergencyWorking && single;
      const payments = named.map((stage) =>
        ownable
          ? // Months or the typed target, whichever the working now rests on.
            {
              id: stage.id,
              name: stage.name,
              targetMinor: ownTarget.minor ?? null,
              targetMonths: ownTarget.minor === undefined ? Number(monthsText.replace(',', '.')) : null,
              dueOn: stage.dueOn,
              paidOn: stage.paidOn,
            }
          : {
              id: stage.id,
              name: stage.name,
              targetMinor: stage.usesMonths ? null : parseGroupedMajor(stage.amount, currency),
              targetMonths: stage.usesMonths ? Number(stage.months) : null,
              dueOn: stage.dueOn,
              paidOn: stage.paidOn,
            },
      );
      // The own target (and its reset) is written to the working too, so the stage and the working say the same.
      const ownChanged = ownable && (ownTarget.minor !== emergencyWorking.targetMinor);
      // A goal worked out by a calculator stays linked to it when the only edit is which payments are marked paid:
      // a hand-typed save would drop the link and the keys a re-work finds its payments by. Judged against the goal as
      // the form opened on it, so a partner's change meanwhile is not taken for one made here.
      // An own target set, changed or cleared here is carried into the working below, so it is no reason to unlink.
      const keepsWorking =
        !!goal &&
        !!opened &&
        (calculators.data ?? []).some((row) => row.goalId === goal.id) &&
        keepsCalculatorWorking(opened, { growthBps, returnBps, currency, stages: payments }, ownChanged || ownTarget.minor !== undefined);
      const goalId = await saveGoal(database, ws, {
        id: goalIdNow,
        derived: keepsWorking,
        name,
        kind,
        growthBps,
        returnBps,
        // The form has no field for it; what the Monthly button set on a saved goal is carried through.
        standingMonthlyMinor: goal?.standingMonthlyMinor ?? 0,
        standingNote: goal?.standingNote ?? null,
        currency,
        stages: payments,
        ...(opened ? { base: opened } : {}),
      });
      setCreatedId(goalId);
      if (ownable && keepsWorking) {
        await setEmergencyOwnTarget(database, ws, goalId, { targetMinor: ownTarget.minor, months: Number(monthsText.replace(',', '.')) });
      }
      await setAside.write(goalId);
      await applyShare(goalId);
      const { failed } = await applyTagChanges((tradeId, to) => retagTrade(database, ws, tradeId, to), goalId, tagChanges(originalTags, taggedNow));
      await invalidate();
      if (failed.length > 0) {
        // The goal is saved; the purchases refused are still tagged here, and ✓ again tries them once more.
        throw new Error(`${failed.length === 1 ? 'A purchase' : `${failed.length} purchases`} could not be tagged: ${failed[0]!.message}`);
      }
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
          {[
            <SelectRow key="kind" label="Kind" info={template?.hint} value={kind} onChange={(e) => pickKind(e.target.value as GoalKind)} disabled={!!goal}>
              {GOAL_TEMPLATES.map((row) => (
                <option key={row.kind} value={row.kind}>
                  {row.label}
                </option>
              ))}
              <option value="other">{GOAL_KIND_LABELS.other}</option>
            </SelectRow>,
            <TextRow key="name" label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" required />,
            ...(single
              ? [
                  emergencyWorking ? (
                    <TextRow
                      key="amount"
                      label="Months of outgoings"
                      value={ownTarget.minor === undefined ? monthsText : 'not used'}
                      onChange={(e) => setMonthsEdited(e.target.value)}
                      disabled={ownTarget.minor !== undefined}
                      className={ownTarget.minor !== undefined ? 'opacity-40' : undefined}
                      inputMode="numeric"
                      placeholder="Months"
                    />
                  ) : stages[0]!.usesMonths ? (
                    <TextRow
                      key="amount"
                      label="Months of outgoings"
                      value={stages[0]!.months}
                      onChange={(e) => setStage(0, { months: e.target.value })}
                      inputMode="numeric"
                      placeholder="Months"
                    />
                  ) : (
                    <CostRow key="amount" stage={stages[0]!} currency={currency} funded={funded} onAmount={(amount) => setStage(0, { amount })} onCurrency={setCurrency} />
                  ),
                  ...(emergencyWorking ? [ownTarget.row("target")] : []),
                  <TextRow key="due" label="Due by" type="date" value={stages[0]!.dueOn} onChange={(e) => setStage(0, { dueOn: e.target.value })} />,
                  <InsetRow key="add" label="Add a payment" title={<span className="text-[var(--ph-tint)]">＋ Add a payment</span>} chevron={false} onClick={() => setPaymentOpen('new')} />,
                ]
              : []),
          ]}
        </InsetGroup>

        {!single && (
          <InsetGroup header="Payments" info="Add a payment for each one the scheme asks for.">
            {[
              ...stages.map((stage, index) => (
                <InsetRow
                  key={stage.id ?? index}
                  testId="payment-row"
                  title={
                    // One line: the name gives way first, then the month it falls due; a ✓ leads a payment marked paid.
                    <span className="flex min-w-0 items-baseline">
                      <span className="min-w-0 truncate">
                        {stage.paidOn && <Check size={15} className="mr-[4px] inline align-[-2px] text-[var(--ph-up)]" aria-label="Paid" />}
                        {stage.name}
                      </span>
                      {DATE.test(stage.dueOn) && <span className="shrink-0 whitespace-pre text-[var(--ph-ink-3)]">{` · ${monthYear(stage.dueOn)}`}</span>}
                    </span>
                  }
                  value={costLine(stage, currency)}
                  valueTone="ink"
                  chevron={false}
                  onClick={() => setPaymentOpen(index)}
                />
              )),
              <InsetRow key="add" label="Add a payment" title={<span className="text-[var(--ph-tint)]">＋ Add a payment</span>} chevron={false} onClick={() => setPaymentOpen('new')} />,
            ]}
          </InsetGroup>
        )}

        <InsetGroup>
          {[
            <PickerRow key="assumptions" label="Assumptions" value={assumptionsSummary(growth, expectedReturn)} onOpen={() => setAssumptionsOpen(true)} />,
            ...(single && stages[0]!.usesMonths
              ? [<PickerRow key="currency" label="Currency" value={currency} onOpen={() => setPickingCurrency(true)} disabled={funded} hint={funded ? 'Money is already counted toward this goal, so its currency is fixed.' : undefined} />]
              : []),
            <PickerRow key="funding" label="Funding" value={fundingSummary(setAsideSummary(setAsideEntries), taggedNow.length)} placeholder="None" onOpen={() => setFundingOpen(true)} />,
          ]}
        </InsetGroup>

        {shareRow.kind !== 'hidden' && (
          <InsetGroup footer={shareRow.kind === 'locked' ? shareRow.footer : undefined}>
            {shareRow.kind === 'picker' ? (
              <SelectRow key="share" label={GOAL_SHARING_COPY.pickerLabel} info={shareRow.options.find((option) => option.bookId === shareBook)?.info ?? GOAL_SHARING_COPY.pickerInfo} value={shareBook ?? ''} onChange={(e) => { setShareBook(e.target.value || null); setWantsShare(!!e.target.value); }}>
                <option value="">{GOAL_SHARING_COPY.pickerNone}</option>
                {shareRow.options.map((option) => (
                  <option key={option.bookId} value={option.bookId}>
                    {option.label}
                  </option>
                ))}
              </SelectRow>
            ) : (
              <SwitchRow key="share" testId="goal-share-switch" label={shareRow.label} info={shareRow.kind === 'switch' ? shareRow.info : undefined} checked={shareRow.kind === 'locked' || sharing} disabled={shareRow.kind === 'locked'} onChange={setWantsShare} />
            )}
          </InsetGroup>
        )}

        {goal && shareRow.kind === 'locked' && (
          <InsetGroup>
            <InsetRow key="leave" label={GOAL_SHARING_COPY.leaveRow} title={<span className="text-[var(--ph-warn)]">{GOAL_SHARING_COPY.leaveRow}</span>} action onClick={() => void leave()} />
          </InsetGroup>
        )}

        {goal && shareRow.kind !== 'locked' && (
          <InsetGroup footer={stages.every((stage) => stage.paidOn) && kind !== 'emergency' ? 'Archiving keeps the history and stops the goal claiming money.' : undefined}>
            {[
              <InsetRow key="archive" label="Archive goal" title="Archive goal" action onClick={() => void archive()} />,
              <InsetRow key="delete" label="Delete goal" title={<span className="text-[var(--ph-warn)]">Delete goal</span>} action onClick={() => void remove()} />,
            ]}
          </InsetGroup>
        )}

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

      {paymentOpen !== null && (
        <PaymentSheet
          key={String(paymentOpen)}
          initial={paymentOpen === 'new' ? blankPayment : { ...named[paymentOpen]! }}
          isNew={paymentOpen === 'new'}
          currency={currency}
          funded={funded}
          onCurrency={setCurrency}
          onSave={(draft) => savePayment(paymentOpen, draft)}
          onRemove={paymentOpen !== 'new' && stages.length > 1 ? () => setStages((rows) => rows.filter((_, i) => i !== paymentOpen)) : undefined}
          onClose={() => setPaymentOpen(null)}
        />
      )}
      {assumptionsOpen && (
        <Sheet title="Assumptions" onClose={() => setAssumptionsOpen(false)} grouped>
          <InsetGroup>
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
        </Sheet>
      )}
      {fundingOpen && <FundingSheet goalId={goalIdNow} setAside={setAside} tags={tags} onClose={() => setFundingOpen(false)} />}
      {pickingCurrency && <CurrencySheet value={currency} accountCurrency={currency} baseCurrency={ws.baseCurrency} onPick={setCurrency} onClose={() => setPickingCurrency(false)} />}
    </div>
  );
}
