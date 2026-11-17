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
import { FigureRow } from './budget-rows';
import { type SplitSheetKey, splitSheetView } from './budget-view';
import { SPLIT_COLOURS } from '../essential-split/split-view';

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
            title="Use the usual take-home"
            action
            onClick={() => void run(() => clearIncomeOverride(database, ws, month))}
            label="Use the usual take-home"
          />
        </InsetGroup>
      )}
    </Sheet>
  );
}

const SPLIT_ROWS: Record<SplitSheetKey, { label: string; info: string; testId: string }> = {
  essential: { label: 'Essential', info: 'Spending in categories marked essential, and in any not marked.', testId: 'essential-spent' },
  lifestyle: { label: 'Lifestyle', info: 'Spending in categories marked lifestyle.', testId: 'lifestyle-spent' },
  debtsSavings: {
    label: 'Debts & savings',
    info: 'Spending in categories marked debts & savings, such as insurance, donations and loan interest.',
    testId: 'debts-savings-spent',
  },
};

/**
 * What the month went on, split into essential, lifestyle and debts & savings: shares of what was bought, with card
 * cashback on its own line beneath them and Spent after it.
 */
export function SplitSheet({ sheet, currency, onClose }: { sheet: BudgetSheetResult; currency: string; onClose: () => void }) {
  const view = splitSheetView(sheet);
  return (
    <Sheet grouped title="Essential and lifestyle" onClose={onClose}>
      <div className="mb-[18px] px-[4px]">
        <span aria-hidden data-testid="split-bar" className="flex h-[6px] w-full overflow-hidden rounded-full bg-[var(--ph-track)]">
          {view.bar && (
            <>
              {/* The three parts in the colours Cashflow's Income page and the Budget box draw them in. */}
              <span className="block h-full" style={{ width: `${view.bar.essential}%`, background: SPLIT_COLOURS.essential }} />
              <span className="block h-full" style={{ width: `${view.bar.lifestyle}%`, background: SPLIT_COLOURS.lifestyle }} />
              <span className="block h-full" style={{ width: `${view.bar.debtsSavings}%`, background: SPLIT_COLOURS.debtsSavings }} />
            </>
          )}
        </span>
      </div>
      <InsetGroup>
        {view.rows.map((row) => (
          <FigureRow
            key={row.key}
            label={SPLIT_ROWS[row.key].label}
            info={SPLIT_ROWS[row.key].info}
            value={
              <>
                <span className="text-[var(--ph-ink-3)]">{row.percent} · </span>
                <Money minor={row.amountMinor} currency={currency} />
              </>
            }
            testId={SPLIT_ROWS[row.key].testId}
          />
        ))}
      </InsetGroup>
      <InsetGroup>
        {view.cashbackMinor !== null && (
          <FigureRow label="Cashback & Rewards" value={<Money minor={view.cashbackMinor} currency={currency} />} testId="cashback-total" />
        )}
        <FigureRow label="Spent" value={<Money minor={view.spentMinor} currency={currency} />} dim testId="spent-total" />
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
