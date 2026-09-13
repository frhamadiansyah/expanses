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
import { Button, Card, ErrorBox, Field, Input, Money, PageHeader } from '../../ui';

const bps = (percent: string) => Math.round(Number(percent.replace(',', '.')) * 100);
const num = (value: string) => Number(value.replace(',', '.'));

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
  const { ws } = useApp();
  if (!Number.isFinite(targetMinor) || targetMinor <= 0 || !Number.isFinite(months) || months <= 0) {
    return <p className="text-xs text-slate-500">Fill the figures in and the answer appears here.</p>;
  }
  const plan = savingPlanFor({ targetMinor, alreadySavedMinor, returnBps, months });
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid={testId}>
      <div>
        <div className="text-xs text-slate-500">You need</div>
        <div className="text-xl font-semibold">
          <Money minor={targetMinor} currency={ws.baseCurrency} />
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-500">Save each month</div>
        <div className="text-xl font-semibold">
          <Money minor={plan.monthlyMinor} currency={ws.baseCurrency} />
        </div>
        {plan.gapMinor === 0 && <div className="text-xs text-emerald-700">What you hold already covers it.</div>}
      </div>
    </div>
  );
}

function Panel({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-slate-500">{blurb}</p>
      </div>
      {children}
    </Card>
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
    <div className="space-y-4">
      <PageHeader title="Calculators" />
      <p className="text-xs text-slate-500">
        Work out what something costs and what it takes a month. Nothing is saved unless you turn it into a goal.
      </p>
      <ErrorBox error={error} />
      {saved && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Saved {saved} as a goal.</p>}

      <Panel title="Dana darurat" blurb="Months of everything that goes out, spending and debt payments alike.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Months of outgoings">
            <Input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={`What goes out a month (${ws.baseCurrency})`}>
            <Input value={monthlyOutgoing} onChange={(e) => setMonthlyOutgoing(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <Answer targetMinor={emergencyTarget} months={12} returnBps={200} alreadySavedMinor={0} testId="answer-emergency" />
        <Button variant="secondary" onClick={() => save('Dana darurat', 'emergency', { months: num(months) })} disabled={emergencyTarget <= 0}>
          Save Dana darurat as a goal
        </Button>
      </Panel>

      <Panel title="Dana pendidikan" blurb="Each year of study at the price it will cost in the year you pay it.">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label={`Fee a year today (${ws.baseCurrency})`}>
            <Input value={feeToday} onChange={(e) => setFeeToday(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Years until it starts">
            <Input value={startsIn} onChange={(e) => setStartsIn(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Years of study">
            <Input value={yearsOfStudy} onChange={(e) => setYearsOfStudy(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Fee inflation a year (%)">
            <Input value={feeInflation} onChange={(e) => setFeeInflation(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <Answer
          targetMinor={educationTarget}
          months={Math.max(1, Math.round(num(startsIn) * 12))}
          returnBps={1000}
          alreadySavedMinor={0}
          testId="answer-education"
        />
        <Button
          variant="secondary"
          disabled={educationTarget <= 0}
          onClick={() =>
            save('Dana pendidikan', 'education', {
              feeTodayMinor: money(feeToday),
              startsInYears: num(startsIn),
              yearsOfStudy: num(yearsOfStudy),
              feeInflationBps: bps(feeInflation),
            })
          }
        >
          Save Dana pendidikan as a goal
        </Button>
      </Panel>

      <Panel title="Dana hari tua" blurb="What the pot must hold the day you stop, drawn down while it keeps earning.">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={`Yearly spending in retirement (${ws.baseCurrency})`} hint="At today's prices.">
            <Input value={annualSpend} onChange={(e) => setAnnualSpend(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Your age now">
            <Input value={ageNow} onChange={(e) => setAgeNow(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Age you retire">
            <Input value={retireAge} onChange={(e) => setRetireAge(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Years in retirement">
            <Input value={yearsInRetirement} onChange={(e) => setYearsInRetirement(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Inflation a year (%)">
            <Input value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Return while retired (%)">
            <Input value={returnInRetirement} onChange={(e) => setReturnInRetirement(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={`Already put aside (${ws.baseCurrency})`} hint="What you hold for this today; it keeps earning until you stop.">
            <Input value={alreadySaved} onChange={(e) => setAlreadySaved(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <Answer
          targetMinor={retirementTarget}
          months={Math.max(1, Math.round(yearsToRetirement * 12))}
          returnBps={bps(returnInRetirement)}
          alreadySavedMinor={money(alreadySaved)}
          testId="answer-retirement"
        />
        <Button
          variant="secondary"
          disabled={retirementTarget <= 0}
          onClick={() =>
            save('Dana hari tua', 'retirement', {
              annualSpendTodayMinor: money(annualSpend),
              yearsToRetirement,
              yearsInRetirement: num(yearsInRetirement),
              inflationBps: bps(inflation),
              returnInRetirementBps: bps(returnInRetirement),
            })
          }
        >
          Save Dana hari tua as a goal
        </Button>
      </Panel>
    </div>
  );
}
