import { formatMinor, isoDate, TERM_MONTHS, type TermMonths } from '@expanses/core';
import { saveDepositTerms, saveDepositTermMonths } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { daysLeftLabel, maturityLabel, maturityProgress, rateBpsFrom, rateInputText, rateLabel } from './deposit-terms';
import { termLabel } from './maturity-settings';
import { useDepositAutomation, useDepositTerms } from './queries';
import { type GroupChild, InsetGroup, SelectRow, TextRow } from '../../ui/native';

/**
 * A time deposit's own facts, inside its balance card: the day the money comes back, how far through its term it is,
 * and what the term pays — with Change, which opens the date and the rate in a sheet.
 *
 * The maturity and the rate are asked for when the deposit is opened and were write-only until they were printed
 * here, which is no good for a date typed off a paper certificate — a mistyped year is invisible, and a rollover
 * changes both. So they are said back in the words a person would say them in, and corrected from here too.
 *
 * `balanceMinor` is what the term's interest is worked out on; a caller without one gets the block without the
 * estimate.
 */
export function DepositMaturityBlock({ accountId, balanceMinor, currency }: { accountId: string; balanceMinor?: number; currency?: string }) {
  const deposits = useDepositTerms();
  const automation = useDepositAutomation(accountId);
  const terms = (deposits.data ?? []).find((row) => row.accountId === accountId);
  const [editing, setEditing] = useState(false);
  const change = (
    <button type="button" onClick={() => setEditing(true)} className="ph-focus -my-1 rounded px-1 text-[15px] leading-[20px] text-[var(--ph-tint)]">
      Change
    </button>
  );
  const sheet = editing && (
    <DepositTermsSheet accountId={accountId} maturesOn={terms?.maturesOn ?? ''} rateBps={terms?.rateBps ?? 0} onClose={() => setEditing(false)} />
  );

  // A deposit whose rate and date were never said is asked here, not left out: the same block, saying so.
  if (!terms) {
    return (
      <div className="border-t-[1px] border-dashed border-[var(--ph-hair)] pt-3" data-testid="deposit-maturity-card">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] leading-[20px] text-[var(--ph-ink-3)]">Maturity not set yet</p>
          {change}
        </div>
        {sheet}
      </div>
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
    <div className="border-t-[1px] border-dashed border-[var(--ph-hair)] pt-3" data-testid="deposit-maturity-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[17px] leading-[22px] font-semibold text-[var(--ph-ink)]">Matures {maturityLabel(terms.maturesOn)}</p>
        {change}
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
      {sheet}
    </div>
  );
}

/**
 * The length of a term, as a row of the deposit's Details: the platform's own picker, saved as it is picked, on its own
 * column so nothing else a deposit's settings do can put it back. It is the third thing the certificate says (how long
 * the money is in), and what the maturity bar is drawn over; it is stored with the deposit's automation, since the
 * maturity schedule counts monthly payouts off it.
 */
export function DepositTermRow({ accountId, position }: GroupChild & { accountId: string }) {
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
        position={position}
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

/** The date the money comes back and the rate it earns, as the certificate says them; ✓ saves both. */
function DepositTermsSheet({
  accountId,
  maturesOn: current,
  rateBps,
  onClose,
}: {
  accountId: string;
  maturesOn: string;
  rateBps: number;
  onClose: () => void;
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
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Deposit terms" onClose={onClose} confirm={{ label: 'Save terms', disabled: busy, run: () => void save() }}>
      <InsetGroup>
        <TextRow label="Matures on" type="date" value={maturesOn} onChange={(e) => setMaturesOn(e.target.value)} />
        <TextRow
          label="Interest rate"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          placeholder="% a year"
        />
      </InsetGroup>
      <ErrorBox error={error} />
    </Sheet>
  );
}
