import { formatMinor, isoDate, TERM_MONTHS, type TermMonths } from '@expanses/core';
import { saveDepositTerms, saveDepositTermMonths } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input } from '../../ui';
import { daysLeftLabel, maturityLabel, maturityProgress, rateBpsFrom, rateInputText, rateLabel } from './deposit-terms';
import { termLabel } from './maturity-settings';
import { useDepositAutomation, useDepositTerms } from './queries';
import { Panel, SelectRow } from '../../ui/native';

/**
 * A time deposit's own facts, on the account's own page: the day the money comes back, how far through its term it
 * is, and what the term pays.
 *
 * The maturity and the rate are asked for when the deposit is opened and were write-only until they were printed
 * here, which is no good for a date typed off a paper certificate — a mistyped year is invisible, and a rollover
 * changes both. So they are said back in the words a person would say them in, and corrected here too.
 *
 * The term sits here as well: it is the third thing the certificate says (how long the money is in), and it is what
 * the bar is drawn over. It is stored with the deposit's automation — the maturity schedule counts monthly payouts
 * off it — and saved on its own column, so a save here cannot put back an older payout choice and the settings
 * group's save cannot put back an older term.
 *
 * `balanceMinor` is what the term's interest is worked out on; a caller without one gets the card without the
 * estimate.
 */
export function DepositTermsCard({ accountId, balanceMinor, currency }: { accountId: string; balanceMinor?: number; currency?: string }) {
  const deposits = useDepositTerms();
  const automation = useDepositAutomation(accountId);
  const terms = (deposits.data ?? []).find((row) => row.accountId === accountId);
  const [editing, setEditing] = useState(false);

  // A deposit whose rate and date were never said is asked here, not left out: the same card, its form open.
  if (!terms) {
    return (
      <Panel header="Deposit terms" className="space-y-3">
        <p className="text-[15px] leading-[20px] text-[var(--ph-ink-3)]">Not set yet: say the day the money comes back and what it pays.</p>
        <TermRow accountId={accountId} />
        <DepositTermsForm accountId={accountId} maturesOn="" rateBps={0} onSaved={() => undefined} />
      </Panel>
    );
  }
  const progress = maturityProgress(
    terms,
    { termMonths: automation.data?.termMonths ?? 1, termStartedOn: automation.data?.termStartedOn ?? null },
    balanceMinor ?? 0,
    isoDate(),
  );
  const line = [
    daysLeftLabel(progress.daysLeft),
    terms.rateBps > 0 ? rateLabel(terms.rateBps) : null,
    currency && progress.interestMinor > 0 ? `pays ≈ ${formatMinor(progress.interestMinor, currency)}` : null,
  ].filter((part): part is string => part !== null);
  return (
    <Panel header="Deposit terms" footer="When it matures, take the money out with Withdraw." testId="deposit-maturity-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[17px] leading-[22px] font-semibold text-[var(--ph-ink)]">Matures {maturityLabel(terms.maturesOn)}</p>
        <Button variant="ghost" className="-my-2 -mr-2 text-[var(--ph-tint)]" onClick={() => setEditing((open) => !open)}>
          {editing ? 'Close' : 'Change'}
        </Button>
      </div>
      {/* The term from its first day to its last: how much of the wait is behind it. */}
      <div
        role="progressbar"
        aria-label="Through the term"
        aria-valuenow={Math.round(progress.fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-[10px] h-[4px] w-full overflow-hidden rounded-full bg-[var(--ph-track)]"
      >
        <div className="h-full rounded-full bg-[var(--ph-tint)]" style={{ width: `${progress.fraction * 100}%` }} />
      </div>
      <p className="tabular mt-[8px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{line.join(' · ')}</p>
      <div className="mt-3 space-y-3">
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
      </div>
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
