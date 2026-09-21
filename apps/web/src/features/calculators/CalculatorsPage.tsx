import {
  balanceSheet,
  EMERGENCY_RETURN_BPS,
  emergencyTargetMinor,
  HOUSEHOLDS,
  type Household,
  INCOME_STABILITIES,
  type IncomeStability,
  isoDate,
  minorToMajorString,
  parseMajor,
  savingPlanFor,
  sheetTotals,
} from '@expanses/core';
import { createGoalFromCalculator, type EmergencyInputs, getLifeCoverDraft, saveLifeCoverDraft } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, Panel, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { EducationEditor } from '../goals/EducationEditor';
import { addLevel, educationDraftFrom } from '../goals/education-model';
import { emergencyDraftFrom, emergencyInputsOf, HOUSEHOLD_LABELS, INCOME_LABELS, monthsNote, typedMonths, withAnswers } from '../goals/emergency-form';
import { useGoalPlans } from '../goals/queries';
import { useSheet } from '../networth/queries';
import { educationWorking } from './education-answer';
import { LIFE_COVER_DEFAULTS, type LifeCoverDraft, type LifeCoverPrefill, lifeCoverPrefill, lifeCoverWorking } from './life-cover-form';
import { RETIREMENT_DEFAULTS, type RetirementDraft, retirementWorking } from './retirement-form';

/** A refusal, said on the row whose box caused it, in the alarm ink. */
function refusal(problem: string | undefined, otherwise?: ReactNode): ReactNode {
  return problem ? <span className="text-[var(--ph-alarm)]">{problem}</span> : otherwise;
}

/** A figure the calculator worked out. Tabular, so the answers line up down the page. */
function Figure({ caption, minor, note }: { caption: string; minor: number; note?: ReactNode }) {
  const { ws } = useApp();
  return (
    <div>
      <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{caption}</p>
      <p className="tabular text-[22px] leading-[28px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">
        <Money minor={minor} currency={ws.baseCurrency} />
      </p>
      {note}
    </div>
  );
}

function Waiting({ problem }: { problem?: string | null }) {
  return (
    <p className="mb-[18px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
      {problem ? refusal(problem) : 'Fill the figures in and the answer appears here.'}
    </p>
  );
}

/** Nothing is stored until you ask: a calculator is for the question you may not want to keep. */
function Answer({ answer, testId, problem }: { answer: { targetMinor: number; monthlyMinor: number; covered: boolean } | null; testId: string; problem?: string | null }) {
  if (!answer) return <Waiting problem={problem} />;
  return (
    <Panel wide testId={testId}>
      {/* Two figures, side by side where there is room: the desktop keeps both columns. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Figure caption="You need" minor={answer.targetMinor} />
        <Figure
          caption="Save each month"
          minor={answer.monthlyMinor}
          note={answer.covered ? <p className="text-[12.5px] leading-[16px] text-[var(--ph-tint)]">What you hold already covers it.</p> : undefined}
        />
      </div>
    </Panel>
  );
}

/**
 * One calculator: its questions as form rows, its answer, and the one thing it can save.
 *
 * The save action is a row of its own group rather than an outlined button under the fields — the same shape
 * every adopted form on this branch uses, dimmed and refusing the tap while there is no answer to keep.
 */
function Calculator({
  title,
  blurb,
  children,
  answer,
  save,
  saveLabel,
  ready,
}: { title: string; blurb: string; children: ReactNode; answer: ReactNode; save: () => void; saveLabel: string; ready: boolean }) {
  return (
    <>
      <InsetGroup header={title} footer={blurb}>
        {children}
      </InsetGroup>
      {answer}
      <InsetGroup>
        <InsetRow title={saveLabel} chevron={false} onClick={() => ready && save()} className={ready ? undefined : 'opacity-40'} />
      </InsetGroup>
    </>
  );
}

export function CalculatorsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [emergency, setEmergency] = useState(() => emergencyDraftFrom());
  const [monthlyOutgoing, setMonthlyOutgoing] = useState('');
  const [education, setEducation] = useState(() => addLevel(educationDraftFrom(undefined, ws.baseCurrency)));
  const [retirement, setRetirement] = useState<RetirementDraft>(RETIREMENT_DEFAULTS);

  const money = (value: string) => {
    try {
      return value.trim() === '' ? 0 : parseMajor(value, ws.baseCurrency);
    } catch {
      return 0;
    }
  };

  // The months are read by the one reader the goal's own working uses, which takes "9,5"; a figure it refuses shows no answer.
  let emergencyInputs: EmergencyInputs | null = null;
  let emergencyAnswer: { targetMinor: number; monthlyMinor: number; covered: boolean } | null = null;
  try {
    emergencyInputs = emergencyInputsOf(emergency);
    if (money(monthlyOutgoing) > 0) {
      const targetMinor = emergencyTargetMinor(emergencyInputs.months, money(monthlyOutgoing));
      const plan = savingPlanFor({ targetMinor, alreadySavedMinor: 0, returnBps: EMERGENCY_RETURN_BPS, months: 12 });
      emergencyAnswer = { targetMinor, monthlyMinor: plan.monthlyMinor, covered: plan.gapMinor === 0 };
    }
  } catch {
    emergencyInputs = null;
    emergencyAnswer = null;
  }

  // Each working reads its own boxes and never throws: a half-typed rate refuses on its row, the page stays up.
  const educationAnswer = educationWorking(education, ws.baseCurrency, today);
  const retirementAnswer = retirementWorking(retirement, ws.baseCurrency);
  const setRetirementBox = (key: keyof RetirementDraft) => (event: { target: { value: string } }) => setRetirement((draft) => ({ ...draft, [key]: event.target.value }));

  async function save(name: string, kind: 'emergency' | 'education' | 'retirement', inputs: object) {
    setError(null);
    try {
      await createGoalFromCalculator(database, ws, { name, kind, inputs: inputs as never, today });
      await invalidate();
      setSaved(`Saved ${name} as a goal.`);
    } catch (e) {
      setError(e);
    }
  }

  const retirementHint = (key: keyof RetirementDraft, otherwise?: ReactNode) => refusal(retirementAnswer.problems[key], otherwise);

  return (
    <div className={SCREEN}>
      <LargeTitle title="Calculators" subtitle="Work out what something costs and what it takes a month. Nothing is saved unless you ask." />
      <ErrorBox error={error} />
      {saved && <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]">{saved}</p>}

      <Calculator
        title="Emergency fund"
        blurb="Months of what goes out, loan principal included."
        ready={emergencyAnswer !== null && emergencyInputs !== null}
        saveLabel="Save Emergency fund as a goal"
        save={() => emergencyInputs && void save('Emergency fund', 'emergency', emergencyInputs)}
        answer={<Answer answer={emergencyAnswer} testId="answer-emergency" />}
      >
        <SelectRow
          label="Household"
          value={emergency.household}
          onChange={(e) => setEmergency((d) => withAnswers(d, { household: e.target.value as Household }))}
        >
          {HOUSEHOLDS.map((key) => (
            <option key={key} value={key}>
              {HOUSEHOLD_LABELS[key]}
            </option>
          ))}
        </SelectRow>
        <SelectRow
          label="Income"
          value={emergency.income}
          onChange={(e) => setEmergency((d) => withAnswers(d, { income: e.target.value as IncomeStability }))}
        >
          {INCOME_STABILITIES.map((key) => (
            <option key={key} value={key}>
              {INCOME_LABELS[key]}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label="Months of outgoings"
          hint={monthsNote(emergency)}
          value={emergency.months}
          onChange={(e) => setEmergency((d) => typedMonths(d, e.target.value))}
          inputMode="decimal"
        />
        <TextRow
          label={`What goes out a month (${ws.baseCurrency})`}
          value={monthlyOutgoing}
          onChange={(e) => setMonthlyOutgoing(e.target.value)}
          inputMode="numeric"
        />
      </Calculator>

      {/* Education: the same editor the goal's own calculator uses, answered by the goal engine itself. */}
      <InsetGroup header="Education fund" footer="Each year at today's prices; the goal raises each one to the year it is paid, once.">
        <InsetRow title="Levels" value={String(education.levels.length)} chevron={false} />
      </InsetGroup>
      <EducationEditor value={education} onChange={setEducation} currency={ws.baseCurrency} today={today} />
      <Answer
        answer={educationAnswer.answer && { targetMinor: educationAnswer.answer.totalMinor, monthlyMinor: educationAnswer.answer.monthlyMinor, covered: false }}
        problem={educationAnswer.problem}
        testId="answer-education"
      />
      <InsetGroup>
        <InsetRow
          title="Save Education fund as a goal"
          chevron={false}
          onClick={() => educationAnswer.inputs && void save('Education fund', 'education', educationAnswer.inputs)}
          className={educationAnswer.answer ? undefined : 'opacity-40'}
        />
      </InsetGroup>

      <Calculator
        title="Retirement fund"
        blurb="What the pot must hold the day you stop, drawn down while it keeps earning. Each month is saved at the return while saving."
        ready={retirementAnswer.inputs !== null}
        saveLabel="Save Retirement fund as a goal"
        save={() => retirementAnswer.inputs && void save('Retirement fund', 'retirement', retirementAnswer.inputs)}
        answer={
          <Answer
            answer={
              retirementAnswer.answer && {
                targetMinor: retirementAnswer.answer.targetMinor,
                monthlyMinor: retirementAnswer.answer.monthlyMinor,
                covered: retirementAnswer.answer.gapMinor === 0,
              }
            }
            testId="answer-retirement"
          />
        }
      >
        <TextRow
          label={`Yearly spending in retirement (${ws.baseCurrency})`}
          hint={retirementHint('annualSpend', "At today's prices.")}
          value={retirement.annualSpend}
          onChange={setRetirementBox('annualSpend')}
          inputMode="numeric"
        />
        <TextRow label="Your age now" hint={retirementHint('ageNow')} value={retirement.ageNow} onChange={setRetirementBox('ageNow')} inputMode="numeric" />
        <TextRow label="Age you retire" hint={retirementHint('retireAge')} value={retirement.retireAge} onChange={setRetirementBox('retireAge')} inputMode="numeric" />
        <TextRow
          label="Years in retirement"
          hint={retirementHint('yearsInRetirement')}
          value={retirement.yearsInRetirement}
          onChange={setRetirementBox('yearsInRetirement')}
          inputMode="numeric"
        />
        <TextRow label="Inflation a year (%)" hint={retirementHint('inflation')} value={retirement.inflation} onChange={setRetirementBox('inflation')} inputMode="decimal" />
        <TextRow
          label="Return while saving (%)"
          hint={retirementHint('returnBefore', 'What the money earns until you stop. The monthly figure is saved at this.')}
          value={retirement.returnBefore}
          onChange={setRetirementBox('returnBefore')}
          inputMode="decimal"
        />
        <TextRow
          label="Return while retired (%)"
          hint={retirementHint('returnInRetirement', 'What the pot earns while you are spending it.')}
          value={retirement.returnInRetirement}
          onChange={setRetirementBox('returnInRetirement')}
          inputMode="decimal"
        />
        <TextRow
          label={`Already put aside (${ws.baseCurrency})`}
          hint={retirementHint('alreadySaved', 'What you hold for this today; it keeps earning until you stop.')}
          value={retirement.alreadySaved}
          onChange={setRetirementBox('alreadySaved')}
          inputMode="numeric"
        />
      </Calculator>

      <LifeCoverSection today={today} onKept={() => setSaved('Kept the life cover figures.')} onError={setError} />
    </div>
  );
}

/**
 * Life cover waits for the figures kept last, so it opens on them rather than on the defaults and then jumps. The
 * prefills follow the balance sheet and the education goals while they load and change.
 */
function LifeCoverSection({ today, onKept, onError }: { today: string; onKept: () => void; onError: (error: unknown) => void }) {
  const { database, ws } = useApp();
  const sheetInputs = useSheet();
  const goalPlans = useGoalPlans(today);
  const remembered = useQuery({ queryKey: ['life-cover', ws.workspaceId], queryFn: () => getLifeCoverDraft(database, ws) });
  const prefill = lifeCoverPrefill(
    sheetTotals(balanceSheet(sheetInputs.data?.assets ?? [], sheetInputs.data?.liabilities ?? [])),
    goalPlans.data?.plans ?? [],
    sheetInputs.data?.missingRates ?? [],
  );
  if (!remembered.isSuccess) return null;
  return (
    <LifeCoverForm
      key={ws.workspaceId}
      initial={remembered.data ? { ...LIFE_COVER_DEFAULTS, ...remembered.data } : LIFE_COVER_DEFAULTS}
      prefill={prefill}
      keep={async (draft) => {
        try {
          await saveLifeCoverDraft(database, ws, draft);
          onKept();
        } catch (e) {
          onError(e);
        }
      }}
    />
  );
}

function LifeCoverForm({ initial, prefill, keep }: { initial: LifeCoverDraft; prefill: LifeCoverPrefill; keep: (draft: LifeCoverDraft) => Promise<void> }) {
  const { ws } = useApp();
  const [cover, setCover] = useState<LifeCoverDraft>(initial);
  const working = lifeCoverWorking(cover, prefill, ws.baseCurrency);
  const result = working.result;
  const hint = (key: keyof LifeCoverDraft, otherwise?: ReactNode) => refusal(working.problems[key], otherwise);
  // A box never typed in shows its prefill; one with no figure to show (no rate yet) stays empty and says why.
  const shown = (typed: string | undefined, prefilled: number | null) => typed ?? (prefilled === null ? '' : minorToMajorString(prefilled, ws.baseCurrency));
  const box = (key: keyof LifeCoverDraft) => (event: { target: { value: string } }) => setCover((draft) => ({ ...draft, [key]: event.target.value }));
  return (
    <>
      <InsetGroup
        header="Life cover"
        footer="Capital needs analysis: what your family would need, minus what is already there. CFP Board lists it first among the methods; the Insurance Information Institute recommends it and rejects income multiples for assuming no inflation. No figure here is rounded, and no lowest-of-several is taken."
      >
        <TextRow
          label={`Yearly amount your family needs (${ws.baseCurrency})`}
          hint={hint('annualNeed', "At today's prices.")}
          value={cover.annualNeed}
          onChange={box('annualNeed')}
          inputMode="numeric"
        />
        <TextRow label="Years of support" hint={hint('years')} value={cover.years} onChange={box('years')} inputMode="numeric" />
        <TextRow label="Inflation during support (%)" hint={hint('inflation')} value={cover.inflation} onChange={box('inflation')} inputMode="decimal" />
        <TextRow
          label="Return on the payout (%)"
          hint={hint('returnPercent', 'The money is spent down, so a cautious figure.')}
          value={cover.returnPercent}
          onChange={box('returnPercent')}
          inputMode="decimal"
        />
        <TextRow
          label={`Debts to clear (${ws.baseCurrency})`}
          hint={hint('debts', 'From your balance sheet.')}
          value={shown(cover.debts, prefill.debtsMinor)}
          onChange={box('debts')}
          inputMode="numeric"
        />
        <TextRow
          label={`Education still to fund (${ws.baseCurrency})`}
          hint={hint('education', "From your education goals, at today's prices.")}
          value={shown(cover.education, prefill.educationMinor)}
          onChange={box('education')}
          inputMode="numeric"
        />
        <TextRow label={`Final expenses (${ws.baseCurrency})`} hint={hint('finalExpenses')} value={cover.finalExpenses} onChange={box('finalExpenses')} inputMode="numeric" />
        <TextRow
          label={`Liquid assets (${ws.baseCurrency})`}
          hint={hint('liquidAssets', 'From your balance sheet.')}
          value={shown(cover.liquidAssets, prefill.liquidAssetsMinor)}
          onChange={box('liquidAssets')}
          inputMode="numeric"
        />
        <TextRow
          label={`Cover already in force (${ws.baseCurrency})`}
          hint={hint('inForce', 'Policies you hold, employer group cover included.')}
          value={cover.inForce}
          onChange={box('inForce')}
          inputMode="numeric"
        />
      </InsetGroup>
      {result ? (
        <Panel wide testId="answer-life-cover">
          <div className="grid gap-3 sm:grid-cols-2">
            <Figure caption="Income replacement, today" minor={result.incomeNeedMinor} />
            <Figure caption="Everything needed" minor={result.needsMinor} />
            <Figure caption="Already there" minor={result.resourcesMinor} />
            {result.coverMinor > 0 ? (
              <Figure caption="Cover to hold" minor={result.coverMinor} />
            ) : (
              <Figure caption="No further cover needed · to spare" minor={result.surplusMinor} />
            )}
          </div>
        </Panel>
      ) : (
        <Waiting />
      )}
      <InsetGroup footer="Kept on this device for this workspace. A box you have not typed in keeps following your balance sheet and goals.">
        <InsetRow title="Keep these figures" chevron={false} onClick={() => void keep(cover)} />
      </InsetGroup>
    </>
  );
}
