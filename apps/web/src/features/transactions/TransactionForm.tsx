import { CURRENCIES, isoDate, mccName, minorToMajorString, parseMajor, parseRate, resolveMcc } from '@expanses/core';
import { type AccountRow, mccSourcesFor, postTransaction, replaceTransaction, saveMerchantMcc, type TransactionView, upsertRate } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { CategoryOptions } from '../cards/options';
import { MccPicker } from '../merchants/MccPicker';
import { suggestPattern } from '../merchants/mcc-search';
import { type Draft, draftFromTransaction, draftToExtras, draftToLines, draftToMemory, emptyDraft } from './draft';

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
  const [showCardDetails, setShowCardDetails] = useState(() => !!initial?.originalCurrency || !!initial?.mcc);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const moneyAccount = byId.get(draft.moneyId);
  const toAccount = byId.get(draft.toId);
  const currency = moneyAccount?.currency ?? ws.baseCurrency;
  const crossCurrency = draft.mode === 'transfer' && !!moneyAccount && !!toAccount && moneyAccount.currency !== toAccount.currency;
  const onCard = draft.mode === 'expense' && moneyAccount?.subtype === 'credit_card';
  const mccSources = useQuery({ queryKey: ['mcc-sources', ws.workspaceId], queryFn: () => mccSourcesFor(database.db, ws), enabled: onCard });
  const guessCategory = draft.splits[0]?.categoryId || draft.categoryId;
  const guess = mccSources.data && guessCategory ? resolveMcc(draft.description, guessCategory, { typed: null, ...mccSources.data }) : null;
  const guessName = guess?.mcc ? mccName(guess.mcc) : null;
  const guessFrom =
    guess?.source === 'memory' ? 'you taught this merchant' : guess?.source === 'bundled' ? 'typical for this merchant' : `from ${byId.get(guessCategory)?.name ?? 'the category'}`;
  const guessHint = guess?.mcc ? `Empty uses ${guess.mcc}${guessName ? ` ${guessName}` : ''} (${guessFrom}).` : 'Empty: no MCC is known for this merchant or category yet.';
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
      const extras = draftToExtras(draft, accounts);
      const memory = draftToMemory(draft, accounts);
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
      const input = { occurredOn: draft.occurredOn, description: draft.description || (draft.mode === 'transfer' ? 'Transfer' : ''), lines, ratesToBase: resolved.rates, ...extras };
      if (initial) await replaceTransaction(database, ws, initial.id, input);
      else await postTransaction(database, ws, input);
      if (memory) await saveMerchantMcc(database, ws, memory);
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

        {onCard && (
          <details open={showCardDetails} onToggle={(e) => setShowCardDetails(e.currentTarget.open)} className="rounded-lg border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-sm text-slate-600">Card purchase details</summary>
            {showCardDetails && (
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <Field label="Original currency" hint="The currency the merchant charged. Some cards earn more in certain currencies.">
                  <Select value={draft.originalCurrency} onChange={(e) => set({ originalCurrency: e.target.value })}>
                    <option value="">None</option>
                    {CURRENCIES.filter((c) => c.code !== currency).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Original amount${draft.originalCurrency ? ` (${draft.originalCurrency})` : ''}`}>
                  <Input value={draft.originalAmount} onChange={(e) => set({ originalAmount: e.target.value })} inputMode="decimal" />
                </Field>
                <MccPicker label="MCC" value={draft.mcc} onChange={(mcc) => set({ mcc })} hint={guessHint} />
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!draft.rememberPattern}
                      onChange={(e) => set({ rememberPattern: e.target.checked ? suggestPattern(draft.description) || draft.description.trim().toLowerCase() : '' })}
                    />
                    Remember this MCC for every purchase containing the merchant text
                  </label>
                  {draft.rememberPattern && (
                    <Field label="Merchant text" hint="Matched as whole words in descriptions, on every card, including past purchases.">
                      <Input value={draft.rememberPattern} onChange={(e) => set({ rememberPattern: e.target.value })} />
                    </Field>
                  )}
                </div>
              </div>
            )}
          </details>
        )}

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
