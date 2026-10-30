import { formatMinor, groupTypedAmount, parseGroupedMajor } from '@expanses/core';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { type GroupChild, DestructiveRow, InsetGroup, TextRow } from '../../ui/native';
import { CurrencySheet } from '../transactions/CurrencySheet';
import { longDay } from './goal-cards';

/** One payment as the form holds it, typed text and all. */
export interface StageDraft {
  id?: string;
  name: string;
  amount: string;
  months: string;
  dueOn: string;
  usesMonths: boolean;
  paidOn: string | null;
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What a payment costs, as its row says it: "Rp 25.000.000", or "6 months" for a payment counted in months of outgoings. */
export function costLine(stage: StageDraft, currency: string): string {
  if (stage.usesMonths) return `${stage.months.trim()} months`;
  try {
    return formatMinor(parseGroupedMajor(stage.amount, currency), currency);
  } catch {
    return stage.amount;
  }
}

/** A payment's second line: when it is needed by. */
export const dueByLine = (stage: StageDraft) => (DATE.test(stage.dueOn) ? `Due by ${longDay(stage.dueOn)}` : 'Due by');

/**
 * The cost row: "Cost today" with the goal's currency as a small tag on it. The tag opens the app's currency
 * list; once money is counted toward the goal the tag stays but no longer opens, and the row says why.
 */
export function CostRow({
  stage,
  currency,
  funded,
  onAmount,
  onCurrency,
  position,
}: GroupChild & {
  stage: StageDraft;
  currency: string;
  funded: boolean;
  onAmount: (amount: string) => void;
  onCurrency: (code: string) => void;
}) {
  const { ws } = useApp();
  const [picking, setPicking] = useState(false);
  return (
    <>
      <TextRow
        position={position}
        label="Cost today"
        prefix={currency}
        prefixAlways
        onPrefix={funded ? undefined : () => setPicking(true)}
        prefixLabel={`Currency: ${currency}`}
        value={stage.amount}
        onChange={(e) => onAmount(groupTypedAmount(e.target.value, currency))}
        inputMode="decimal"
        placeholder="Amount"
        required
      />
      {picking && <CurrencySheet value={currency} accountCurrency={currency} baseCurrency={ws.baseCurrency} onPick={onCurrency} onClose={() => setPicking(false)} />}
    </>
  );
}

/** Whether a payment is complete enough to keep. */
export const paymentReady = (stage: StageDraft) => stage.name.trim() !== '' && (stage.usesMonths ? stage.months.trim() !== '' : stage.amount.trim() !== '') && DATE.test(stage.dueOn);

/**
 * One payment's fields in a sheet: What, the cost, Due by, and (for a payment already in the list) Remove. The ✓
 * keeps the edit; closing the sheet drops it.
 */
export function PaymentSheet({
  initial,
  isNew,
  currency,
  funded,
  onCurrency,
  onSave,
  onRemove,
  onClose,
}: {
  initial: StageDraft;
  isNew: boolean;
  currency: string;
  funded: boolean;
  onCurrency: (code: string) => void;
  onSave: (stage: StageDraft) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const patch = (part: Partial<StageDraft>) => setDraft((was) => ({ ...was, ...part }));
  return (
    <Sheet
      title={isNew ? 'Add a payment' : 'Payment'}
      onClose={onClose}
      grouped
      confirm={{
        label: 'Save payment',
        disabled: !paymentReady(draft),
        run: () => {
          onSave(draft);
          onClose();
        },
      }}
    >
      <InsetGroup>
        {[
          <TextRow key="what" label="What" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="What this payment is" required />,
          draft.usesMonths ? (
            <TextRow key="amount" label="Months of outgoings" value={draft.months} onChange={(e) => patch({ months: e.target.value })} inputMode="numeric" placeholder="Months" />
          ) : (
            <CostRow key="amount" stage={draft} currency={currency} funded={funded} onAmount={(amount) => patch({ amount })} onCurrency={onCurrency} />
          ),
          <TextRow key="due" label="Due by" type="date" value={draft.dueOn} onChange={(e) => patch({ dueOn: e.target.value })} />,
        ]}
      </InsetGroup>
      {onRemove && (
        <InsetGroup>
          <DestructiveRow
            label="Remove this payment"
            onClick={() => {
              onRemove();
              onClose();
            }}
          />
        </InsetGroup>
      )}
    </Sheet>
  );
}
