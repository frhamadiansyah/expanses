import { isoDate, parseMajor } from '@expanses/core';
import { type CalculatorKind, type GoalRow, saveGoalCalculator } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input } from '../../ui';

/** The kinds a calculator exists for. Everything else is typed in, because only you know the figure. */
export const CALCULABLE: CalculatorKind[] = ['emergency', 'education', 'retirement'];

export function calculatorKindOf(kind: string): CalculatorKind | null {
  return CALCULABLE.includes(kind as CalculatorKind) ? (kind as CalculatorKind) : null;
}

const percentToBps = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);

export function Calculator({ goal, onDone }: { goal: GoalRow; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const kind = calculatorKindOf(goal.kind)!;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Emergency
  const [months, setMonths] = useState('6');
  // Education
  const [feeToday, setFeeToday] = useState('');
  const [startsIn, setStartsIn] = useState('10');
  const [yearsOfStudy, setYearsOfStudy] = useState('4');
  const [feeInflation, setFeeInflation] = useState('10');
  // Retirement
  const [annualSpend, setAnnualSpend] = useState('');
  const [yearsToRetirement, setYearsToRetirement] = useState('20');
  const [yearsInRetirement, setYearsInRetirement] = useState('20');
  const [inflation, setInflation] = useState('5');
  const [returnInRetirement, setReturnInRetirement] = useState('8');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const inputs =
        kind === 'emergency'
          ? { months: Number(months) }
          : kind === 'education'
            ? {
                feeTodayMinor: parseMajor(feeToday, ws.baseCurrency),
                startsInYears: Number(startsIn),
                yearsOfStudy: Number(yearsOfStudy),
                feeInflationBps: percentToBps(feeInflation),
              }
            : {
                annualSpendTodayMinor: parseMajor(annualSpend, ws.baseCurrency),
                yearsToRetirement: Number(yearsToRetirement),
                yearsInRetirement: Number(yearsInRetirement),
                inflationBps: percentToBps(inflation),
                returnInRetirementBps: percentToBps(returnInRetirement),
              };
      await saveGoalCalculator(database, ws, { goalId: goal.id, kind, inputs, today: isoDate() });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Work out {goal.name}</h2>
          <p className="text-xs text-slate-500">
            {kind === 'emergency'
              ? 'Months of everything that goes out, spending and debt payments alike. The amount follows your spending, so it moves when your spending does.'
              : kind === 'education'
                ? 'Each year of study is worked out at the price it will cost in the year you pay it, not at today’s.'
                : 'What the pot must hold on the day you stop, drawn down over your retirement while it keeps earning.'}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {kind === 'emergency' && (
            <Field label="Months of outgoings" hint="Three to six is the usual guide, twelve with dependants.">
              <Input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" required />
            </Field>
          )}

          {kind === 'education' && (
            <>
              <Field label={`Fee a year today (${ws.baseCurrency})`}>
                <Input value={feeToday} onChange={(e) => setFeeToday(e.target.value)} inputMode="numeric" required />
              </Field>
              <Field label="Years until it starts">
                <Input value={startsIn} onChange={(e) => setStartsIn(e.target.value)} inputMode="numeric" required />
              </Field>
              <Field label="Years of study">
                <Input value={yearsOfStudy} onChange={(e) => setYearsOfStudy(e.target.value)} inputMode="numeric" required />
              </Field>
              <Field label="Fee inflation a year (%)" hint="School fees usually outrun everything else.">
                <Input value={feeInflation} onChange={(e) => setFeeInflation(e.target.value)} inputMode="decimal" required />
              </Field>
            </>
          )}

          {kind === 'retirement' && (
            <>
              <Field label={`Yearly spending in retirement (${ws.baseCurrency})`} hint="At today's prices. Inflation is applied for you.">
                <Input value={annualSpend} onChange={(e) => setAnnualSpend(e.target.value)} inputMode="numeric" required />
              </Field>
              <Field label="Years until retirement">
                <Input value={yearsToRetirement} onChange={(e) => setYearsToRetirement(e.target.value)} inputMode="numeric" required />
              </Field>
              <Field label="Years in retirement">
                <Input value={yearsInRetirement} onChange={(e) => setYearsInRetirement(e.target.value)} inputMode="numeric" required />
              </Field>
              <Field label="Inflation a year (%)">
                <Input value={inflation} onChange={(e) => setInflation(e.target.value)} inputMode="decimal" required />
              </Field>
              <Field label="Return while retired (%)" hint="What the pot earns while you are spending it.">
                <Input value={returnInRetirement} onChange={(e) => setReturnInRetirement(e.target.value)} inputMode="decimal" required />
              </Field>
            </>
          )}
        </div>

        <ErrorBox error={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Use this amount
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
