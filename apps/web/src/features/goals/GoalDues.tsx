import { formatMinor, groupedMajorString, groupTypedAmount, isoDate, monthName, parseGroupedMajor } from '@expanses/core';
import {
  type AccountRow,
  changeGoalMonthAmount,
  type GoalDueMode,
  type GoalDueMonth,
  type GoalDueSettings,
  type GoalPlanRow,
  setAsideGoalMonth,
  skipGoalMonth,
  transferGoalMonth,
  undoGoalMonth,
} from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { SkipForward } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratesForSave } from '../../lib/rates';
import { cx, ErrorBox } from '../../ui';
import { type GroupChild, GROUP_GAP, GROUP_RADIUS, InsetGroup, InsetRow, PanelHeader, ReadOnlyRow, ROW_PAD_X, ROW_PAD_Y, RowIcon, rowHeight, SegmentedControl, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { SwipeRow } from '../../ui/SwipeRow';
import type { ToastIcon } from '../../ui/UndoToast';
import { GOAL_KIND_MARKS } from './goal-cards';
import { alreadySetAside, alreadySetAsideText, DUE_DAYS, dueDefaults, dueSheetFooter, dueTitle, dueToast, goalsThisMonth, monthHistory, monthlyFooter, noRateText, shortTakeBackText, toDefault, transferFromDefault } from './goal-due';
import { setAsideHint } from './goal-cards';
import { setAsideOf, setAsideOn } from './goal-actions';
import { useEarmarks, useGoalDues, useGoalPlans, useSetAsideViews } from './queries';
import { accountChoiceName } from '../../lib/account-name';

/** What a tap on a month leaves behind: the light Undo bar's words, its icon, and how to take it back. */
export interface DueToast {
  text: string;
  icon: ToastIcon;
  undo: () => Promise<void>;
}

/**
 * Undoes a month for an Undo bar or a sheet. When some of it was used or moved since, the month stays done with the
 * rest, and this throws what it did take back, so the screen says so in its error box.
 */
export async function undoMonth(database: Parameters<typeof undoGoalMonth>[0], ws: Parameters<typeof undoGoalMonth>[1], goal: DueGoal, month: string): Promise<void> {
  const result = await undoGoalMonth(database, ws, goal.goalId, month);
  if (!result.undone) throw new Error(shortTakeBackText(result.takenMinor, goal.currency));
}

/** A typed figure, or null while it is not one yet. */
function parsedAmount(text: string, currency: string): number | null {
  if (text.trim() === '') return null;
  try {
    return parseGroupedMajor(text, currency);
  } catch {
    return null;
  }
}

/**
 * The accounts a goal's month can use: those money can be set aside in (the goal's own Set aside list), in the goal's
 * currency, so the Monthly amount is what lands — no rate is needed between them.
 */
export function useDueAccounts(currency: string): AccountRow[] {
  const { ws } = useApp();
  const accounts = useAccounts().data ?? [];
  return moneyHolders(accounts).filter((account) => MONEY_SUBTYPES.includes(account.subtype) && (account.currency ?? ws.baseCurrency) === currency);
}

const SEGMENTS = [
  { key: 'set_aside', label: 'Set aside' },
  { key: 'transfer', label: 'Transfer' },
];

/** The Due each month part of the Monthly sheet, as typed. */
export interface DueForm {
  on: boolean;
  day: number;
  mode: GoalDueMode;
  accountId: string | null;
  toAccountId: string | null;
}

/** The form's opening state: what is saved, or — never set — the defaults, switched off. */
export function useDueForm(goalId: string, currency: string, saved: GoalDueSettings | null) {
  const accounts = useDueAccounts(currency);
  const loaded = useAccounts().isSuccess;
  const earmarks = useEarmarks().data ?? [];
  const [form, setForm] = useState<DueForm>(() => {
    if (saved) return { on: saved.active, day: saved.day, mode: saved.mode, accountId: saved.accountId, toAccountId: saved.toAccountId };
    const defaults = dueDefaults(accounts, setAsideOf(earmarks, goalId).map((row) => row.accountId).filter((id) => accounts.some((account) => account.id === id)));
    return { on: false, mode: 'set_aside', ...defaults };
  });
  // An account gone since (archived, or the list still loading at first) falls back to the first that can be used.
  const accountId = accounts.some((account) => account.id === form.accountId) ? form.accountId : (accounts[0]?.id ?? null);
  const toAccountId = accounts.some((account) => account.id === form.toAccountId && account.id !== accountId) ? form.toAccountId : toDefault(accounts, accountId);
  // Where the goal already has money set aside: Transfer's From steers clear of them (a month is new money).
  const held = setAsideOf(earmarks, goalId).map((row) => row.accountId);
  return { form: { ...form, accountId, toAccountId }, setForm, accounts, held, loaded };
}

/** A row holding the Set aside | Transfer control, with the hairline a row above it draws. */
function SegmentRow({ position, value, onChange }: GroupChild & { value: GoalDueMode; onChange: (mode: GoalDueMode) => void }) {
  return (
    <div className="relative" style={{ padding: `8px ${ROW_PAD_X}px` }}>
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X }} />}
      <SegmentedControl segments={SEGMENTS} value={value} onChange={(key) => onChange(key as GoalDueMode)} label="What each month does" className="w-full" />
    </div>
  );
}

/**
 * Due each month, under Each month (screen 1): the switch, the day, Set aside | Transfer, and the account(s). Off is
 * exactly the plan figure it always was.
 */
export function DueGroup({ due, goalName }: { due: ReturnType<typeof useDueForm>; goalName: string }) {
  const { form, setForm, accounts, held } = due;
  const nameOf = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? null;
  const set = (patch: Partial<DueForm>) => setForm((was) => ({ ...was, accountId: form.accountId, toAccountId: form.toAccountId, ...patch }));
  const toMode = (mode: GoalDueMode) => {
    if (mode !== 'transfer') return set({ mode });
    const from = transferFromDefault(accounts, held, form.accountId);
    set({ mode, accountId: from, toAccountId: form.toAccountId === from ? toDefault(accounts, from) : form.toAccountId });
  };
  if (accounts.length === 0 && due.loaded) {
    // Nothing left in the goal's currency: the switch stays, so a due turned on before can still be turned off.
    return (
      <InsetGroup footer="No account in this goal’s currency to set money aside in.">
        {[<SwitchRow key="on" label="Due each month" checked={form.on} disabled={!form.on} onChange={(on) => set({ on })} testId="due-each-month" />]}
      </InsetGroup>
    );
  }
  return (
    <InsetGroup footer={form.on ? monthlyFooter({ day: form.day, mode: form.mode, goalName, inName: nameOf(form.accountId), toName: nameOf(form.toAccountId) }) : undefined}>
      {[
        <SwitchRow key="on" label="Due each month" checked={form.on} onChange={(on) => set({ on })} testId="due-each-month" />,
        ...(form.on
          ? [
              <SelectRow key="day" label="On the" value={form.day} onChange={(e) => set({ day: Number(e.target.value) })}>
                {DUE_DAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </SelectRow>,
              <SegmentRow key="mode" value={form.mode} onChange={toMode} />,
              <SelectRow key="from" label={form.mode === 'transfer' ? 'From' : 'In'} value={form.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value })}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountChoiceName(account)}
                  </option>
                ))}
              </SelectRow>,
              ...(form.mode === 'transfer'
                ? [
                    <SelectRow key="to" label="To" value={form.toAccountId ?? ''} onChange={(e) => set({ toAccountId: e.target.value })}>
                      {accounts
                        .filter((account) => account.id !== form.accountId)
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {accountChoiceName(account)}
                          </option>
                        ))}
                    </SelectRow>,
                  ]
                : []),
            ]
          : []),
      ]}
    </InsetGroup>
  );
}

/** A goal as a month's sheet needs it. */
export interface DueGoal {
  goalId: string;
  name: string;
  currency: string;
}

/**
 * A month's sheet (screen 3): the amount, prefilled and changeable for this month only, the account(s), what is free
 * to spend there, and the big button — Set aside or Transfer — with Skip under it.
 */
export function GoalMonthSheet({ goal, month, onClose, onDone }: { goal: DueGoal; month: GoalDueMonth; onClose: () => void; onDone: (toast: DueToast) => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useDueAccounts(goal.currency);
  const views = useSetAsideViews().data ?? {};
  const earmarks = useEarmarks().data ?? [];
  const today = isoDate();
  const balances = useBalances(today).data ?? {};
  const [amount, setAmount] = useState(() => (month.amountMinor > 0 ? groupedMajorString(month.amountMinor, goal.currency) : ''));
  const [fromId, setFromId] = useState(() => (accounts.some((account) => account.id === month.accountId) ? month.accountId : (accounts[0]?.id ?? null)));
  const [toId, setToId] = useState(() => month.toAccountId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const from = accounts.find((account) => account.id === fromId) ?? accounts[0];
  const toChoices = accounts.filter((account) => account.id !== from?.id);
  const to = toChoices.find((account) => account.id === toId) ?? toChoices.find((account) => account.id === toDefault(accounts, from?.id ?? null));
  const typed = parsedAmount(amount, goal.currency);
  const ready = typed !== null && typed > 0 && !!from && (month.mode === 'set_aside' || !!to);
  const freeMinor = from ? (views[from.id]?.freeMinor ?? balances[from.id] ?? 0) : 0;
  // More than is free there: said under the amount, as the goal's own Set aside says it. Nothing is refused. A Transfer
  // past the free money moves what the goal already had set aside there first, and says how much.
  const ownThere = from ? setAsideOn(earmarks, goal.goalId, from.id) : 0;
  const moved = month.mode === 'transfer' ? alreadySetAside({ amountMinor: typed, freeMinor, ownPromiseMinor: ownThere }) : null;
  const short = from ? setAsideHint(freeMinor + (moved ?? 0), typed, from.name, goal.currency) : null;
  const over = moved !== null ? { warn: true, text: alreadySetAsideText(formatMinor(moved, goal.currency), goal.name) } : short;
  const undo = () => undoMonth(database, ws, goal, month.month);

  async function run(write: () => Promise<unknown>, toast: DueToast) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await write();
      await invalidate();
      onDone(toast);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const act = () => {
    if (!ready || !from) return;
    if (month.mode === 'set_aside') {
      void run(() => setAsideGoalMonth(database, ws, { goalId: goal.goalId, month: month.month, amountMinor: typed!, accountId: from.id, occurredOn: today }), {
        text: dueToast('set_aside', goal.name, month.month),
        icon: 'recorded',
        undo,
      });
      return;
    }
    void run(
      async () => {
        let missing = false;
        const ratesToBase = await ratesForSave({
          database,
          ws,
          currency: goal.currency,
          occurredOn: today,
          amountMinor: typed!,
          typed: '',
          resolveRates,
          onMissing: () => {
            missing = true;
          },
        }).catch((e: unknown) => {
          // This sheet has no rate row to type one into: say what can be done instead.
          throw missing ? new Error(noRateText(goal.currency)) : e;
        });
        await transferGoalMonth(database, ws, { goalId: goal.goalId, month: month.month, amountMinor: typed!, fromAccountId: from.id, toAccountId: to!.id, occurredOn: today, ratesToBase });
      },
      { text: dueToast('transfer', goal.name, month.month), icon: 'recorded', undo },
    );
  };
  const skip = () => void run(() => skipGoalMonth(database, ws, goal.goalId, month.month, today), { text: dueToast('skipped', goal.name, month.month), icon: 'skipped', undo });

  const grey = '[&_span]:!text-[var(--ph-ink-3)]';
  const label = month.mode === 'transfer' ? 'Transfer' : 'Set aside';
  const amountText = formatMinor(typed ?? 0, goal.currency);

  return (
    <Sheet grouped title={dueTitle(goal.name, month.month)} onClose={onClose}>
      <InsetGroup
        footer={
          from && (month.mode === 'set_aside' || to)
            ? dueSheetFooter({ mode: month.mode, amountText, goalName: goal.name, fromName: from.name, toName: to?.name ?? '' })
            : accounts.length === 0
              ? 'No account in this goal’s currency to use.'
              : undefined
        }
      >
        <TextRow
          label="Amount"
          prefix={goal.currency}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(groupTypedAmount(e.target.value, goal.currency))}
          placeholder="Amount"
          id="due-amount"
          hint={over?.warn ? <span className="text-[var(--ph-warn)]" data-testid="due-over">{over.text}</span> : undefined}
        />
        <SelectRow label={month.mode === 'transfer' ? 'From' : 'In'} value={from?.id ?? ''} onChange={(e) => setFromId(e.target.value)}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {accountChoiceName(account)}
            </option>
          ))}
        </SelectRow>
        {month.mode === 'transfer' ? (
          <SelectRow label="To" value={to?.id ?? ''} onChange={(e) => setToId(e.target.value)}>
            {toChoices.map((account) => (
              <option key={account.id} value={account.id}>
                {accountChoiceName(account)}
              </option>
            ))}
          </SelectRow>
        ) : (
          <ReadOnlyRow label="Free to spend there" value={formatMinor(freeMinor, goal.currency)} />
        )}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow action title={label} label={label} disabled={busy || !ready} onClick={act} testId="due-act" />
        {month.state !== 'skipped' && <InsetRow action title={`Skip ${monthName(month.month, 'long')}`} disabled={busy} onClick={skip} className={grey} testId="due-skip" />}
      </InsetGroup>
    </Sheet>
  );
}

/**
 * A done or skipped month, opened from the goal's Month history: Undo takes back exactly what it did; a set-aside
 * month's amount can be changed, its promise moving by the difference.
 */
export function DoneMonthSheet({ goal, month, onClose }: { goal: DueGoal; month: GoalDueMonth; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const nameOf = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? 'Account';
  const [amount, setAmount] = useState(() => groupedMajorString(month.amountMinor, goal.currency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const typed = parsedAmount(amount, goal.currency);
  const setAside = month.state === 'done' && month.mode === 'set_aside';
  const changed = setAside && typed !== null && typed > 0 && typed !== month.amountMinor;

  /** Runs a write; one that comes back with words (a short take-back) stays open to say them. */
  async function run(write: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const said = await write();
      await invalidate();
      if (said) setError(new Error(said));
      else onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const undo = async () => {
    const result = await undoGoalMonth(database, ws, goal.goalId, month.month);
    return result.undone ? null : shortTakeBackText(result.takenMinor, goal.currency);
  };
  const change = async () => {
    const result = await changeGoalMonthAmount(database, ws, goal.goalId, month.month, typed!);
    // Lowered further than what is left there: the month keeps what it actually has.
    return result === typed ? null : shortTakeBackText(month.amountMinor - result, goal.currency);
  };

  const name = monthName(month.month, 'long');
  return (
    <Sheet
      grouped
      title={dueTitle(goal.name, month.month)}
      onClose={onClose}
      confirm={setAside ? { label: 'Save', disabled: busy || !changed, run: () => void run(change) } : undefined}
    >
      <InsetGroup footer={month.state === 'done' && month.mode === 'transfer' ? 'Undo voids the transfer.' : undefined}>
        {month.state === 'skipped' ? (
          <ReadOnlyRow label={name} value="Skipped" />
        ) : setAside ? (
          <TextRow label="Amount" prefix={goal.currency} inputMode="decimal" value={amount} onChange={(e) => setAmount(groupTypedAmount(e.target.value, goal.currency))} placeholder="Amount" />
        ) : (
          <ReadOnlyRow label="Amount" value={formatMinor(month.amountMinor, goal.currency)} />
        )}
        {month.state === 'done' && <ReadOnlyRow label={month.mode === 'transfer' ? 'From' : 'In'} value={nameOf(month.accountId)} />}
        {month.state === 'done' && month.mode === 'transfer' && <ReadOnlyRow label="To" value={nameOf(month.toAccountId)} />}
        {month.state === 'done' && month.occurredOn && <ReadOnlyRow label="On" value={month.occurredOn} />}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow action title={month.state === 'skipped' ? 'Undo skip' : `Undo ${name}`} disabled={busy} onClick={() => void run(undo)} testId="due-undo" />
      </InsetGroup>
    </Sheet>
  );
}

/**
 * The goal page's Month history (screen 4), newest first. An open month opens its sheet; a done or skipped one opens
 * the sheet that undoes or changes it.
 */
export function MonthHistoryGroup({ goal, months, onToast }: { goal: DueGoal; months: readonly GoalDueMonth[]; onToast: (toast: DueToast) => void }) {
  const accounts = useAccounts().data ?? [];
  const nameOf = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? 'Account';
  const [opened, setOpened] = useState<GoalDueMonth | null>(null);
  if (months.length === 0) return null;
  const lines = monthHistory(months, goal.currency, nameOf, isoDate());
  return (
    <>
      <InsetGroup wide header="Month history" footer="Tap a month to undo it or change what was set aside.">
        {lines.map((line) => (
          <InsetRow
            key={line.month.month}
            testId="due-month"
            title={line.title}
            subtitle={line.subtitle}
            value={line.value}
            valueTone={line.month.state === 'skipped' ? 'ink-3' : 'ink'}
            onClick={() => setOpened(line.month)}
          />
        ))}
      </InsetGroup>
      {opened && opened.state === 'open' && (
        <GoalMonthSheet
          goal={goal}
          month={opened}
          onClose={() => setOpened(null)}
          onDone={(toast) => {
            setOpened(null);
            onToast(toast);
          }}
        />
      )}
      {opened && opened.state !== 'open' && <DoneMonthSheet goal={goal} month={opened} onClose={() => setOpened(null)} />}
    </>
  );
}

/**
 * Recurring's "Goals this month" (screen 2), after the bills: one row per goal due this month, its button saying what
 * the goal does, and a swipe for Skip as a bill has. Hidden when no goal is due.
 */
export function GoalsThisMonth({ onToast }: { onToast: (toast: DueToast) => void }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const dues = useGoalDues().data ?? [];
  const plans: readonly GoalPlanRow[] = useGoalPlans(today).data?.plans ?? [];
  const [opened, setOpened] = useState<{ goal: DueGoal; month: GoalDueMonth } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const goals = plans.map((plan) => ({ goalId: plan.goalId, name: plan.goal.name, kind: plan.goal.kind, currency: plan.currency }));
  const { lines, totals } = goalsThisMonth(dues, goals, today);
  if (lines.length === 0) return null;

  async function skip(goal: DueGoal, month: GoalDueMonth) {
    setError(null);
    try {
      await skipGoalMonth(database, ws, goal.goalId, month.month, today);
      await invalidate();
      onToast({ text: dueToast('skipped', goal.name, month.month), icon: 'skipped', undo: () => undoMonth(database, ws, goal, month.month) });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }} data-testid="goals-this-month">
      <PanelHeader title="Goals this month" trailing={totals.map((total) => formatMinor(total.amountMinor, total.currency)).join(' · ')} />
      <ErrorBox error={error} />
      <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
        {lines.map((line, index) => {
          const { Glyph, colour } = GOAL_KIND_MARKS[line.kind as keyof typeof GOAL_KIND_MARKS] ?? GOAL_KIND_MARKS.other;
          const goal: DueGoal = { goalId: line.goalId, name: line.name, currency: line.currency };
          return (
            <div key={line.goalId} data-testid="goal-due-row" data-state={line.month.state} className="group relative">
              {index > 0 && <span aria-hidden className="pointer-events-none absolute top-0 right-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 34 }} />}
              <SwipeRow
                className="group-first:rounded-t-[11px] group-last:rounded-b-[11px]"
                enabled={line.month.state === 'open'}
                actions={[{ label: 'Skip', name: `Skip ${line.name}`, icon: SkipForward, tone: 'neutral', onPress: () => void skip(goal, line.month) }]}
              >
                {(suppressClick) => (
                  <div className="relative bg-[var(--ph-surface)]">
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressClick()) return;
                        void navigate({ to: '/goals/$goalId', params: { goalId: line.goalId } });
                      }}
                      className="ph-focus-inset flex w-full items-center gap-[10px] text-left"
                      style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
                    >
                      <RowIcon tint={{ background: `color-mix(in srgb, ${colour} 12%, transparent)`, foreground: colour }}>
                        <Glyph size={15} strokeWidth={2.2} aria-hidden />
                      </RowIcon>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{line.name}</span>
                        <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{line.subtitle}</span>
                      </span>
                      {/* The room the button takes, laid over this as a button of its own: a row never holds a button. */}
                      {line.action ? (
                        <span aria-hidden className="block h-[26px] w-[84px] shrink-0" />
                      ) : (
                        <span
                          data-testid="goal-due-status"
                          className={cx('shrink-0 text-[13px] leading-[18px] font-medium', line.month.state === 'done' ? 'text-[var(--ph-up-ink)]' : 'text-[var(--ph-ink-3)]')}
                        >
                          {line.status}
                        </span>
                      )}
                    </button>
                    {line.action && (
                      <button
                        type="button"
                        onClick={() => setOpened({ goal, month: line.month })}
                        aria-label={`${line.action} for ${line.name}`}
                        className="ph-focus absolute top-1/2 -translate-y-1/2 rounded-full bg-[var(--ph-tint-panel)] px-[12px] text-[13px] leading-[26px] font-semibold text-[var(--ph-tint)] after:absolute after:-inset-x-[8px] after:-inset-y-[9px] after:content-['']"
                        style={{ right: ROW_PAD_X }}
                        data-testid="goal-due-action"
                      >
                        {line.action}
                      </button>
                    )}
                  </div>
                )}
              </SwipeRow>
            </div>
          );
        })}
      </div>
      {opened && (
        <GoalMonthSheet
          goal={opened.goal}
          month={opened.month}
          onClose={() => setOpened(null)}
          onDone={(toast) => {
            setOpened(null);
            onToast(toast);
          }}
        />
      )}
    </section>
  );
}
