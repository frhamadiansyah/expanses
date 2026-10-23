import { formatMinor, groupTypedAmount, isoDate, parseMajor } from '@expanses/core';
import { recordSwitch, replaceSwitch, type SwitchInput, switchTargets, type TradeRow } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { useAssetValues } from './queries';
import { tradeRatesForSave } from './trade-money';
import { typedAmount } from './trade-form';
import { HoldingRow, ResultRow, TypedRow, typedMinor } from './trade-sheet-parts';

/** The Fund row's choice that opens a fund by name rather than picking one. */
const NEW_FUND = 'new-fund';

/** A fee as typed: nothing typed is none; otherwise a figure of nought or more, or null while it is not one. */
function typedFee(text: string, currency: string): number | null {
  if (text.trim() === '') return 0;
  try {
    const minor = parseMajor(text, currency);
    return minor >= 0 ? minor : null;
  } catch {
    return null;
  }
}

/**
 * Switch (owner's mockup, 23 Oct 2026): money moved from this fund straight into another fund tracked by money, the
 * way a fund app switches, with no bank account between them. From: this fund, what it is worth, and the amount. Into:
 * the other fund (or a new one by name, held at the same place), a fee if one was taken, and the day. Recorded as one
 * step by `recordSwitch`; an existing switch, opened from either fund's history, is changed as one by `replaceSwitch`.
 */
export function SwitchSheet({
  fromAccountId,
  icon,
  editing = null,
  onClose,
}: {
  fromAccountId: string;
  icon: ReactNode;
  /** Both sides of the switch being changed; null for a new one. */
  editing?: { out: TradeRow; into: TradeRow } | null;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const today = isoDate();
  const values = useAssetValues();
  const [occurredOn, setOccurredOn] = useState(editing?.out.occurredOn ?? today);
  // What it is worth on the day chosen, which is what the switch can take; the line above says what it is worth now.
  const dated = useAssetValues(occurredOn && occurredOn <= today ? occurredOn : today);
  const targets = useQuery({ queryKey: ['switch-targets', ws.workspaceId, fromAccountId], queryFn: () => switchTargets(database, ws, fromAccountId) });
  const from = values.data?.find((row) => row.accountId === fromAccountId);
  const currency = from?.currency ?? ws.baseCurrency;

  const [amount, setAmount] = useState(editing ? typedAmount(editing.out.grossMinor, currency) : '');
  const [fee, setFee] = useState(editing && editing.into.feeMinor > 0 ? typedAmount(editing.into.feeMinor, currency) : '');
  const [picked, setPicked] = useState(editing?.into.accountId ?? '');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const choices = targets.data ?? [];
  // The first other fund until one is picked; with none yet, a new one by name.
  const target = picked || (targets.isSuccess ? (choices[0]?.accountId ?? NEW_FUND) : '');
  const amountMinor = typedMinor(amount, currency);
  const feeMinor = typedFee(fee, currency);
  // What the fund is worth that day to switch from: being changed, the switch's own amount is still in it from its day on.
  const thatDay = dated.data?.find((row) => row.accountId === fromAccountId)?.valueMinor ?? from?.valueMinor ?? 0;
  const worthMinor = thatDay + (editing && editing.out.occurredOn <= occurredOn ? editing.out.grossMinor : 0);
  const tooMuch = amountMinor !== null && amountMinor > worthMinor;
  const allFee = amountMinor !== null && feeMinor !== null && feeMinor >= amountMinor;
  const to: SwitchInput['to'] | null = target === NEW_FUND ? (newName.trim() ? { newFundName: newName.trim() } : null) : target ? { accountId: target } : null;
  const input: SwitchInput | null =
    from && amountMinor !== null && feeMinor !== null && !tooMuch && !allFee && to && occurredOn !== '' && occurredOn <= today
      ? { fromAccountId, to, occurredOn, amountMinor, feeMinor }
      : null;

  async function save() {
    if (!input) return;
    setError(null);
    setBusy(true);
    try {
      // One currency on both sides: only its rate that day, when it is not the workspace's own.
      const ratesToBase = await tradeRatesForSave({
        database, ws, input: { accountId: fromAccountId, kind: 'sell', occurredOn: input.occurredOn, unitsMicro: 0, grossMinor: input.amountMinor, feeMinor: 0, taxMinor: 0, cashAccountId: null },
        holdingCurrency: currency, cashCurrency: currency, needsRate: null, manualRate: '', resolveRates, onMissing: () => undefined, where: 'Rate that day',
      });
      if (editing) await replaceSwitch(database, ws, editing.out.id, { ...input, ratesToBase });
      else await recordSwitch(database, ws, { ...input, ratesToBase });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped tall title="Switch" onClose={onClose} confirm={{ label: editing ? 'Save switch' : 'Record switch', disabled: busy || input === null, run: () => void save() }}>
      <InsetGroup header="From">
        <HoldingRow icon={icon} name={from?.name ?? ''} subtitle={`Value now ${formatMinor(from?.valueMinor ?? 0, currency)}`} />
        <TypedRow
          label="Amount"
          value={amount}
          onChange={(e) => setAmount(groupTypedAmount(e.target.value, currency))}
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          placeholder="Required"
          aria-invalid={tooMuch}
        />
      </InsetGroup>

      <div aria-hidden className="-mt-[10px] mb-[6px] flex justify-center text-[var(--ph-ink-3)] md:max-w-2xl" data-testid="switch-arrow">
        <ArrowDown size={20} />
      </div>

      <InsetGroup header="Into">
        <SelectRow label="Fund" value={target} onChange={(e) => setPicked(e.target.value)}>
          {choices.map((choice) => (
            <option key={choice.accountId} value={choice.accountId}>
              {choice.name}
            </option>
          ))}
          <option value={NEW_FUND}>New fund…</option>
        </SelectRow>
        {target === NEW_FUND && <TextRow label="Fund name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Required" autoComplete="off" />}
        <TypedRow
          label="Fee"
          value={fee}
          onChange={(e) => setFee(groupTypedAmount(e.target.value, currency))}
          inputMode={currency === 'IDR' ? 'numeric' : 'decimal'}
          placeholder="None"
          aria-invalid={allFee}
        />
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
      </InsetGroup>

      {tooMuch && (
        <InsetGroup footer="A switch can take up to what the fund is worth that day. If the fund app shows more, update its value first.">
          <ResultRow testId="switch-worth" label="Worth" value={formatMinor(worthMinor, currency)} />
        </InsetGroup>
      )}
      {!tooMuch && amountMinor !== null && feeMinor !== null && feeMinor > 0 && !allFee && (
        <InsetGroup footer="The fee stays in the money put in, as a buy's fee does.">
          <ResultRow testId="switch-arrives" label="Arrives" value={formatMinor(amountMinor - feeMinor, currency)} />
        </InsetGroup>
      )}
      <ErrorBox error={error} />
    </Sheet>
  );
}
