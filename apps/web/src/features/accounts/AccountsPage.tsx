import { CURRENCIES, displayAmount, isoDate, parseMajor, parseRate } from '@expanses/core';
import { type AccountRow, type AccountSubtype, archiveAccount, createAccount, renameAccount, upsertRate } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, SUBTYPE_LABELS, useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { useAssetValues } from '../networth/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { Button, Card, Empty, ErrorBox, errorMessage, Field, Input, Money, PageHeader, Select } from '../../ui';

const TYPES: { subtype: AccountSubtype; kind: 'asset' | 'liability' }[] = [
  { subtype: 'bank', kind: 'asset' },
  { subtype: 'cash', kind: 'asset' },
  { subtype: 'savings', kind: 'asset' },
  { subtype: 'credit_card', kind: 'liability' },
  { subtype: 'investment', kind: 'asset' },
  { subtype: 'property', kind: 'asset' },
  { subtype: 'vehicle', kind: 'asset' },
  { subtype: 'receivable', kind: 'asset' },
  { subtype: 'loan', kind: 'liability' },
  { subtype: 'payable', kind: 'liability' },
];

function AddAccountForm() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState<AccountSubtype>('bank');
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [balance, setBalance] = useState('');
  const [openedOn, setOpenedOn] = useState(isoDate());
  const [manualRate, setManualRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const kind = TYPES.find((t) => t.subtype === subtype)!.kind;
  const foreign = currency !== ws.baseCurrency;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const openingBalanceMinor = balance.trim() ? parseMajor(balance, currency) : 0;
      let openingRateToBase: number | undefined;
      if (foreign && openingBalanceMinor !== 0) {
        if (manualRate.trim()) {
          openingRateToBase = parseRate(manualRate);
          await checkManualRate(database, currency, ws.baseCurrency, openedOn, openingRateToBase);
          await upsertRate(database, { fromCurrency: currency, toCurrency: ws.baseCurrency, onDate: openedOn, rate: openingRateToBase, source: 'manual', sourceDate: openedOn });
        } else {
          const resolved = await resolveRates([currency], openedOn);
          openingRateToBase = resolved.rates[currency];
          if (openingRateToBase === undefined) throw new Error(`No ${currency}→${ws.baseCurrency} rate available. Enter it manually.`);
        }
      }
      await createAccount(database, ws, { name, kind, subtype, currency, openingBalanceMinor, openedOn, openingRateToBase });
      setName('');
      setBalance('');
      setManualRate('');
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="BCA Visa Platinum" required />
        </Field>
        <Field label="Type">
          <Select value={subtype} onChange={(e) => setSubtype(e.target.value as AccountSubtype)}>
            {TYPES.map((t) => (
              <option key={t.subtype} value={t.subtype}>
                {SUBTYPE_LABELS[t.subtype]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={kind === 'liability' ? 'Amount owed now' : 'Current balance'} hint="Optional. Posted as an opening balance.">
          <Input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Balance as of">
          <Input type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        </Field>
        {foreign && (
          <Field label={`Rate: ${ws.baseCurrency} per 1 ${currency}`} hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? 'Leave empty to fetch the daily rate.'}>
            <Input value={manualRate} onChange={(e) => setManualRate(e.target.value)} inputMode="decimal" />
          </Field>
        )}
        <div className="flex items-end md:col-span-2">
          <Button type="submit" disabled={busy}>
            Add account
          </Button>
        </div>
        <div className="md:col-span-2">
          <ErrorBox error={error} />
        </div>
      </form>
    </Card>
  );
}

function AccountList({ title, accounts, balances }: { title: string; accounts: AccountRow[]; balances: Record<string, number> }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const values = useAssetValues();
  const valued = (id: string) => (values.data ?? []).find((row) => row.accountId === id && row.mode !== 'derived');
  if (accounts.length === 0) return null;

  async function rename(account: AccountRow) {
    const next = window.prompt('Rename account', account.name);
    if (next && next.trim() !== account.name) {
      await renameAccount(database, ws, account.id, next);
      await invalidate();
    }
  }
  async function archive(account: AccountRow) {
    if (window.confirm(`Archive ${account.name}? Its history stays in reports.`)) {
      try {
        await archiveAccount(database, ws, account.id);
        await invalidate();
      } catch (e) {
        window.alert(errorMessage(e));
      }
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-slate-600">{title}</h2>
      <ul className="divide-y divide-slate-100">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <Link to="/transactions" search={{ account: account.id }} className="font-medium hover:underline">
                {account.name}
              </Link>
              <div className="text-xs text-slate-500">
                {SUBTYPE_LABELS[account.subtype]} · {account.currency}
              </div>
            </div>
            {account.subtype === 'credit_card' && (
              <Link to="/cards/$cardId" params={{ cardId: account.id }} className="text-sm font-medium text-emerald-700 underline">
                Set up points
              </Link>
            )}
            {valued(account.id) ? (
              <Link to="/net-worth/assets/$accountId" params={{ accountId: account.id }} className="text-right">
                <Money minor={valued(account.id)!.valueMinor} currency={account.currency!} className="block font-medium" />
                <span className="text-xs text-slate-500">
                  cost <Money minor={valued(account.id)!.costMinor} currency={account.currency!} />
                </span>
              </Link>
            ) : (
              <Money minor={displayAmount(account.kind, balances[account.id] ?? 0)} currency={account.currency!} className="font-medium" />
            )}
            <Button variant="ghost" onClick={() => void rename(account)} aria-label={`Rename ${account.name}`}>
              Rename
            </Button>
            <Button variant="ghost" onClick={() => void archive(account)} aria-label={`Archive ${account.name}`}>
              Archive
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AccountsPage() {
  const accounts = useAccounts();
  const balances = useBalances();
  const money = (accounts.data ?? []).filter(isMoneyAccount);
  const all = balances.data ?? {};
  return (
    <div className="space-y-4">
      <PageHeader
        title="Accounts"
        action={
          <div className="flex gap-3 text-sm">
            <Link to="/import" className="underline">
              Import CSV
            </Link>
            <Link to="/backup" className="underline">
              Backup
            </Link>
          </div>
        }
      />
      <AddAccountForm />
      {accounts.isSuccess && money.length === 0 && <Empty>No accounts yet. Add a bank account or credit card above.</Empty>}
      <AccountList title="Money" accounts={money.filter((a) => a.kind === 'asset')} balances={all} />
      <AccountList title="Credit cards & debts" accounts={money.filter((a) => a.kind === 'liability')} balances={all} />
    </div>
  );
}
