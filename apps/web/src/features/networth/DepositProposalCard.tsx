import { formatMinor, isoDate, parseRate, TERM_MONTHS, type TermMonths } from '@expanses/core';
import { confirmDepositEvent, type DepositProposal, upsertRate } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { closing, draftFrom, interestLine, landsText, newRateText, outcomeLine, proposalHeader, readDraft, rolling } from './deposit-proposal';
import { termLabel } from './maturity-settings';
import { useDueDeposits } from './queries';

/** P1: the one due event of this deposit, on its own page and nowhere else. */
export function DepositProposalCard({ accountId, onClosed }: { accountId: string; onClosed: (archived: boolean) => void }) {
  const due = useDueDeposits();
  const proposal = (due.data ?? []).find((p) => p.accountId === accountId);
  if (!proposal) return null;
  // Keyed on the event, so the next one in the queue starts from its own figures.
  return <ProposalBody key={`${proposal.event.kind}:${proposal.event.dueOn}`} proposal={proposal} onClosed={onClosed} />;
}

function ProposalBody({ proposal: p, onClosed }: { proposal: DepositProposal; onClosed: (archived: boolean) => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(p));
  const [manualRate, setManualRate] = useState('');
  const [askRate, setAskRate] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const today = isoDate();
  const payoutName = (accounts.data ?? []).find((a) => a.id === p.settings.payoutAccountId)?.name ?? null;
  const foreign = p.currency !== ws.baseCurrency;

  /** Confirm posts; "Recorded it myself" (byHand) posts nothing and needs no rate to base. */
  async function settle(byHand: boolean) {
    setError(null);
    setBusy(true);
    try {
      const figures = readDraft(p, draft);
      let rateToBase: number | undefined;
      if (foreign && !byHand) {
        if (manualRate.trim()) {
          rateToBase = parseRate(manualRate);
          await checkManualRate(database, p.currency, ws.baseCurrency, p.event.dueOn, rateToBase);
          await upsertRate(database, { fromCurrency: p.currency, toCurrency: ws.baseCurrency, onDate: p.event.dueOn, rate: rateToBase, source: 'manual', sourceDate: p.event.dueOn });
        } else {
          rateToBase = (await resolveRates([p.currency], p.event.dueOn)).rates[p.currency];
          if (rateToBase === undefined) {
            setAskRate(true);
            throw new Error(`No ${p.currency}→${ws.baseCurrency} rate for ${p.event.dueOn}. Enter it below.`);
          }
        }
      }
      const result = await confirmDepositEvent(database, ws, {
        accountId: p.accountId,
        kind: p.event.kind,
        dueOn: p.event.dueOn,
        today,
        principalMinor: figures.principalMinor,
        grossMinor: figures.grossMinor,
        taxMinor: figures.taxMinor,
        newRateBps: figures.newRateBps,
        newTermMonths: figures.newTermMonths,
        rateToBase,
        byHand,
      });
      await invalidate();
      if (closing(p)) onClosed(result.archived);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const rows = editing
    ? [
        <TextRow key="gross" label="Interest before tax" inputMode="decimal" value={draft.gross} onChange={(e) => setDraft({ ...draft, gross: e.target.value })} />,
        ...(p.settings.taxExempt
          ? []
          : [<TextRow key="tax" label="Tax withheld" inputMode="decimal" value={draft.tax} onChange={(e) => setDraft({ ...draft, tax: e.target.value })} />]),
        <ReadOnlyRow key="lands" label="Lands" value={landsText(p, draft)} />,
        ...(closing(p)
          ? [<TextRow key="principal" label="Principal" inputMode="decimal" value={draft.principal} onChange={(e) => setDraft({ ...draft, principal: e.target.value })} />]
          : [<ReadOnlyRow key="principal" label="Principal" value={formatMinor(p.principalMinor, p.currency)} />]),
        ...(rolling(p)
          ? [
              <TextRow key="rate" label="New rate %" inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />,
              <SelectRow key="term" label="New term" value={String(draft.term)} onChange={(e) => setDraft({ ...draft, term: Number(e.target.value) as TermMonths })}>
                {TERM_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {termLabel(months)}
                  </option>
                ))}
              </SelectRow>,
            ]
          : []),
      ]
    : [
        <ReadOnlyRow key="principal" label="Principal" value={formatMinor(p.principalMinor, p.currency)} />,
        <ReadOnlyRow key="gross" label="Before tax" value={formatMinor(p.grossMinor, p.currency)} />,
        <ReadOnlyRow key="interest" label="Interest" value={interestLine(p)} />,
        <ReadOnlyRow key="outcome" label="Then" value={outcomeLine(p, payoutName)} />,
        ...(rolling(p) ? [<ReadOnlyRow key="rate" label="New rate" value={newRateText(draft.rate)} />] : []),
      ];
  if (foreign && askRate) {
    rows.push(
      <TextRow
        key="fx"
        label={`Rate: ${ws.baseCurrency} per 1 ${p.currency}`}
        hint={ratePreview(manualRate, p.currency, ws.baseCurrency) ?? undefined}
        inputMode="decimal"
        value={manualRate}
        onChange={(e) => setManualRate(e.target.value)}
      />,
    );
  }

  return (
    <div data-testid="deposit-proposal">
      <InsetGroup
        header={proposalHeader(p, today)}
        footer={`Worked out from the stored rate. Correct it to what the bank credited.${p.waiting > 0 ? ` ${p.waiting} more waiting after this one.` : ''}`}
      >
        {rows}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup footer="Recorded it myself marks this done and posts nothing: use it when it is already in your transactions.">
        {[
          <InsetRow key="edit" title={editing ? 'Done editing' : 'Edit figures'} chevron={false} onClick={() => setEditing((open) => !open)} />,
          <InsetRow key="byhand" title="Recorded it myself" chevron={false} disabled={busy} onClick={() => void settle(true)} />,
          <InsetRow key="confirm" title="Confirm" chevron={false} disabled={busy} onClick={() => void settle(false)} />,
        ]}
      </InsetGroup>
    </div>
  );
}
