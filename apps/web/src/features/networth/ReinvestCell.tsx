import { minorToMajorString, parseMajor } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { Button, Input, Select } from '../../ui';

/**
 * Declares that part of a dividend went back in, which is what puts it outside the objects of tax.
 *
 * A declaration, not a trail: the payment lands in a broker account and mixes with everything else
 * there, so nothing can say which rupiah bought the instrument. The Laporan Realisasi Investasi asks
 * how much went where, and this records exactly that.
 */
export function ReinvestCell({
  trade,
  holdings,
  currency,
  onSave,
}: {
  trade: TradeRow;
  holdings: { accountId: string; name: string }[];
  currency: string;
  onSave: (amountMinor: number, intoAccountId: string | null) => void;
}) {
  const [amount, setAmount] = useState(trade.reinvestedMinor == null ? '' : minorToMajorString(trade.reinvestedMinor, currency));
  const [into, setInto] = useState(trade.reinvestedIntoAccountId ?? '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = amount.trim();
    onSave(typed === '' ? 0 : parseMajor(typed, currency), into || null);
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <Input
        aria-label={`Reinvested from ${trade.occurredOn}`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="reinvested"
        className="w-24"
      />
      <Select aria-label={`Reinvested into for ${trade.occurredOn}`} value={into} onChange={(e) => setInto(e.target.value)}>
        <option value="">into…</option>
        {holdings.map((holding) => (
          <option key={holding.accountId} value={holding.accountId}>
            {holding.name}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="ghost">
        Save
      </Button>
    </form>
  );
}
