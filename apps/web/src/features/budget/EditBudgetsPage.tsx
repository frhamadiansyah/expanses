import { BUDGET_FREQUENCIES, type BudgetFrequency, formatMinor, groupTypedAmount, isoDate, monthOf } from '@expanses/core';
import { BudgetError, type BudgetRow, saveBudgets } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Check, RotateCcw } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { bareFigure } from '../networth/debt-rows';
import { useBooks, useOpenBook } from '../workspaces/queries';
import { useCategoryMarks } from './budget-rows';
import type { SpendHistory } from './budget-view';
import { basisOfRow, changesOf, editGroups, type EditRow, type EditState, fillFromLastMonth, initialState, isDirty, keptOf, liveCapsTotal, type RowState, rowStateOf, switchRow, typedCaps } from './edit-budgets-model';
import { FREQUENCY_WORDS } from './frequency-form';
import { useBudgets, useBudgetSheet, useSpendingHistory } from './queries';
import { keptWarning, type ShareBase } from './share-form';

const UNIT_SHORT: Record<BudgetFrequency, string> = { daily: '/day', weekly: '/wk', monthly: '/mo', quarterly: '/qtr', yearly: '/yr' };

/** Every budget of the month's tree on one screen: type down the list, Save once. Edits the plan, never one month alone. */
export function EditBudgetsPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const asked = useSearch({ strict: false }) as { month?: string };
  const month = asked.month ?? monthOf(isoDate());

  // Typed and parsed in the workspace's own money, and not until its row has been read: nothing is parsed in a guess.
  const openBook = useOpenBook();
  const currency = openBook?.baseCurrency ?? ws.baseCurrency;
  const ready = useBooks().isSuccess;
  const sheet = useBudgetSheet(month).data;
  const budgets = useBudgets(month).data;
  const history = useSpendingHistory(month, currency);
  const markOf = useCategoryMarks(useAccounts().data ?? []);

  const groups = useMemo(() => (sheet ? editGroups(sheet.lines) : []), [sheet]);
  const [initial, setInitial] = useState<EditState | null>(null);
  const [state, setState] = useState<EditState>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fields = useRef(new Map<string, HTMLInputElement>());
  // This month's take-home, as the sheet reads it: what a % of take-home is of.
  const takeHome = sheet?.incomePlanMinor ?? 0;

  // The stored figures are read once, when both have arrived; a later re-read must not wipe what is being typed.
  useEffect(() => {
    if (initial || !sheet || !budgets) return;
    const start = initialState(groups, budgets, currency);
    setInitial(start);
    setState(start);
  }, [initial, sheet, budgets, groups, currency]);

  const back = () => void navigate({ to: '/budget', search: { month } });
  const leave = () => {
    if (initial && isDirty(state, initial) && !window.confirm('Discard changes?')) return;
    back();
  };

  const rows = groups.flatMap((group) => group.rows);
  const order = rows.map((row) => row.id);
  const labelOf = (id: string) => rows.find((row) => row.id === id)?.label ?? 'A budget';

  // A refused row may sit far below Save: the reader is taken to it, with the keyboard on its figure.
  const showRow = (id: string) => {
    const field = fields.current.get(id);
    field?.focus();
    field?.scrollIntoView({ block: 'center' });
  };

  async function save() {
    setError(null);
    if (!ready || busy || !budgets || !initial) return;
    const changes = changesOf(groups, state, initial, budgets, takeHome, currency);
    if (changes.unreadable.length > 0) {
      setError(new Error(`${labelOf(changes.unreadable[0]!)}: that figure cannot be read`));
      showRow(changes.unreadable[0]!);
      return;
    }
    // A cleared parent's %-children have nothing to be a share of once it goes: each keeps its figure, as an amount.
    if (kept.size > 0) {
      const dependants = [...kept].map(([id, minor]) => ({ name: rows.find((row) => row.id === id)?.name ?? 'A budget', minor }));
      const parents = new Set([...kept.keys()].map((id) => rows.find((row) => row.id === id)?.parentId)).size;
      if (!window.confirm(keptWarning(dependants, currency, parents))) return;
    }
    try {
      setBusy(true);
      await saveBudgets(database, ws, changes, month);
      await invalidate();
      back();
    } catch (e) {
      setError(e instanceof BudgetError && e.categoryAccountId ? new Error(`${labelOf(e.categoryAccountId)}: ${e.message}`) : e);
      setBusy(false);
      if (e instanceof BudgetError && e.categoryAccountId) showRow(e.categoryAccountId);
    }
  }

  // Typing or a chip forgets what a row held before its last switch; a switch brings its own `before`.
  const change = (id: string, patch: Partial<RowState>) => setState((was) => ({ ...was, [id]: { ...rowStateOf(was, id), before: null, ...patch, filled: false } }));
  const filled = history ? fillFromLastMonth(groups, state, history, currency) : state;
  const canFill = history !== null && order.some((id) => filled[id] !== state[id]);

  const stored = { initial: initial ?? {}, budgets: budgets ?? [] };
  const budgeted = sheet ? liveCapsTotal(sheet.lines, state, takeHome, currency, stored) : 0;
  const figures = sheet ? typedCaps(sheet.lines, state, takeHome, currency, stored) : new Map<string, number>();
  const kept = keptOf(groups, state, stored);
  // What a row's % is of: the basis it was saved with while that is there, else the figure typed for its parent, or
  // take-home when its parent has none.
  const baseOf = (row: EditRow): ShareBase =>
    basisOfRow(row, figures, stored.budgets) === 'parent'
      ? { basis: 'parent', label: rows.find((r) => r.id === row.parentId)?.name ?? 'its parent', minor: figures.get(row.parentId!)! }
      : { basis: 'take-home', label: 'take-home', minor: takeHome };
  const income = sheet?.incomePlanMinor ?? 0;
  const debt = sheet?.debtPaymentsPlanMinor ?? 0;
  const goals = sheet?.savingsPlanMinor ?? 0;
  const unplanned = income - debt - goals - budgeted;
  const width = (minor: number) => (income > 0 ? `${Math.max(0, Math.min(100, (minor / income) * 100))}%` : '0%');

  return (
    <div className={SCREEN} data-testid="edit-budgets">
      <LargeTitle
        title="Edit budgets"
        back="Budget"
        onBack={leave}
        actions={[{ key: 'save', label: 'Save budgets', glyph: <Check size={20} aria-hidden />, run: () => void save(), disabled: !ready || busy || !initial }]}
      />

      <Panel className="mb-3 space-y-2" testId="edit-summary">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Budgeted</span>
          <span className="text-[13px] text-[var(--ph-ink-3)]">of {formatMinor(income, currency)} take-home</span>
        </div>
        <p className="tabular text-[24px] leading-[28px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="edit-budgeted">
          {formatMinor(budgeted, currency)}
        </p>
        <span aria-hidden className="flex h-[8px] w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ph-track)]">
          <span className="block h-full bg-[var(--ph-ink-2)]" style={{ width: width(debt) }} />
          <span className="block h-full bg-[var(--ph-info-ink)]" style={{ width: width(goals) }} />
          <span className="block h-full bg-[var(--ph-tint)]" style={{ width: width(budgeted) }} />
        </span>
        <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="edit-unplanned">
          Debt {formatMinor(debt, currency)} · Goals {formatMinor(goals, currency)} ·{' '}
          <b className={cx('font-semibold', unplanned < 0 ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink)]')}>
            {unplanned < 0 ? `Over by ${formatMinor(-unplanned, currency)}` : `Unplanned ${formatMinor(unplanned, currency)}`}
          </b>
        </p>
        {income > 0 ? (
          <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="edit-share">
            {Math.round((budgeted / income) * 100)}% of take-home budgeted
          </p>
        ) : (
          <p className="text-[13px] leading-[18px] text-[var(--ph-warn)]">Set a take-home first to budget by %</p>
        )}
      </Panel>

      <div className="mb-2 flex w-full items-center justify-between md:max-w-2xl">
        <span className="px-[16px] text-[13px] text-[var(--ph-ink-3)] uppercase">Every month</span>
        <button
          type="button"
          disabled={!canFill}
          onClick={() => setState(filled)}
          className="ph-focus flex min-h-[44px] items-center gap-[6px] px-[8px] text-[15px] font-semibold text-[var(--ph-tint)] disabled:opacity-40"
        >
          <RotateCcw size={16} aria-hidden />
          Fill empty from last month
        </button>
      </div>

      <ErrorBox error={error} />

      {initial &&
        groups.map((group) => {
          const mark = markOf(group.id);
          return (
            <InsetGroup key={group.id} header={group.name}>
              {group.rows.map((row) => {
                const base = baseOf(row);
                return (
                  <BudgetField
                    key={row.id}
                    row={row}
                    base={base}
                    shareDisabled={base.minor <= 0}
                    shareMinor={figures.get(row.id) ?? 0}
                    kept={kept.get(row.id) ?? null}
                    icon={row.depth === 0 ? mark.icon : null}
                    colour={mark.colour}
                    value={rowStateOf(state, row.id)}
                    currency={currency}
                    hint={hintOf(row, history?.get(row.id)?.lastMinor ?? 0, budgets?.find((stored) => stored.categoryAccountId === row.id), month, currency)}
                    focused={focused === row.id}
                    chips={history?.get(row.id) ?? null}
                    last={order[order.length - 1] === row.id}
                    register={(input) => {
                      if (input) fields.current.set(row.id, input);
                      else fields.current.delete(row.id);
                    }}
                    onFocus={() => setFocused(row.id)}
                    onNext={() => fields.current.get(order[order.indexOf(row.id) + 1] ?? '')?.focus()}
                    onChange={(patch) => change(row.id, patch)}
                  />
                );
              })}
            </InsetGroup>
          );
        })}
    </div>
  );
}

/** Under a row: what this month carries on its own when it does, else what last month spent. */
function hintOf(row: EditRow, lastMinor: number, stored: BudgetRow | undefined, month: string, currency: string): string {
  if (stored?.overridden) {
    const name = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long' });
    return `${name} only: ${formatMinor(stored.amountMinor, currency)}`;
  }
  if (lastMinor > 0) return `Last month ${formatMinor(lastMinor, currency)}`;
  return row.hasChildren ? 'Covers everything under it' : 'Nothing last month';
}

/** One category's field: its name and hint, the figure, and the unit it is typed in; the focused row offers figures. */
function BudgetField({
  row,
  base,
  shareDisabled,
  shareMinor,
  kept,
  icon,
  colour,
  value,
  currency,
  hint,
  focused,
  chips,
  last,
  register,
  onFocus,
  onNext,
  onChange,
  position,
}: GroupChild & {
  row: EditRow;
  /** What a % typed here is of, as things are typed now. */
  base: ShareBase;
  /** No basis to take a % of: no take-home, and no figure above it. */
  shareDisabled: boolean;
  /** What the % typed here comes to. */
  shareMinor: number;
  /** The amount this row is left at when its cleared parent goes, or null when it is not. */
  kept: number | null;
  icon: ReactNode;
  colour: string;
  value: RowState;
  currency: string;
  hint: string;
  focused: boolean;
  chips: SpendHistory | null;
  last: boolean;
  register: (input: HTMLInputElement | null) => void;
  onFocus: () => void;
  onNext: () => void;
  onChange: (patch: Partial<RowState>) => void;
}) {
  const offered = chips
    ? [
        { key: 'last', label: 'Last month', minor: chips.lastMinor },
        { key: 'average', label: '3-month average', minor: chips.averageMinor },
      ].filter((chip) => chip.minor > 0)
    : [];
  const inset = 16 + row.depth * 16;
  const share = value.mode === 'share';
  const caption = value.filled
    ? 'Filled from last month'
    : kept !== null
      ? `Kept as ${formatMinor(kept, currency)} a month`
      : share
        ? `= ${formatMinor(shareMinor, currency)} of ${base.label}`
        : hint;
  return (
    <div className={cx('relative', focused && 'bg-[var(--ph-tint-panel)]')} data-testid={`edit-row-${row.label}`}>
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 right-[16px] h-[0.5px] bg-[var(--ph-hair)]" style={{ left: inset }} />}
      <div className="flex min-h-[56px] items-center gap-[10px] py-[8px] pr-[12px]" style={{ paddingLeft: inset }}>
        {icon && (
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full" style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, var(--ph-surface))` }}>
            {icon}
          </span>
        )}
        <label htmlFor={`cap-${row.id}`} className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-[20px] text-[var(--ph-ink)]">{row.label}</span>
          <span className="truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{caption}</span>
        </label>
        <input
          id={`cap-${row.id}`}
          ref={register}
          aria-label={row.label}
          value={value.amount}
          placeholder={share ? '%' : 'Amount'}
          inputMode={share || currency !== 'IDR' ? 'decimal' : 'numeric'}
          enterKeyHint={last ? 'done' : 'next'}
          onFocus={(e) => {
            onFocus();
            e.currentTarget.select();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (last) e.currentTarget.blur();
            else onNext();
          }}
          onChange={(e) => onChange({ amount: share ? e.target.value.replace(/[^\d.,]/g, '') : groupTypedAmount(e.target.value, currency) })}
          className={cx(
            'tabular h-[36px] w-[120px] shrink-0 rounded-[8px] px-[10px] text-right text-[16px] text-[var(--ph-ink)] outline-none',
            focused ? 'bg-[var(--ph-surface)] ring-2 ring-[var(--ph-tint)]' : 'bg-[var(--ph-fill)]',
          )}
        />
        <select
          aria-label={`${row.label} every`}
          value={share ? 'share' : value.frequency}
          onChange={(e) => onChange(switchRow(value, e.target.value as 'share' | BudgetFrequency, base, currency))}
          className="ph-focus h-[36px] w-[44px] shrink-0 appearance-none bg-transparent text-[13px] text-[var(--ph-ink-3)]"
        >
          {BUDGET_FREQUENCIES.map((key) => (
            <option key={key} value={key} aria-label={FREQUENCY_WORDS[key].every}>
              {UNIT_SHORT[key]}
            </option>
          ))}
          <option value="share" disabled={shareDisabled} aria-label={`a % of ${base.label}`}>
            %
          </option>
        </select>
      </div>
      {focused && offered.length > 0 && (
        <div className="flex flex-wrap gap-2 pr-[12px] pb-[10px]" style={{ paddingLeft: inset }}>
          {offered.map((chip) => (
            <button
              key={chip.key}
              type="button"
              // Chips sit under the field; pressing one must not blur it first and fold the chips away.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange({ amount: bareFigure(chip.minor, currency), frequency: 'monthly', mode: 'amount' })}
              className="ph-focus min-h-[32px] rounded-full bg-[var(--ph-surface)] px-[12px] text-[13px] text-[var(--ph-tint)] ring-1 ring-[var(--ph-hair)] ring-inset"
            >
              {chip.label} · {bareFigure(chip.minor, currency)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
