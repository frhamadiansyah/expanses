import { formatMinor, isoDate, parseMajor, sinkingExtraPreview, sinkingHistory } from '@expanses/core';
import { fundRoom, fundShortMessage, putInSinkingExtra, type SinkingFundView, sinkingFactsOf } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, ProgressBar, ReadOnlyRow, SwitchRow, TextRow } from '../../ui/native';

/**
 * A yearly bill's sinking fund on its page: what is saved, the monthly figure, where it is set aside, the history of
 * every month and every amount put in, and a way to put in more.
 */
export function SinkingFundGroup({ fund }: { fund: SinkingFundView }) {
  const [adding, setAdding] = useState(false);
  const { currency } = fund;
  const entries = sinkingHistory(sinkingFactsOf(fund), fund.targetMinor, fund.dueMonth, isoDate()).length;
  return (
    <>
      <InsetGroup header="Sinking fund">
        <InsetRow
          testId="sinking-saved"
          title="Saved"
          subtitle={
            <>
              <ProgressBar currentMinor={fund.savedMinor} targetMinor={fund.targetMinor} label="Saved so far" className="mt-[6px] mb-[6px]" />
              <span className="tabular">
                <Money minor={fund.savedMinor} currency={currency} tone="none" /> of <Money minor={fund.targetMinor} currency={currency} tone="none" /> · {fund.monthsDone} of{' '}
                {fund.monthsTotal} months
              </span>
            </>
          }
          chevron={false}
        />
        <ReadOnlyRow label="Each month" value={formatMinor(fund.monthlyMinor, currency)} testId="sinking-monthly" />
        <ReadOnlyRow label="Set aside in" value={fund.accountName} />
        <InsetRow testId="sinking-history" title="History" value={`${entries} ${entries === 1 ? 'entry' : 'entries'}`} to="/bills/$billId/fund-history" params={{ billId: fund.billId }} />
        <InsetRow action title={<span className="text-[var(--ph-ink)]">Put in extra</span>} label="Put in extra" onClick={() => setAdding(true)} />
      </InsetGroup>
      {adding && <PutInExtraSheet fund={fund} onClose={() => setAdding(false)} />}
    </>
  );
}

function PutInExtraSheet({ fund, onClose }: { fund: SinkingFundView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const room = useQuery({ queryKey: ['fund-room', ws.workspaceId, fund.accountId, today, fund.savedMinor], queryFn: () => fundRoom(database, ws, fund.accountId, today) });

  const minor = (() => {
    try {
      return amount.trim() ? parseMajor(amount.trim(), fund.currency) : 0;
    } catch {
      return 0;
    }
  })();
  const after = sinkingExtraPreview(sinkingFactsOf(fund), fund.targetMinor, fund.dueMonth, today, fund.currency, minor, keep);
  const short = room.data && minor > 0 && after.promisedMinor > room.data.freeMinor ? fundShortMessage(room.data, after.promisedMinor) : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!(minor > 0)) throw new Error('Enter the amount to put in');
      await putInSinkingExtra(database, ws, fund.billId, { amountMinor: minor, date, keepMonthly: keep });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Put in extra" onClose={onClose}>
      <form ref={form} onSubmit={save}>
        <InsetGroup>
          <TextRow
            label={`Amount (${fund.currency})`}
            id="extra-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            autoFocus
          />
          <TextRow label="Date" id="extra-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </InsetGroup>
        <InsetGroup header="After this">
          <ReadOnlyRow label="Saved" value={formatMinor(after.savedMinor, fund.currency)} testId="extra-after-saved" />
          <InsetRow
            testId="extra-after-monthly"
            title="Each month"
            subtitle={`was ${formatMinor(after.wasMonthlyMinor, fund.currency)} · ${after.monthsLeft} ${after.monthsLeft === 1 ? 'month' : 'months'} left`}
            value={formatMinor(after.monthlyMinor, fund.currency)}
            valueTone="ink"
            chevron={false}
          />
        </InsetGroup>
        <InsetGroup>
          <SwitchRow label={`Keep each month at ${formatMinor(after.wasMonthlyMinor, fund.currency)}`} checked={keep} onChange={setKeep} />
        </InsetGroup>
        {short && (
          <p className="rounded-lg bg-[var(--ph-alarm-panel)] px-3 py-2 text-sm text-[var(--ph-alarm-ink)]" role="alert" data-testid="extra-short">
            {short}
          </p>
        )}
        <ErrorBox error={short ? null : error} />
        <button type="submit" hidden aria-hidden tabIndex={-1} disabled={busy} />
        <InsetGroup>
          <InsetRow action title="Put in" disabled={busy || Boolean(short)} onClick={() => form.current?.requestSubmit()} />
        </InsetGroup>
      </form>
    </Sheet>
  );
}
