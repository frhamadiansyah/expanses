import { isoDate, parseMajor } from '@expanses/core';
import { postTransaction } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Input, Money } from '../../ui';
import { useDueBills } from './queries';

/**
 * Bills this month whose day has gone by with nothing recorded.
 *
 * A bill with a fixed amount is one click. One that differs every month asks for the figure first,
 * because electricity is never the same twice and a remembered amount would be a guess.
 */
export function BillsDue() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const due = useDueBills();
  const accounts = useAccounts();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState('');

  const bills = due.data ?? [];
  if (bills.length === 0) return null;

  const accountOf = (id: string) => (accounts.data ?? []).find((account) => account.id === id);

  async function record(bill: (typeof bills)[number]) {
    setError(null);
    setBusy(bill.id);
    try {
      const wallet = accountOf(bill.moneyAccountId);
      const currency = wallet?.currency ?? ws.baseCurrency;
      const typed = amounts[bill.id]?.trim();
      const amountMinor = bill.amountMinor ?? (typed ? parseMajor(typed, currency) : 0);
      if (!(amountMinor > 0)) throw new Error(`Enter what ${bill.name} came to this month`);

      await postTransaction(database, ws, {
        occurredOn: isoDate(),
        description: bill.name,
        templateId: bill.id,
        lines: [
          { accountId: bill.categoryAccountId, amountMinor, currency },
          { accountId: bill.moneyAccountId, amountMinor: -amountMinor, currency },
        ],
      });
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  }

  return (
    <Card className="space-y-2">
      <div data-testid="bills-due" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Bills due</h2>
        <span className="text-xs text-slate-500">Their day has passed and nothing is recorded yet</span>
      </div>

      <ErrorBox error={error ?? due.error} />

      {bills.map((bill) => (
        <div key={bill.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            <span className="font-medium">{bill.name}</span>{' '}
            <span className="text-xs text-slate-500">
              due on the {bill.dayOfMonth} · {accountOf(bill.moneyAccountId)?.name ?? 'your account'}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {bill.amountMinor === null ? (
              <Input
                aria-label={`Amount for ${bill.name}`}
                value={amounts[bill.id] ?? ''}
                onChange={(e) => setAmounts((current) => ({ ...current, [bill.id]: e.target.value }))}
                inputMode="decimal"
                placeholder="what it came to"
                className="w-36"
              />
            ) : (
              <Money minor={bill.amountMinor} currency={accountOf(bill.moneyAccountId)?.currency ?? ws.baseCurrency} />
            )}
            <Button variant="secondary" disabled={busy === bill.id} onClick={() => void record(bill)}>
              Record it
            </Button>
          </span>
        </div>
      ))}

        <p className="text-xs text-slate-500">Recording one here marks this month settled. Next month it comes round again.</p>
      </div>
    </Card>
  );
}
