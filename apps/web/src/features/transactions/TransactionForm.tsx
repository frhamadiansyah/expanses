import { isoDate, minorToMajorString, parseMajor, parseRate } from '@expanses/core';
import { type AccountRow, postTransaction, replaceTransaction, type TransactionView, upsertRate } from '@expanses/db';
import { type FormEvent, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { CategoryOptions } from '../cards/options';
import { type Draft, draftFromTransaction, draftToLines, emptyDraft } from './draft';

function MoneyAccountOptions({ accounts }: { accounts: AccountRow[] }) {
  const money = accounts.filter(isMoneyAccount);
  return (
    <>
      <option value="">Choose…</option>
      <optgroup label="Accounts">
        {money.filter((a) => a.kind === 'asset').map((a) => (
          <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
      <optgroup label="Credit cards & debts">
        {money.filter((a) => a.kind === 'liability').map((a) => (
          <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
    </>
  );
}

export function TransactionForm({ initial, onDone }: { initial?: TransactionView; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  const [draft, setDraft] = useState<Draft>(() => (initial ? draftFromTransaction(initial) : emptyDraft()));
  const [manualRate, setManualRate] = useState('');
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const moneyAccount = byId.get(draft.moneyId);
  const toAccount = byId.get(draft.toId);
  const currency = moneyAccount?.currency ?? ws.baseCurrency;
  const crossCurrency = draft.mode === 'transfer' && !!moneyAccount && !!toAccount && moneyAccount.currency !== toAccount.currency;
  const splitTotal = draft.splits.reduce((s, r) => {
    try {
      return s + (r.amount.trim() ? parseMajor(r.amount, currency) : 0);
    } catch {
      return s;
    }
  }, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const lines = draftToLines(draft, accounts);
      const today = isoDate();
      // Rates are resolved no later than today, so a manual rate must be stored under the same date.
      const rateDate = draft.occurredOn > today ? today : draft.occurredOn;
      if (needsRate && manualRate.trim()) {
        const rate = parseRate(manualRate);
        await checkManualRate(database, needsRate, ws.baseCurrency, rateDate, rate);
        await upsertRate(database, { fromCurrency: needsRate, toCurrency: ws.baseCurrency, onDate: rateDate, rate, source: 'manual', sourceDate: rateDate });
      }
      const foreign = [...new Set(lines.map((l) => l.currency))].filter((c) => c !== ws.baseCurrency);
      const resolved = await resolveRates(foreign, draft.occurredOn);
      if (resolved.missing.length > 0) {
        setNeedsRate(resolved.missing[0]!);
        throw new Error(`No ${resolved.missing[0]}→${ws.baseCurrency} rate for ${rateDate}. Enter it below.`);
      }
      const input = { occurredOn: draft.occurredOn, description: draft.description || (draft.mode === 'transfer' ? 'Transfer' : ''), lines, ratesToBase: resolved.rates };
      if (initial) await replaceTransaction(database, ws, initial.id, input);
      else await postTransaction(database, ws, input);
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
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          {(['expense', 'income', 'transfer'] as const).map((m) => (
            <Button key={m} variant={draft.mode === m ? 'primary' : 'secondary'} aria-pressed={draft.mode === m} onClick={() => set({ mode: m, categoryId: '', splits: [] })}>
              {m === 'expense' ? 'Expense' : m === 'income' ? 'Income' : 'Transfer'}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} required />
          </Field>
          <Field label="Description">
            <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder={draft.mode === 'transfer' ? 'Transfer' : 'Superindo'} />
          </Field>
          <Field label={draft.mode === 'expense' ? 'Paid with' : draft.mode === 'income' ? 'Received into' : 'From'}>
            <Select value={draft.moneyId} onChange={(e) => set({ moneyId: e.target.value })}>
              <MoneyAccountOptions accounts={accounts} />
            </Select>
          </Field>
          {draft.mode === 'transfer' ? (
            <Field label="To" hint="Paying a credit card bill? Choose the card here.">
              <Select value={draft.toId} onChange={(e) => set({ toId: e.target.value })}>
                <MoneyAccountOptions accounts={accounts} />
              </Select>
            </Field>
          ) : (
            draft.splits.length === 0 && (
              <Field label="Category">
                <Select value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                  <CategoryOptions accounts={accounts} kind={draft.mode} parentSuffix="(general)" />
                </Select>
              </Field>
            )
          )}
          {draft.splits.length === 0 && (
            <Field label={`Amount (${currency})`}>
              <Input aria-label="Amount" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" required />
            </Field>
          )}
          {crossCurrency && (
            <Field label={`Received amount (${toAccount!.currency})`}>
              <Input value={draft.toAmount} onChange={(e) => set({ toAmount: e.target.value })} inputMode="decimal" required />
            </Field>
          )}
        </div>

        {draft.mode === 'expense' && (
          <div className="space-y-2">
            {draft.splits.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
                <Select aria-label={`Split ${i + 1} category`} value={row.categoryId} onChange={(e) => set({ splits: draft.splits.map((r, j) => (j === i ? { ...r, categoryId: e.target.value } : r)) })}>
                  <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
                </Select>
                <Input aria-label={`Split ${i + 1} amount`} value={row.amount} inputMode="decimal" onChange={(e) => set({ splits: draft.splits.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) })} />
                <Button variant="ghost" onClick={() => set({ splits: draft.splits.filter((_, j) => j !== i) })} aria-label={`Remove split ${i + 1}`}>
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() =>
                  set({
                    splits: draft.splits.length
                      ? [...draft.splits, { categoryId: '', amount: '' }]
                      : [{ categoryId: draft.categoryId, amount: draft.amount }, { categoryId: '', amount: '' }],
                  })
                }
              >
                Split
              </Button>
              {draft.splits.length > 0 && (
                <span className="tabular text-sm text-slate-600">
                  Total {minorToMajorString(splitTotal, currency)} {currency}
                </span>
              )}
            </div>
          </div>
        )}

        {needsRate && (
          <Field label={`Rate: ${ws.baseCurrency} per 1 ${needsRate}`} hint={ratePreview(manualRate, needsRate, ws.baseCurrency) ?? 'Type the rate your bank used.'}>
            <Input value={manualRate} onChange={(e) => setManualRate(e.target.value)} inputMode="decimal" />
          </Field>
        )}
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
