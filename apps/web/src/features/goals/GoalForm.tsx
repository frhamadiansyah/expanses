import { type GoalKind, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { type EarmarkRow, type GoalRow, removeEarmark, saveEarmark, saveGoal } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { GOAL_KIND_LABELS, GOAL_TEMPLATES, type GoalTemplate, roomFor, setAsideHint, templateDueOn, templateFor } from './goal-cards';
import { useSetAsideViews } from './queries';

interface StageDraft {
  id?: string;
  name: string;
  amount: string;
  months: string;
  dueOn: string;
  usesMonths: boolean;
  paidOn: string | null;
}

function draftFromTemplate(template: GoalTemplate, today: string): StageDraft {
  return {
    name: template.stage.name,
    amount: template.stage.targetMinor === null ? '' : String(template.stage.targetMinor),
    months: template.stage.targetMonths === null ? '' : String(template.stage.targetMonths),
    dueOn: templateDueOn(template, today),
    usesMonths: template.stage.targetMonths !== null,
    paidOn: null,
  };
}

export function GoalForm({ goal, startKind, earmarks, onDone }: { goal?: GoalRow; startKind?: GoalKind; earmarks: EarmarkRow[]; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const today = isoDate();

  const starting = goal ? undefined : templateFor(startKind ?? GOAL_TEMPLATES[0]!.kind) ?? GOAL_TEMPLATES[0]!;
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? starting!.kind);
  const [name, setName] = useState(goal?.name ?? starting!.label);
  const [growth, setGrowth] = useState(String((goal?.growthBps ?? starting!.growthBps) / 100));
  const [expectedReturn, setExpectedReturn] = useState(String((goal?.returnBps ?? starting!.returnBps) / 100));
  const [standing, setStanding] = useState(goal ? minorToMajorString(goal.standingMonthlyMinor, ws.baseCurrency) : '0');
  const [standingNote, setStandingNote] = useState(goal?.standingNote ?? '');
  const [stages, setStages] = useState<StageDraft[]>(
    goal
      ? goal.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          amount: stage.targetMinor === null ? '' : minorToMajorString(stage.targetMinor, ws.baseCurrency),
          months: stage.targetMonths === null ? '' : String(stage.targetMonths),
          dueOn: stage.dueOn,
          usesMonths: stage.targetMonths !== null,
          paidOn: stage.paidOn,
        }))
      : [draftFromTemplate(starting!, today)],
  );
  // Only what has been typed. What each box *opens* with is read at render, from the earmark and the
  // account's own currency — which is not known here: `accounts` may still be loading when this runs once.
  const [setAside, setSetAside] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const template = GOAL_TEMPLATES.find((row) => row.kind === kind);
  const savingsAccounts = (accounts.data ?? []).filter((account) => isMoneyAccount(account) && SPENDABLE_SUBTYPES.includes(account.subtype));

  /**
   * A set-aside is in the account's own money, so the box is labelled, read and written in that currency.
   *
   * The label already said "(USD)" while the parse said `ws.baseCurrency`, so typing `100,03` into a dollar
   * box met `IDR allows 0 decimal places` and a foreign set-aside could not be entered on this form at all.
   */
  const currencyOf = (account: { currency: string | null }) => account.currency ?? ws.baseCurrency;
  const earmarkOf = (accountId: string) => earmarks.find((earmark) => earmark.goalId === goal?.id && earmark.accountId === accountId);
  const setAsideText = (account: { id: string; currency: string | null }) => {
    const typed = setAside[account.id];
    if (typed !== undefined) return typed;
    const earmark = earmarkOf(account.id);
    return earmark ? minorToMajorString(earmark.amountMinor, currencyOf(account)) : '';
  };

  const views = useSetAsideViews().data ?? {};
  // Today's balance, the one the views and the question read: a future-dated entry is not money here yet (ruling M4).
  const balances = useBalances(isoDate()).data ?? {};
  /** The box's hint, from the readers' own figures: what is free for this goal there, or how short the typed figure leaves it. */
  const hintFor = (account: { id: string; name: string; currency: string | null }) => {
    const currency = currencyOf(account);
    const room = roomFor(views[account.id]?.freeMinor ?? null, balances[account.id] ?? 0, earmarkOf(account.id)?.amountMinor ?? 0);
    let typed: number | null = null;
    try {
      const text = setAside[account.id];
      if (text !== undefined && text.trim() !== '') typed = parseMajor(text, currency);
    } catch {
      typed = null;
    }
    const hint = setAsideHint(room, typed, account.name, currency);
    return hint.warn ? <span className="text-[var(--ph-warn)]">{hint.text}</span> : hint.text;
  };

  function pickKind(next: GoalKind) {
    setKind(next);
    const chosen = GOAL_TEMPLATES.find((row) => row.kind === next);
    if (!chosen || goal) return;
    setName(chosen.label);
    setGrowth(String(chosen.growthBps / 100));
    setExpectedReturn(String(chosen.returnBps / 100));
    setStages([draftFromTemplate(chosen, today)]);
  }

  const setStage = (index: number, patch: Partial<StageDraft>) => setStages((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const goalId = await saveGoal(database, ws, {
        id: goal?.id,
        name,
        kind,
        growthBps: Math.round(Number(growth.replace(',', '.')) * 100),
        returnBps: Math.round(Number(expectedReturn.replace(',', '.')) * 100),
        standingMonthlyMinor: standing.trim() === '' ? 0 : parseMajor(standing, ws.baseCurrency),
        standingNote: standingNote.trim() || null,
        stages: stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          targetMinor: stage.usesMonths ? null : parseMajor(stage.amount, ws.baseCurrency),
          targetMonths: stage.usesMonths ? Number(stage.months) : null,
          dueOn: stage.dueOn,
          paidOn: stage.paidOn,
        })),
      });
      for (const account of savingsAccounts) {
        const typed = setAsideText(account).trim();
        if (typed === '' || Number(typed.replace(/[^\d]/g, '')) === 0) await removeEarmark(database, ws, goalId, account.id);
        else await saveEarmark(database, ws, { goalId, accountId: account.id, amountMinor: parseMajor(typed, currencyOf(account)) });
      }
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
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="What kind of goal" hint={template?.hint}>
            <Select value={kind} onChange={(e) => pickKind(e.target.value as GoalKind)} disabled={!!goal}>
              {GOAL_TEMPLATES.map((row) => (
                <option key={row.kind} value={row.kind}>
                  {row.label}
                </option>
              ))}
              <option value="other">{GOAL_KIND_LABELS.other}</option>
            </Select>
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Cost growth a year (%)" hint="How fast this gets more expensive.">
            <Input value={growth} onChange={(e) => setGrowth(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Expected return a year (%)" hint="What the money funding it should earn.">
            <Input value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} inputMode="decimal" />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold">Payments</h3>
            <span className="text-xs text-slate-500">Add a stage for each payment your scheme asks for.</span>
          </div>
          {stages.map((stage, index) => (
            <div key={index} className="grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_auto]">
              <Field label="What this payment is">
                <Input value={stage.name} onChange={(e) => setStage(index, { name: e.target.value })} required />
              </Field>
              {stage.usesMonths ? (
                <Field label="Months of outgoings">
                  <Input value={stage.months} onChange={(e) => setStage(index, { months: e.target.value })} inputMode="numeric" />
                </Field>
              ) : (
                <Field label={`Cost in today's money (${ws.baseCurrency})`}>
                  <Input value={stage.amount} onChange={(e) => setStage(index, { amount: e.target.value })} inputMode="decimal" required />
                </Field>
              )}
              <Field label="Needed by">
                <Input type="date" value={stage.dueOn} onChange={(e) => setStage(index, { dueOn: e.target.value })} />
              </Field>
              <div className="flex items-end pb-1">
                {stages.length > 1 && (
                  <Button type="button" variant="ghost" onClick={() => setStages((rows) => rows.filter((_, i) => i !== index))}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setStages((rows) => [...rows, { name: '', amount: '', months: '', dueOn: today, usesMonths: false, paidOn: null }])}>
            Add a payment
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={`Standing amount each month (${ws.baseCurrency})`} hint="A transfer you already make for this goal, outside monthly buys.">
            <Input value={standing} onChange={(e) => setStanding(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="What that transfer is">
            <Input value={standingNote} onChange={(e) => setStandingNote(e.target.value)} placeholder="Standing transfer to the time deposit" />
          </Field>
        </div>

        {savingsAccounts.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Money set aside</h3>
            <p className="text-xs text-slate-500">From savings, cash or a deposit. Holdings are tagged on each purchase instead.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {savingsAccounts.map((account) => (
                <Field key={account.id} label={`${account.name} (${currencyOf(account)})`} hint={hintFor(account)}>
                  <Input value={setAsideText(account)} onChange={(e) => setSetAside({ ...setAside, [account.id]: e.target.value })} inputMode="decimal" />
                </Field>
              ))}
            </div>
          </div>
        )}

        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {goal ? 'Save goal' : 'Add goal'}
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
