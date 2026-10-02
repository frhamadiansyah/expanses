import { addMonths, monthName, monthYear, pausedMonths } from '@expanses/core';
import { type MonthlyBill, pauseBill } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow, SegmentedControl, SelectRow } from '../../ui/native';

const SPANS = [1, 2, 3, 6] as const;

const PAUSE_INFO = 'No bill comes out while paused; it adds nothing to Still to pay, Budget or Cashflow, and comes back by itself.';

/** "Oct 2026", or "Oct – Nov 2026", or "Dec 2026 – Jan 2027": the months a pause covers. */
export function pauseSpan(from: string, until: string): string {
  const months = pausedMonths(from, until);
  const first = months[0]!;
  const last = months[months.length - 1]!;
  if (first === last) return monthYear(first);
  return first.slice(0, 4) === last.slice(0, 4) ? `${monthName(first, 'short')} – ${monthYear(last)}` : `${monthYear(first)} – ${monthYear(last)}`;
}

/**
 * Pausing a bill: for a number of months, or until the month it comes back — one choice, two ways in. The pause starts
 * with the first month not already paid or skipped.
 */
export function PauseSheet({ bill, onClose, onPaused }: { bill: MonthlyBill; onClose: () => void; onPaused: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const from = bill.pauseFrom;
  const [until, setUntil] = useState(addMonths(from, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const span = SPANS.find((n) => addMonths(from, n) === until);
  const comebacks = Array.from({ length: 12 }, (_, i) => addMonths(from, i + 1));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await pauseBill(database, ws, bill.id, until);
      await invalidate();
      onPaused();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Pause" onClose={onClose} confirm={{ label: `Pause ${bill.name}`, disabled: busy, run: () => void save() }}>
      <ErrorBox error={error} />
      <div className="mb-[18px]">
        <SegmentedControl
          label="For"
          segments={SPANS.map((n) => ({ key: String(n), label: n === 1 ? '1 month' : `${n} months` }))}
          value={span === undefined ? '' : String(span)}
          onChange={(key) => setUntil(addMonths(from, Number(key)))}
        />
      </div>
      <InsetGroup>
        <SelectRow label="Until" id="pause-until" info={PAUSE_INFO} value={until} onChange={(e) => setUntil(e.target.value)}>
          {comebacks.map((month) => (
            <option key={month} value={month}>
              {`${monthName(month, 'long')} ${month.slice(0, 4)}`}
            </option>
          ))}
        </SelectRow>
        <ReadOnlyRow label="Paused" value={pauseSpan(from, until)} />
      </InsetGroup>
    </Sheet>
  );
}
