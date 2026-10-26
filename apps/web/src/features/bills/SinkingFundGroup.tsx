import { parseMajor } from '@expanses/core';
import { addSinkingExtra, type SinkingFundView } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, ProgressBar, ReadOnlyRow, TextRow } from '../../ui/native';

/** A yearly bill's sinking fund on its page: what is saved, this month's share, and a way to put in more. */
export function SinkingFundGroup({ fund }: { fund: SinkingFundView }) {
  const [adding, setAdding] = useState(false);
  const { currency } = fund;
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
        <InsetRow
          testId="sinking-month"
          title="This month"
          subtitle={
            <>
              Set aside <Money minor={fund.monthlyMinor} currency={currency} tone="none" />
            </>
          }
          value="Done ✓"
          valueTone="ink"
          chevron={false}
        />
        <ReadOnlyRow label="Set aside in" value={fund.accountName} />
        <InsetRow action title={<span className="text-[var(--ph-ink)]">Put in extra</span>} label="Put in extra" onClick={() => setAdding(true)} />
      </InsetGroup>
      {adding && <PutInExtraSheet fund={fund} onClose={() => setAdding(false)} />}
    </>
  );
}

function PutInExtraSheet({ fund, onClose }: { fund: SinkingFundView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const minor = parseMajor(amount.trim(), fund.currency);
      if (!(minor > 0)) throw new Error('Enter the amount to put in');
      await addSinkingExtra(database.db, ws, fund.billId, minor);
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
        </InsetGroup>
        <ErrorBox error={error} />
        <button type="submit" hidden aria-hidden tabIndex={-1} disabled={busy} />
        <InsetGroup>
          <InsetRow action title="Save" disabled={busy} onClick={() => form.current?.requestSubmit()} />
        </InsetGroup>
      </form>
    </Sheet>
  );
}
