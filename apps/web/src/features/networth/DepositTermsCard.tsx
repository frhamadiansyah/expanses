import { parseRate } from '@expanses/core';
import { saveDepositTerms } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input } from '../../ui';
import { depositLine } from './deposit-terms';
import { useDepositTerms } from './queries';

/**
 * A time deposit's own two facts, on the account's own page: the day the money comes back and what it pays.
 *
 * Both are asked for when the deposit is opened and both were write-only until now, which is no good for a
 * date typed off a paper certificate — a mistyped year is invisible, and a rollover changes both. So they are
 * printed here in the words a person would say them in, and corrected here too.
 *
 * Nothing is automated off the maturity: the money leaves a deposit by a transfer, the way it arrived.
 */
export function DepositTermsCard({ accountId }: { accountId: string }) {
  const deposits = useDepositTerms();
  const terms = (deposits.data ?? []).find((row) => row.accountId === accountId);
  const [editing, setEditing] = useState(false);

  if (!terms) return null;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Deposit terms</h2>
          <p className="text-sm text-slate-600">{depositLine(terms)}</p>
        </div>
        <Button variant="ghost" onClick={() => setEditing((open) => !open)}>
          {editing ? 'Close' : 'Change'}
        </Button>
      </div>
      {editing && (
        <DepositTermsForm
          // A fresh form whenever the saved terms change, so the boxes never hold what was already put right.
          key={`${terms.maturesOn}·${terms.rateBps}`}
          accountId={accountId}
          maturesOn={terms.maturesOn}
          rateBps={terms.rateBps}
          onSaved={() => setEditing(false)}
        />
      )}
      <p className="text-xs text-slate-500">When it matures, move the money to an account with a transfer.</p>
    </Card>
  );
}

function DepositTermsForm({
  accountId,
  maturesOn: current,
  rateBps,
  onSaved,
}: {
  accountId: string;
  maturesOn: string;
  rateBps: number;
  onSaved: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [maturesOn, setMaturesOn] = useState(current);
  // Basis points back into the percent the form asks for, with the comma its placeholder shows.
  const [rate, setRate] = useState(rateBps === 0 ? '' : String(rateBps / 100).replace('.', ','));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (!maturesOn.trim()) throw new Error('Say the day the money comes back');
      await saveDepositTerms(database, ws, { accountId, maturesOn, rateBps: rate.trim() ? Math.round(parseRate(rate) * 100) : 0 });
      await invalidate();
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Matures on" hint="The day the money comes back.">
          <Input type="date" value={maturesOn} onChange={(e) => setMaturesOn(e.target.value)} />
        </Field>
        <Field label="Interest rate" hint="Per year, as the certificate says it.">
          <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="6,25" />
        </Field>
      </div>
      <ErrorBox error={error} />
      <Button onClick={save} disabled={busy}>
        Save terms
      </Button>
    </div>
  );
}
