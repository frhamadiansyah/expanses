import { TERM_MONTHS, type TermMonths } from '@expanses/core';
import { saveDepositTerms, saveDepositTermMonths } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input } from '../../ui';
import { depositLine, rateBpsFrom, rateInputText } from './deposit-terms';
import { termLabel } from './maturity-settings';
import { useDepositAutomation, useDepositTerms } from './queries';
import { Panel, SelectRow } from '../../ui/native';

/**
 * A time deposit's own two facts, on the account's own page: the day the money comes back and what it pays.
 *
 * Both are asked for when the deposit is opened and both were write-only until now, which is no good for a
 * date typed off a paper certificate — a mistyped year is invisible, and a rollover changes both. So they are
 * printed here in the words a person would say them in, and corrected here too.
 *
 * Nothing is automated off the maturity: the money leaves a deposit by a transfer, the way it arrived.
 *
 * The term sits here too: it is the third thing the certificate says (how long the money is in), read off the same
 * line as the rate and the date, so it is corrected in the same place. It is stored with the deposit's automation —
 * the maturity schedule counts monthly payouts off it — and it is saved on its own column, so a save here cannot put
 * back an older payout choice and the settings group's save cannot put back an older term.
 */
export function DepositTermsCard({ accountId }: { accountId: string }) {
  const deposits = useDepositTerms();
  const terms = (deposits.data ?? []).find((row) => row.accountId === accountId);
  const [editing, setEditing] = useState(false);

  // A deposit whose rate and date were never said is asked here, not left out: the same card, its form open.
  if (!terms) {
    return (
      <Panel className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Deposit terms</h2>
          <p className="text-sm text-slate-600">Not set yet: say the day the money comes back and what it pays.</p>
        </div>
        <TermRow accountId={accountId} />
        <DepositTermsForm accountId={accountId} maturesOn="" rateBps={0} onSaved={() => undefined} />
      </Panel>
    );
  }
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Deposit terms</h2>
          <p className="text-sm text-slate-600">{depositLine(terms)}</p>
        </div>
        <Button variant="ghost" onClick={() => setEditing((open) => !open)}>
          {editing ? 'Close' : 'Change'}
        </Button>
      </div>
      <TermRow accountId={accountId} />
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
    </Panel>
  );
}

/** The length of a term, saved on its own column so nothing else a deposit's settings do can put it back. */
function TermRow({ accountId }: { accountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const automation = useDepositAutomation(accountId);
  const [error, setError] = useState<unknown>(null);
  // Says when the write has landed, so a reload or a clock jump cannot overtake it.
  const [saving, setSaving] = useState(false);
  return (
    <div data-testid="deposit-term" aria-busy={saving}>
      <SelectRow
        label="Term"
        value={String(automation.data?.termMonths ?? 1)}
        onChange={(e) => {
          const termMonths = Number(e.target.value) as TermMonths;
          setError(null);
          setSaving(true);
          void (async () => {
            try {
              await saveDepositTermMonths(database, ws, accountId, termMonths);
              await invalidate();
            } catch (e) {
              setError(e);
            } finally {
              setSaving(false);
            }
          })();
        }}
      >
        {TERM_MONTHS.map((months) => (
          <option key={months} value={months}>
            {termLabel(months)}
          </option>
        ))}
      </SelectRow>
      <ErrorBox error={error} />
    </div>
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
  const [rate, setRate] = useState(rateInputText(rateBps));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (!maturesOn.trim()) throw new Error('Say the day the money comes back');
      await saveDepositTerms(database, ws, { accountId, maturesOn, rateBps: rate.trim() ? rateBpsFrom(rate) : 0 });
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
