import { addMonths, BUDGET_FREQUENCIES, type BudgetFrequency, type BudgetLine, formatMinor, isoDate, monthOf, parseMajor } from '@expanses/core';
import { type BudgetRow, clearBudgetOverride, removeBudget, saveBudget, saveExpectedIncome, setBudgetOverride, setIncomeOverride } from '@expanses/db';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInOpenBook, useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import {
  type CornerAction,
  DestructiveRow,
  InsetGroup,
  InsetRow,
  type InsetRowProps,
  LargeTitle,
  Panel,
  ReadOnlyRow,
  SCREEN,
  SelectRow,
  SwitchRow,
  TextRow,
} from '../../ui/native';
import { useCategorySetMembership } from '../categories/set-queries';
import { useBooks, useOpenBook } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { FREQUENCY_WORDS, perMonthPreview } from './frequency-form';
import { useBudgets, useBudgetSheet, useCommittedBills } from './queries';

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/**
 * A row of the sheet that a test can name.
 *
 * `InsetRow` has no test id of its own and the kit is not this batch's to change, so the id goes on a wrapper
 * that forwards the place the group hands it. Nothing of the row is reimplemented — the wrapper draws nothing.
 */
function TaggedRow({ testId, position, ...props }: InsetRowProps & { testId: string }) {
  return (
    <div data-testid={testId}>
      <InsetRow position={position} {...props} />
    </div>
  );
}

function Line({
  node,
  overridden,
  depth,
  committed,
  currency,
  first,
  asSetOf,
}: {
  node: BudgetLine;
  overridden: Set<string>;
  depth: number;
  committed: Record<string, number>;
  currency: string;
  first: boolean;
  /** The lines typed in another unit than a month, so the line can say what was typed. */
  asSetOf: Map<string, BudgetRow>;
}) {
  const asSet = asSetOf.get(node.id);
  return (
    <li data-testid={`line-${node.name}`} style={{ paddingLeft: depth * 20 }}>
      <InsetRow
        position={{ first: first && depth === 0, last: false, separator: !(first && depth === 0) }}
        title={node.name}
        subtitle={
          node.capMinor === null ? (
            'No budget'
          ) : (
            <>
              Cap <Money minor={node.capMinor} currency={currency} />
              {asSet && (
                <>
                  {' · '}
                  <Money minor={asSet.amountAsSetMinor} currency={currency} /> {FREQUENCY_WORDS[asSet.frequency].per}
                </>
              )}
              {overridden.has(node.id) && ' · just this month'}
              {committed[node.id] !== undefined && (
                <>
                  {' · '}
                  <Money minor={committed[node.id]!} currency={currency} /> of it is bills
                </>
              )}
            </>
          )
        }
        value={
          <span className="block text-right">
            <Money minor={node.totalMinor} currency={currency} />
            {node.overMinor > 0 && (
              <span className="block text-[12.5px] leading-[16px] font-medium text-[var(--ph-alarm)]">
                Over by <Money minor={node.overMinor} currency={currency} />
              </span>
            )}
          </span>
        }
        valueTone="ink"
        chevron={false}
      />
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Line
              key={child.id}
              node={child}
              overridden={overridden}
              depth={depth + 1}
              committed={committed}
              currency={currency}
              first={false}
              asSetOf={asSetOf}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function BudgetPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [month, setMonth] = useState(monthOf(isoDate()));
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [thisMonthOnly, setThisMonthOnly] = useState(false);
  const [frequency, setFrequency] = useState<BudgetFrequency>('monthly');
  const [income, setIncome] = useState('');
  const [incomeThisMonthOnly, setIncomeThisMonthOnly] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const incomeForm = useRef<HTMLFormElement>(null);
  const budgetForm = useRef<HTMLFormElement>(null);

  const accounts = useAccounts().data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  // Caps are for the monthly tree; an event plans its set on its own page.
  const inOpenBook = useInOpenBook();
  // Caps are the open book's too: a Business budget is set against Business categories.
  const categories = accounts.filter((account) => account.kind === 'expense' && membership[account.id] === undefined && inOpenBook(account));
  const sheetQuery = useBudgetSheet(month);
  const budgets = useBudgets(month);
  const sheet = sheetQuery.data;
  const overridden = new Set((budgets.data ?? []).filter((row) => row.overridden).map((row) => row.categoryAccountId));
  const asSetOf = new Map((budgets.data ?? []).filter((row) => row.frequency !== 'monthly').map((row) => [row.categoryAccountId, row]));
  const committed = useCommittedBills().data ?? {};
  // A cap, a month override and the expected take-home are the workspace's own figures, kept in the money that
  // workspace reads in — so they are typed, parsed and labelled in it, and the actuals they are compared against
  // are converted into the same currency. Read from the workspace's own row rather than from the sheet: what a
  // figure is parsed in must not depend on a query still being in flight.
  const openBook = useOpenBook();
  const planCurrency = openBook?.baseCurrency ?? ws.baseCurrency;
  // …and not until that row has actually been read: while the workspaces are still in flight every workspace looks
  // like the owner's own, and a cap typed into a workspace that reads in dollars would be parsed as rupiah — a
  // hundredfold error, silently stored. The forms wait rather than guess.
  const planReady = useBooks().isSuccess;
  // The sheet answers in the open workspace's own currency; the workspace's own row is the answer until it arrives.
  const currency = sheet?.currency ?? planCurrency;
  // An override is always a month's figure; only the plan is typed in the unit the user thinks in.
  const unit: BudgetFrequency = thisMonthOnly ? 'monthly' : frequency;
  const preview = perMonthPreview(amount, unit, planCurrency);

  // Roots first, each followed by its children, so the select reads like the sheet.
  const options = categories
    .filter((account) => !categories.some((parent) => parent.id === account.parentId))
    .flatMap((root) => [
      { id: root.id, label: root.name },
      ...categories.filter((child) => child.parentId === root.id).map((child) => ({ id: child.id, label: `— ${child.name}` })),
    ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!planReady) return;
    try {
      if (!categoryId) throw new Error(options.length === 0 ? 'There are no categories to budget for yet' : 'Choose a category');
      const target = categoryId;
      const minor = parseMajor(amount, planCurrency);
      if (thisMonthOnly) await setBudgetOverride(database, ws, { categoryAccountId: target, month, amountMinor: minor });
      else await saveBudget(database, ws, { categoryAccountId: target, amountMinor: minor, frequency: unit });
      await invalidate();
      setAmount('');
    } catch (e) {
      setError(e);
    }
  }

  async function submitIncome(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!planReady) return;
    try {
      const minor = parseMajor(income, planCurrency);
      if (incomeThisMonthOnly) await setIncomeOverride(database, ws, { month, amountMinor: minor });
      else await saveExpectedIncome(database, ws, minor);
      await invalidate();
      setIncome('');
    } catch (e) {
      setError(e);
    }
  }

  async function remove() {
    setError(null);
    try {
      if (!categoryId) throw new Error(options.length === 0 ? 'There are no categories to budget for yet' : 'Choose a category');
      const target = categoryId;
      if (thisMonthOnly) await clearBudgetOverride(database, ws, target, month);
      else await removeBudget(database, ws, target);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  /* The two square arrow buttons become the corner glyphs the kit draws at every width. */
  const actions: CornerAction[] = [
    { key: 'prev', label: 'Previous month', glyph: <ChevronLeft size={22} aria-hidden />, run: () => setMonth(addMonths(month, -1)) },
    { key: 'next', label: 'Next month', glyph: <ChevronRight size={22} aria-hidden />, run: () => setMonth(addMonths(month, 1)) },
  ];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Budget" subtitle={monthLabel(month)} actions={actions} />

      <ErrorBox error={error} />
      <Unconverted missing={sheet?.unconverted ?? []} currency={currency} />

      {sheet && (
        <InsetGroup header="This month">
          <InsetRow
            title="Budgeted"
            value={
              <span data-testid="caps-total">
                <Money minor={sheet.capsTotalMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Spent"
            value={
              <span data-testid="spent-total">
                <Money minor={sheet.spendingActualMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Essential"
            subtitle="Spending in categories marked essential, or not marked"
            value={
              <span data-testid="essential-spent">
                <Money minor={sheet.essentialActualMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Lifestyle"
            subtitle="Spending in categories marked lifestyle"
            value={
              <span data-testid="lifestyle-spent">
                <Money minor={sheet.lifestyleActualMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Left over, as planned"
            value={
              <span data-testid="left-over-plan">
                <Money minor={sheet.leftOverPlanMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Left over, so far"
            subtitle={`${sheet.overCount} over their cap`}
            value={
              <span data-testid="left-over-actual">
                <Money minor={sheet.leftOverActualMinor} currency={currency} />
              </span>
            }
            valueTone="ink"
            chevron={false}
          />
        </InsetGroup>
      )}

      {sheet && (
        <InsetGroup
          header="Where it goes"
          footer={sheet.savings.length === 0 ? 'No goals yet, so nothing is being saved towards.' : undefined}
        >
          <TaggedRow
            testId="income-line"
            title="Take-home pay"
            subtitle={
              <>
                Planned <Money minor={sheet.incomePlanMinor} currency={currency} />
                {sheet.incomeOverridden && ' · just this month'}
              </>
            }
            value={<Money minor={sheet.incomeActualMinor} currency={currency} />}
            valueTone="ink"
            chevron={false}
          />
          <TaggedRow
            testId="debt-line"
            title="Debt payments"
            subtitle="Loans and instalments, which are committed before anything else."
            value={<Money minor={sheet.debtPaymentsActualMinor} currency={currency} />}
            valueTone="ink"
            chevron={false}
          />
          {sheet.eventSpendingMinor > 0 && (
            <TaggedRow
              testId="event-line"
              title="Events"
              /* Named either way, but it is only a separate subtraction when the caps above have not seen it. */
              subtitle={
                sheet.eventsInCaps
                  ? 'Included in the caps above, because this workspace counts what it means to spend.'
                  : 'Outside the caps, because you meant to spend it. Still taken off what is left.'
              }
              value={<Money minor={sheet.eventSpendingMinor} currency={currency} />}
              valueTone="ink"
              chevron={false}
            />
          )}
          {sheet.savings.map((row) => (
            <TaggedRow
              key={row.goalId}
              testId={`savings-${row.name}`}
              title={row.name}
              subtitle={
                <>
                  Needs <Money minor={row.planMinor} currency={currency} /> a month
                </>
              }
              value={<Money minor={row.actualMinor} currency={currency} />}
              valueTone="ink"
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

      <form ref={incomeForm} onSubmit={submitIncome}>
        <InsetGroup header="Expected take-home">
          <TextRow
            label={`Expected take-home (${planCurrency})`}
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            inputMode="numeric"
          />
          <SwitchRow label="Bonus month" checked={incomeThisMonthOnly} onChange={setIncomeThisMonthOnly} />
          {/* `requestSubmit` rather than calling `submitIncome` straight: the browser still checks the form first. */}
          <InsetRow
            title="Set income"
            chevron={false}
            onClick={() => planReady && incomeForm.current?.requestSubmit()}
            className={planReady ? undefined : 'opacity-40'}
          />
        </InsetGroup>
      </form>

      <form ref={budgetForm} onSubmit={submit}>
        <InsetGroup header="Cap a category">
          {/*
           * The empty option stays first and stays selected until a category is chosen: falling through to
           * whatever option sorted first silently capped Utilities, a category nobody had picked.
           */}
          <SelectRow label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectRow>
          {!thisMonthOnly && (
            <SelectRow label="Every" value={frequency} onChange={(e) => setFrequency(e.target.value as BudgetFrequency)}>
              {BUDGET_FREQUENCIES.map((key) => (
                <option key={key} value={key}>
                  {FREQUENCY_WORDS[key].every}
                </option>
              ))}
            </SelectRow>
          )}
          <TextRow
            label={`${FREQUENCY_WORDS[unit].amount} (${planCurrency})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
          />
          {unit !== 'monthly' && <ReadOnlyRow label="Per month" value={preview === null ? null : formatMinor(preview, planCurrency)} />}
          <SwitchRow label="Just this month" checked={thisMonthOnly} onChange={setThisMonthOnly} />
          <InsetRow
            title="Set budget"
            chevron={false}
            onClick={() => planReady && budgetForm.current?.requestSubmit()}
            className={planReady ? undefined : 'opacity-40'}
          />
        </InsetGroup>
        <InsetGroup>
          <DestructiveRow label="Remove" onClick={() => void remove()} />
        </InsetGroup>
      </form>

      <Panel wide pad={false} header="Every category">
        <ul>
          {(sheet?.lines ?? []).map((node, index) => (
            <Line
              key={node.id}
              node={node}
              overridden={overridden}
              depth={0}
              committed={committed}
              currency={currency}
              first={index === 0}
              asSetOf={asSetOf}
            />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
