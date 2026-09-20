import { parseUnits } from '@expanses/core';
import { convertToPurchase, type TransactionView } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';

/**
 * Turns an expense already recorded into the purchase it really was, keeping its date and amount.
 *
 * A file of its own because three screens open it: the list, the receipt, and the phone's edit sheet behind ⋯.
 * One form, three ways in — a second copy of it would be three places for "what it bought" to drift apart. It
 * left `TransactionsPage` when the edit sheet arrived: the sheet is opened *by* that page, so a form living
 * there and imported back out of it would have made the two modules import each other.
 */
export function ConvertForm({
  tx,
  holdings,
  goals,
  onDone,
}: {
  tx: TransactionView;
  holdings: { accountId: string; name: string }[];
  goals: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [accountId, setAccountId] = useState(holdings[0]?.accountId ?? '');
  const [units, setUnits] = useState('');
  const [goalId, setGoalId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await convertToPurchase(database, ws, { transactionId: tx.id, accountId, unitsMicro: parseUnits(units), goalId: goalId || null });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">This was a purchase</h3>
      <p className="text-xs text-slate-500">
        The amount, the date and the account that paid stay as they are. It stops counting as spending and starts counting as a holding.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="What it bought">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {holdings.map((holding) => (
              <option key={holding.accountId} value={holding.accountId}>
                {holding.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Units, shares or grams">
          <Input value={units} inputMode="decimal" onChange={(e) => setUnits(e.target.value)} placeholder="2" />
        </Field>
        {goals.length > 0 && (
          <Field label="For goal">
            <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">No goal</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || !accountId}>
          Save as a purchase
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
