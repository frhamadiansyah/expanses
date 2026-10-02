import { formatMinor, groupTypedAmount, parseMajor } from '@expanses/core';
import { clearIncomeOverride, saveExpectedIncome, setIncomeOverride } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, SwitchRow, TextRow } from '../../ui/native';
import type { BudgetSheetResult } from '@expanses/db';
import { bareFigure } from '../networth/debt-rows';
import { FigureRow, type useCategoryMarks } from './budget-rows';
import type { NoBudgetEntry } from './budget-view';

/** The expected take-home: the usual figure, or this month's alone. */
export function TakeHomeSheet({
  sheet,
  month,
  currency,
  ready,
  onClose,
}: {
  sheet: BudgetSheetResult;
  month: string;
  currency: string;
  ready: boolean;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [amount, setAmount] = useState(sheet.incomePlanMinor > 0 ? bareFigure(sheet.incomePlanMinor, currency) : '');
  const [thisMonthOnly, setThisMonthOnly] = useState(sheet.incomeOverridden);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(write: () => Promise<void>) {
    setError(null);
    if (!ready || busy) return;
    try {
      setBusy(true);
      await write();
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      // The empty box is the one case `parseMajor` has no words of its own for.
      if (!amount.trim()) throw new Error('The take-home is empty — type a figure');
      const minor = parseMajor(amount, currency);
      if (thisMonthOnly) await setIncomeOverride(database, ws, { month, amountMinor: minor });
      else await saveExpectedIncome(database, ws, minor);
    });

  return (
    <Sheet grouped title="Take-home" onClose={onClose} confirm={{ label: 'Save take-home', disabled: !ready || busy, run: () => void save() }}>
      <InsetGroup>
        <TextRow
          label="Take-home"
          value={amount}
          placeholder="Amount"
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          onChange={(e) => setAmount(groupTypedAmount(e.target.value, currency))}
        />
        <SwitchRow label="Just this month" checked={thisMonthOnly} onChange={setThisMonthOnly} />
      </InsetGroup>
      <InsetGroup>
        <FigureRow label="Received so far" value={formatMinor(sheet.incomeActualMinor, currency)} dim testId="income-received" />
      </InsetGroup>
      <ErrorBox error={error} />
      {sheet.incomeOverridden && (
        <InsetGroup>
          <InsetRow
            title={<span className="font-normal">Use the usual take-home</span>}
            chevron={false}
            onClick={() => void run(() => clearIncomeOverride(database, ws, month))}
            label="Use the usual take-home"
          />
        </InsetGroup>
      )}
    </Sheet>
  );
}

const percentOf = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/** What the month went on, split into essential and lifestyle. */
export function SplitSheet({ sheet, currency, onClose }: { sheet: BudgetSheetResult; currency: string; onClose: () => void }) {
  const spent = sheet.spendingActualMinor;
  const essentialShare = spent > 0 ? Math.max(0, Math.min(1, sheet.essentialActualMinor / spent)) : 0;
  return (
    <Sheet grouped title="Essential and lifestyle" onClose={onClose}>
      <div className="mb-[18px] px-[4px]">
        <span aria-hidden className="flex h-[6px] w-full overflow-hidden rounded-full bg-[var(--ph-track)]">
          {spent > 0 && (
            <>
              <span className="block h-full bg-[var(--ph-tint)]" style={{ width: `${essentialShare * 100}%` }} />
              <span className="block h-full bg-[var(--ph-ink-3)]" style={{ width: `${(1 - essentialShare) * 100}%` }} />
            </>
          )}
        </span>
      </div>
      <InsetGroup>
        <FigureRow
          label="Essential"
          info="Spending in categories marked essential, and in any not marked."
          value={
            <>
              <span className="text-[var(--ph-ink-3)]">{percentOf(sheet.essentialActualMinor, spent)} · </span>
              <Money minor={sheet.essentialActualMinor} currency={currency} />
            </>
          }
          testId="essential-spent"
        />
        <FigureRow
          label="Lifestyle"
          info="Spending in categories marked lifestyle."
          value={
            <>
              <span className="text-[var(--ph-ink-3)]">{percentOf(sheet.lifestyleActualMinor, spent)} · </span>
              <Money minor={sheet.lifestyleActualMinor} currency={currency} />
            </>
          }
          testId="lifestyle-spent"
        />
      </InsetGroup>
      <InsetGroup>
        <FigureRow label="Spent" value={<Money minor={spent} currency={currency} />} dim testId="spent-total" />
      </InsetGroup>
    </Sheet>
  );
}

/** The month as it has gone so far: what came in, what went out, and what is left. */
export function MonthSheet({ sheet, currency, onClose }: { sheet: BudgetSheetResult; currency: string; onClose: () => void }) {
  return (
    <Sheet grouped title="Month so far" onClose={onClose}>
      <InsetGroup>
        <FigureRow label="Take-home received" value={<Money minor={sheet.incomeActualMinor} currency={currency} />} />
        <FigureRow label="Spent" value={<Money minor={sheet.spendingActualMinor} currency={currency} />} testId="month-spent" />
        {sheet.eventSpendingMinor > 0 && !sheet.eventsInCaps && (
          <FigureRow label="Events" value={<Money minor={sheet.eventSpendingMinor} currency={currency} />} />
        )}
        <FigureRow label="Debt payments" value={<Money minor={sheet.debtPaymentsActualMinor} currency={currency} />} />
        <FigureRow label="Set aside for goals" value={<Money minor={sheet.savingsActualMinor} currency={currency} />} />
      </InsetGroup>
      <InsetGroup>
        <FigureRow
          label="Left over"
          info="Take-home received, less spending, events, debt payments and what was set aside for goals."
          value={<Money minor={sheet.leftOverActualMinor} currency={currency} />}
          testId="left-over-actual"
        />
      </InsetGroup>
    </Sheet>
  );
}

/** The categories no cap covers, with what each spent; one opens its cap. */
export function NoBudgetSheet({
  entries,
  currency,
  markOf,
  onPick,
  onClose,
}: {
  entries: readonly NoBudgetEntry[];
  currency: string;
  markOf: ReturnType<typeof useCategoryMarks>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet grouped tall title="No budget" onClose={onClose}>
      <InsetGroup>
        {entries.flatMap((entry) => {
          const mark = markOf(entry.line.id);
          return [
            <InsetRow
              key={entry.line.id}
              testId={`uncapped-${entry.line.name}`}
              icon={mark.icon}
              iconColour={mark.colour}
              title={entry.line.name}
              value={<Money minor={entry.spentMinor} currency={currency} />}
              valueTone="ink-3"
              onClick={() => onPick(entry.line.id)}
            />,
            ...entry.children.map((child) => (
              <InsetRow
                key={child.line.id}
                testId={`uncapped-${child.line.name}`}
                depth={1}
                title={child.line.name}
                value={<Money minor={child.spentMinor} currency={currency} />}
                valueTone="ink-3"
                onClick={() => onPick(child.line.id)}
              />
            )),
          ];
        })}
      </InsetGroup>
    </Sheet>
  );
}
