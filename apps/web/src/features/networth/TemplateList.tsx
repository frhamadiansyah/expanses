import { formatMinor, isoDate, parseMajor } from '@expanses/core';
import { type AccountRow, deleteTradeTemplate, saveTradeTemplate, type TradeTemplateRow } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input, Select } from '../../ui';
import { Panel } from '../../ui/native';

export function TemplateList({
  templates,
  holdings,
  cashAccounts,
  goals,
}: {
  templates: TradeTemplateRow[];
  holdings: { accountId: string; name: string; currency: string }[];
  cashAccounts: AccountRow[];
  goals: { id: string; name: string }[];
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'buy' | 'move'>('buy');
  const [accountId, setAccountId] = useState(holdings[0]?.accountId ?? '');
  const [moveToId, setMoveToId] = useState(cashAccounts[1]?.id ?? cashAccounts[0]?.id ?? '');
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('5');
  const [goalId, setGoalId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const moving = kind === 'move';
  const currency = moving ? ws.baseCurrency : (holdings.find((row) => row.accountId === accountId)?.currency ?? ws.baseCurrency);
  const nameOf = (id: string) => holdings.find((row) => row.accountId === id)?.name ?? cashAccounts.find((account) => account.id === id)?.name ?? 'Holding';

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await saveTradeTemplate(database, ws, {
        accountId: moving ? moveToId : accountId,
        cashAccountId,
        amountMinor: parseMajor(amount, currency),
        unitsMicro: null,
        dayOfMonth: Number(day),
        active: true,
        goalId: goalId || null,
        kind,
      });
      setAmount('');
      setAdding(false);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(template: TradeTemplateRow) {
    await saveTradeTemplate(database, ws, {
      id: template.id,
      accountId: template.accountId,
      cashAccountId: template.cashAccountId,
      amountMinor: template.amountMinor,
      unitsMicro: template.unitsMicro,
      dayOfMonth: template.dayOfMonth,
      active: !template.active,
      goalId: template.goalId,
      kind: template.kind,
    });
    await invalidate();
  }

  async function remove(template: TradeTemplateRow) {
    await deleteTradeTemplate(database, ws, template.id);
    await invalidate();
  }

  return (
    <Panel className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Monthly buys and moves</h2>
        {!adding && holdings.length > 0 && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add monthly buy
          </Button>
        )}
      </div>

      {templates.length === 0 && !adding && (
        <p className="text-sm text-slate-500">None yet. A monthly buy reminds you on its day and fills the form in; a monthly move just parks money at the broker until you buy.</p>
      )}

      <div className="divide-y divide-slate-100 text-sm">
        {templates.map((template) => (
          <div key={template.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{nameOf(template.accountId)}</span>
              <span className="text-slate-500">
                {' · '}
                {template.kind === 'move' ? 'move ' : ''}
                {template.amountMinor === null ? `${(template.unitsMicro ?? 0) / 1_000_000} units` : formatMinor(template.amountMinor, currency)} on the {template.dayOfMonth}
                {template.goalId && ` · for ${goals.find((goal) => goal.id === template.goalId)?.name ?? 'a goal'}`}
                {!template.active && ' · paused'}
              </span>
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => toggle(template)}>
                {template.active ? 'Pause' : 'Resume'}
              </Button>
              <Button variant="danger" onClick={() => remove(template)}>
                Delete
              </Button>
            </span>
          </div>
        ))}
      </div>

      {adding && (
        <form onSubmit={add} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Every month" hint="A move parks money; you confirm the units when you buy.">
              <Select value={kind} onChange={(e) => setKind(e.target.value as 'buy' | 'move')}>
                <option value="buy">Buy a holding</option>
                <option value="move">Move money to invest later</option>
              </Select>
            </Field>
            {moving ? (
              <Field label="Move into" hint="Broker cash or a savings pot.">
                <Select value={moveToId} onChange={(e) => setMoveToId(e.target.value)}>
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Holding">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {holdings.map((row) => (
                    <option key={row.accountId} value={row.accountId}>
                      {row.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={`Amount (${currency})`}>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="2.000.000" required />
            </Field>
            <Field label="Day of month" hint="1 to 28, so every month has it.">
              <Input value={day} onChange={(e) => setDay(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="For goal" hint={moving ? 'The money is set aside for this goal as soon as it moves.' : 'Each recorded buy can override it.'}>
              <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">No goal</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid from">
              <Select value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
                {cashAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {moving ? 'Save monthly move' : 'Save monthly buy'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-slate-500">Nothing is bought automatically. On the day, this page shows it as due with the amount filled in. Today is {isoDate()}.</p>
        </form>
      )}
    </Panel>
  );
}
