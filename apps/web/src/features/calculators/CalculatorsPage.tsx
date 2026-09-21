import {
  educationStages,
  emergencyTargetMinor,
  isoDate,
  parseMajor,
  retirementTargetMinor,
  savingPlanFor,
} from '@expanses/core';
import { createGoalFromCalculator } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, Panel, SCREEN, TextRow } from '../../ui/native';

const bps = (percent: string) => Math.round(Number(percent.replace(',', '.')) * 100);
const num = (value: string) => Number(value.replace(',', '.'));

/** A figure the calculator worked out. Tabular, so the three answers line up down the page. */
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

/** Nothing is stored until you ask: a calculator is for the question you may not want to keep. */
function Answer({
  targetMinor,
  months,
  returnBps,
  alreadySavedMinor,
  testId,
}: {
  targetMinor: number;
  months: number;
  returnBps: number;
  alreadySavedMinor: number;
  testId: string;
}) {
  if (!Number.isFinite(targetMinor) || targetMinor <= 0 || !Number.isFinite(months) || months <= 0) {
    return <p className="mb-[18px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Fill the figures in and the answer appears here.</p>;
  }
  const plan = savingPlanFor({ targetMinor, alreadySavedMinor, returnBps, months });
  return (
    <Panel wide testId={testId}>
      {/* Two figures, side by side where there is room: the desktop keeps both columns. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Figure caption="You need" minor={targetMinor} />
        <Figure
          caption="Save each month"
          minor={plan.monthlyMinor}
          note={plan.gapMinor === 0 ? <p className="text-[12.5px] leading-[16px] text-[var(--ph-tint)]">What you hold already covers it.</p> : undefined}
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
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [months, setMonths] = useState('6');
  const [monthlyOutgoing, setMonthlyOutgoing] = useState('');

  const [feeToday, setFeeToday] = useState('');
  const [startsIn, setStartsIn] = useState('10');
  const [yearsOfStudy, setYearsOfStudy] = useState('4');
  const [feeInflation, setFeeInflation] = useState('10');

  const [annualSpend, setAnnualSpend] = useState('');
  const [ageNow, setAgeNow] = useState('35');
  const [retireAge, setRetireAge] = useState('55');
  const [yearsInRetirement, setYearsInRetirement] = useState('20');
  const [inflation, setInflation] = useState('5');
  const [returnInRetirement, setReturnInRetirement] = useState('8');
  const [alreadySaved, setAlreadySaved] = useState('');

  const money = (value: string) => {
    try {
      return value.trim() === '' ? 0 : parseMajor(value, ws.baseCurrency);
    } catch {
      return 0;
    }
  };

  const emergencyTarget = money(monthlyOutgoing) > 0 && num(months) > 0 ? emergencyTargetMinor(num(months), money(monthlyOutgoing)) : 0;

  const educationOk = money(feeToday) > 0 && num(yearsOfStudy) > 0 && num(startsIn) >= 0;
  const educationTarget = educationOk
    ? educationStages(
        { feeTodayMinor: money(feeToday), startsInYears: num(startsIn), yearsOfStudy: num(yearsOfStudy), feeInflationBps: bps(feeInflation) },
        isoDate(),
      ).reduce((total, stage) => total + stage.targetMinor, 0)
    : 0;

  const yearsToRetirement = num(retireAge) - num(ageNow);
  const retirementOk = money(annualSpend) > 0 && yearsToRetirement > 0 && num(yearsInRetirement) > 0;
  const retirementTarget = retirementOk
    ? retirementTargetMinor({
        annualSpendTodayMinor: money(annualSpend),
        yearsToRetirement,
        yearsInRetirement: num(yearsInRetirement),
        inflationBps: bps(inflation),
        returnInRetirementBps: bps(returnInRetirement),
      })
    : 0;

  async function save(name: string, kind: 'emergency' | 'education' | 'retirement', inputs: Record<string, number>) {
    setError(null);
    try {
      await createGoalFromCalculator(database, ws, { name, kind, inputs: inputs as never, today: isoDate() });
      await invalidate();
      setSaved(name);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Calculators" subtitle="Work out what something costs and what it takes a month. Nothing is saved unless you turn it into a goal." />
      <ErrorBox error={error} />
      {saved && <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]">Saved {saved} as a goal.</p>}

      <Calculator
        title="Emergency fund"
        blurb="Months of everything that goes out, spending and debt payments alike."
        ready={emergencyTarget > 0}
        saveLabel="Save Emergency fund as a goal"
        save={() => void save('Emergency fund', 'emergency', { months: num(months) })}
        answer={<Answer targetMinor={emergencyTarget} months={12} returnBps={200} alreadySavedMinor={0} testId="answer-emergency" />}
      >
        <TextRow label="Months of outgoings" value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" />
        <TextRow
          label={`What goes out a month (${ws.baseCurrency})`}
          value={monthlyOutgoing}
          onChange={(e) => setMonthlyOutgoing(e.target.value)}
          inputMode="numeric"
        />
      </Calculator>

      <Calculator
        title="Education fund"
        blurb="Each year of study at the price it will cost in the year you pay it."
        ready={educationTarget > 0}
        saveLabel="Save Education fund as a goal"
        save={() =>
          void save('Education fund', 'education', {
            feeTodayMinor: money(feeToday),
            startsInYears: num(startsIn),
            yearsOfStudy: num(yearsOfStudy),
            feeInflationBps: bps(feeInflation),
          })
        }
        answer={
          <Answer
            targetMinor={educationTarget}
            months={Math.max(1, Math.round(num(startsIn) * 12))}
            returnBps={1000}
            alreadySavedMinor={0}
            testId="answer-education"
          />
        }
      >
        <TextRow label={`Fee a year today (${ws.baseCurrency})`} value={feeToday} onChange={(e) => setFeeToday(e.target.value)} inputMode="numeric" />
        <TextRow label="Years until it starts" value={startsIn} onChange={(e) => setStartsIn(e.target.value)} inputMode="numeric" />
        <TextRow label="Years of study" value={yearsOfStudy} onChange={(e) => setYearsOfStudy(e.target.value)} inputMode="numeric" />
        <TextRow label="Fee inflation a year (%)" value={feeInflation} onChange={(e) => setFeeInflation(e.target.value)} inputMode="decimal" />
      </Calculator>

      <Calculator
        title="Retirement fund"
        blurb="What the pot must hold the day you stop, drawn down while it keeps earning."
        ready={retirementTarget > 0}
        saveLabel="Save Retirement fund as a goal"
        save={() =>
          void save('Retirement fund', 'retirement', {
            annualSpendTodayMinor: money(annualSpend),
            yearsToRetirement,
            yearsInRetirement: num(yearsInRetirement),
            inflationBps: bps(inflation),
            returnInRetirementBps: bps(returnInRetirement),
          })
        }
        answer={
          <Answer
            targetMinor={retirementTarget}
            months={Math.max(1, Math.round(yearsToRetirement * 12))}
            returnBps={bps(returnInRetirement)}
            alreadySavedMinor={money(alreadySaved)}
            testId="answer-retirement"
          />
        }
      >
        <TextRow
          label={`Yearly spending in retirement (${ws.baseCurrency})`}
          hint="At today's prices."
          value={annualSpend}
          onChange={(e) => setAnnualSpend(e.target.value)}
          inputMode="numeric"
        />
        <TextRow label="Your age now" value={ageNow} onChange={(e) => setAgeNow(e.target.value)} inputMode="numeric" />
        <TextRow label="Age you retire" value={retireAge} onChange={(e) => setRetireAge(e.target.value)} inputMode="numeric" />
        <TextRow label="Years in retirement" value={yearsInRetirement} onChange={(e) => setYearsInRetirement(e.target.value)} inputMode="numeric" />
        <TextRow label="Inflation a year (%)" value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" />
        <TextRow label="Return while retired (%)" value={returnInRetirement} onChange={(e) => setReturnInRetirement(e.target.value)} inputMode="decimal" />
        <TextRow
          label={`Already put aside (${ws.baseCurrency})`}
          hint="What you hold for this today; it keeps earning until you stop."
          value={alreadySaved}
          onChange={(e) => setAlreadySaved(e.target.value)}
          inputMode="numeric"
        />
      </Calculator>
    </div>
  );
}
