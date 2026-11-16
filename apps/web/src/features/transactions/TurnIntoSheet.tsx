import { formatMinor } from '@expanses/core';
import { saveInstallment } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, ROW_PAD_X, SegmentedControl, TextRow } from '../../ui/native';
import { useStatementDay } from '../loans/queries';
import { blankTurnForm, eachMonthOf, MONTH_CHOICES, type TurnForm, turnFooter, turnIntoInput, turnMonths } from './turn-into';

const SEGMENTS = [...MONTH_CHOICES.map((n) => ({ key: String(n), label: String(n) })), { key: 'other', label: 'Other' }];
const shortDate = (iso: string) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
};

/**
 * Turn into instalments (owner, 16 Nov 2026, option A): from the purchase itself, only what the bank decided — the months,
 * the month it is first billed, the interest. Everything else is the purchase's, and the plan always counts Each month,
 * tied to it; the plan's own page keeps the Count spending switch. Saved through the plans' own door, so a purchase in a
 * shared workspace goes out with its spread.
 */
export function TurnIntoSheet({
  purchase,
  card,
  currency,
  onClose,
}: {
  purchase: { transactionId: string; description: string; occurredOn: string; amountMinor: number };
  card: { accountId: string; name: string };
  currency: string;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const formEl = useRef<HTMLFormElement>(null);
  const statementDay = useStatementDay(card.accountId).data ?? 1;
  const [form, setForm] = useState<TurnForm | null>(null);
  const shown = form ?? blankTurnForm(purchase.occurredOn, statementDay);
  const patch = (change: Partial<TurnForm>) => setForm({ ...shown, ...change });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const months = turnMonths(shown);
  const input = turnIntoInput(purchase, card.accountId, shown);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!input) return;
    setError(null);
    setBusy(true);
    try {
      await saveInstallment(database, ws, input);
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Turn into instalments" onClose={onClose}>
      <form ref={formEl} onSubmit={save} data-testid="turn-into-sheet">
        <InsetGroup>
          <InsetRow title={purchase.description} subtitle={`${card.name} · ${shortDate(purchase.occurredOn)}`} value={formatMinor(purchase.amountMinor, currency)} valueTone="ink" chevron={false} />
        </InsetGroup>
        <InsetGroup header="Months" footer={turnFooter(purchase.amountMinor, months, shown.firstBilledMonth, statementDay, currency)}>
          <div className="relative" style={{ padding: `8px ${ROW_PAD_X}px` }}>
            <SegmentedControl
              segments={SEGMENTS}
              value={String(shown.months)}
              onChange={(key) => patch({ months: key === 'other' ? 'other' : Number(key) })}
              label="Months"
              className="w-full"
            />
          </div>
          {shown.months === 'other' && <TextRow label="How many" value={shown.other} inputMode="numeric" onChange={(e) => patch({ other: e.target.value })} placeholder="Months" />}
          <ReadOnlyRow label="Each month" value={months ? formatMinor(eachMonthOf(purchase.amountMinor, months), currency) : '—'} />
          <TextRow label="First billed" type="month" value={shown.firstBilledMonth} onChange={(e) => patch({ firstBilledMonth: e.target.value })} />
          <TextRow label="Interest" suffix="%" value={shown.interest} inputMode="decimal" onChange={(e) => patch({ interest: e.target.value })} />
        </InsetGroup>
        <ErrorBox error={error} />
        <input type="submit" hidden disabled={busy || !input} />
        <InsetGroup>
          <InsetRow action title="Save" disabled={busy || !input} onClick={() => formEl.current?.requestSubmit()} testId="turn-into-save" />
        </InsetGroup>
      </form>
    </Sheet>
  );
}
