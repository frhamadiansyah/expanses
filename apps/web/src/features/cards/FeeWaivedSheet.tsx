import { chargeAfterWaiver, dayMonth, formatMinor, groupedMajorString, groupTypedAmount, parseGroupedMajor } from '@expanses/core';
import { annualFeeCharges, type FeeChargeChoice, feeWaivedStatus, type FeeWaivedStatus, saveFeeWaived, undoFeeWaived } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { UndoToast } from '../../ui/UndoToast';
import { InsetGroup, InsetRow, SwitchRow, TextRow } from '../../ui/native';
import { owedMinor } from '../networth/debt-rows';
import { DateRow } from '../transactions/CardRows';
import { feeDateText } from './fee-line';

/** The card whose annual fee the bank waived, as Settings, a fee challenge and Recurring each know it. */
export interface WaivedFee {
  cardId: string;
  currency: string;
  annualFeeMinor: number | null;
  annualFeeOn: string | null;
}

/** "Annual fee · 5 Oct 2026": a charge as the Fee charge row names it. */
const chargeLine = (charge: FeeChargeChoice) => `${charge.description || 'Charge'} · ${feeDateText(charge.occurredOn)}`;

/** What money back does to the card: less owed, or into credit by what is left over. */
function creditText(amountMinor: number, owed: number, currency: string): string {
  if (owed >= amountMinor) return `The card owes ${formatMinor(amountMinor, currency)} less.`;
  return `The card goes ${formatMinor(amountMinor - owed, currency)} into credit.`;
}

/** What a waived fee's challenge says: "✓ Fee waived · Rp 1.200.000 back on 14 Nov", or "✓ Fee waived" with nothing back. */
export function waivedLine(status: FeeWaivedStatus, currency: string): string {
  return status.back ? `✓ Fee waived · ${formatMinor(status.back.amountMinor, currency)} back on ${dayMonth(status.back.on)}` : '✓ Fee waived';
}

export function useFeeWaivedStatus(cardId: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['fee-waived-status', ws.workspaceId, cardId, today], queryFn: () => feeWaivedStatus(database.db, ws, { cardId, today }) });
}

/**
 * Fee waived · <year>: the one way an annual fee the bank waived is recorded (option A, 2026-11-12), opened from
 * Settings' This year's fee, from a reached fee challenge, and from a fee due in Recurring.
 *
 * Back on the card, on once the charge has happened: with the fee charge recorded, the refund cancels that charge
 * (another can be picked from the card's charges near the date); with none recorded, the amount that came back is
 * recorded on the card alone. Off, the fee was never charged and only the year is marked. A year already waived
 * shows what was recorded, with Undo. `onSaved` hands back the year, for the Undo toast.
 */
export function FeeWaivedSheet({ fee, today, onClose, onSaved, chargedAsNormal = false }: { fee: WaivedFee; today: string; onClose: () => void; onSaved: (year: number) => void; chargedAsNormal?: boolean }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const balances = useBalances();
  const status = useFeeWaivedStatus(fee.cardId, today);
  const charges = useQuery({ queryKey: ['fee-charges', ws.workspaceId, fee.cardId, today], queryFn: () => annualFeeCharges(database, ws, { cardId: fee.cardId, today }) });
  const { currency } = fee;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [back, setBack] = useState<boolean | null>(null);
  const [chargeId, setChargeId] = useState<string | null | undefined>(undefined);
  const [amount, setAmount] = useState(fee.annualFeeMinor !== null ? groupedMajorString(fee.annualFeeMinor, currency) : '');
  const [cameBackOn, setCameBackOn] = useState(today);

  const covered = charges.data?.covered ?? status.data?.covered ?? null;
  // Once the charges are read: on when the charge has happened, off when it is still ahead (waived in advance), and the
  // charge that looks like the fee picked.
  useEffect(() => {
    if (!charges.isSuccess) return;
    setBack((was) => was ?? (covered === null || covered <= today));
    setChargeId((was) => (was === undefined ? (charges.data?.matched?.transactionId ?? null) : was));
  }, [charges.isSuccess, charges.data, covered, today]);

  const year = status.data?.year ?? Number(today.slice(0, 4));
  const title = `Fee waived · ${year}`;
  if (!status.data || !charges.isSuccess || back === null || chargeId === undefined) return <Sheet grouped closeOnly title={title} onClose={onClose}>{null}</Sheet>;

  const nearby = charges.data?.nearby ?? [];
  const charge = chargeId !== null ? nearby.find((c) => c.transactionId === chargeId) ?? null : null;
  const categoryName = charge ? (accounts.data ?? []).find((a) => a.id === charge.categoryId)?.name ?? 'its category' : null;
  const owed = owedMinor(balances.data ?? {}, fee.cardId);
  const typedMinor = amount.trim() ? parseGroupedMajor(amount, currency) : 0;

  const run = async (write: () => Promise<unknown>, after: () => void) => {
    setError(null);
    setBusy(true);
    try {
      await write();
      await invalidate();
      after();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };

  if (status.data.waived) {
    // What was recorded, and the way to take it back; once undone the sheet asks again.
    const recorded = status.data.back;
    return (
      <Sheet grouped closeOnly title={title} onClose={onClose}>
        <InsetGroup footer={fee.annualFeeOn ? `Next charge ${feeDateText(chargeAfterWaiver(fee.annualFeeOn, today))}.` : undefined}>
          <InsetRow plain title="Back on the card" value={recorded ? 'On' : 'Off'} />
          {recorded && <InsetRow plain title={recorded.cancelsCharge ? 'Refund' : 'Amount'} value={formatMinor(recorded.amountMinor, currency)} valueTone="ink" />}
          {recorded && <InsetRow plain title="Came back on" value={feeDateText(recorded.on)} />}
          {!recorded && <InsetRow plain title="Recorded" value="Year marked waived" />}
        </InsetGroup>
        <InsetGroup>
          <InsetRow destructive title="Undo" testId="fee-waived-undo" disabled={busy} onClick={() => void run(() => undoFeeWaived(database, ws, { cardId: fee.cardId, today }), () => {})} />
        </InsetGroup>
        <ErrorBox error={error} />
      </Sheet>
    );
  }

  if (picking) {
    const pick = (id: string | null) => {
      setChargeId(id);
      setPicking(false);
    };
    return (
      <Sheet grouped title="Fee charge" back={{ label: title, run: () => setPicking(false) }} onClose={onClose}>
        <InsetGroup header={covered ? `Charges near ${feeDateText(covered)}` : undefined}>
          {nearby.map((c) => (
            <InsetRow
              key={c.transactionId}
              plain
              title={c.description || 'Charge'}
              subtitle={feeDateText(c.occurredOn)}
              value={
                <span className="flex items-center gap-[6px]">
                  {formatMinor(c.amountMinor, currency)}
                  {c.transactionId === chargeId && <Check size={17} aria-label="Chosen" className="text-[var(--ph-tint)]" />}
                </span>
              }
              valueTone="ink"
              chevron={false}
              onClick={() => pick(c.transactionId)}
            />
          ))}
          <InsetRow plain title="Not in the app" value={chargeId === null ? <Check size={17} aria-label="Chosen" className="text-[var(--ph-tint)]" /> : undefined} chevron={false} onClick={() => pick(null)} />
        </InsetGroup>
      </Sheet>
    );
  }

  const footer = !back
    ? 'Off: the fee was never charged, so nothing is recorded. The year is marked waived.'
    : charge
      ? `The refund cancels that charge in ${categoryName}. Tap Fee charge to pick another charge.`
      : `The ${covered ? `${dayMonth(covered)} ` : ''}charge is not in the app, so this records only the money coming back.${typedMinor > 0 ? ` ${creditText(typedMinor, owed, currency)}` : ''}`;
  const save = () =>
    void run(
      () =>
        saveFeeWaived(
          database,
          ws,
          !back
            ? { cardId: fee.cardId, today, back: false }
            : charge
              ? { cardId: fee.cardId, today, back: true, cameBackOn, chargeId: charge.transactionId }
              : { cardId: fee.cardId, today, back: true, cameBackOn, chargeId: null, amountMinor: typedMinor },
        ),
      () => onSaved(year),
    );
  return (
    <Sheet grouped title={title} onClose={onClose} confirm={{ label: 'Save', disabled: busy || (back && (cameBackOn === '' || (!charge && !(typedMinor > 0)))), run: save }}>
      <InsetGroup footer={<span data-testid="fee-waived-footer">{footer}</span>}>
        <SwitchRow label="Back on the card" checked={back} onChange={setBack} testId="fee-waived-back" />
        {back && nearby.length > 0 && (
          <InsetRow
            testId="fee-charge"
            plain
            title="Fee charge"
            subtitle={charge ? chargeLine(charge) : undefined}
            value={charge ? formatMinor(charge.amountMinor, currency) : 'Not in the app'}
            valueTone={charge ? 'ink' : 'ink-3'}
            onClick={() => setPicking(true)}
          />
        )}
        {back && !charge && <TextRow label="Amount" prefix={currency} value={amount} onChange={(e) => setAmount(groupTypedAmount(e.target.value, currency))} inputMode="decimal" placeholder="Amount" />}
        {back && <DateRow on={cameBackOn} onChange={setCameBackOn} max={today} label="Came back on" />}
      </InsetGroup>
      {chargedAsNormal && (
        <InsetGroup>
          <InsetRow action title="Charged as normal" testId="fee-charged-as-normal" onClick={onClose} />
        </InsetGroup>
      )}
      <ErrorBox error={error} />
    </Sheet>
  );
}

/** The sheet, then the Undo toast once it is saved: what Settings, a challenge and Recurring each open. */
export function FeeWaivedFlow({ fee, today, onClose, chargedAsNormal = false }: { fee: WaivedFee; today: string; onClose: () => void; chargedAsNormal?: boolean }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [saved, setSaved] = useState<number | null>(null);
  if (saved !== null) {
    return (
      <UndoToast
        text={`Fee waived for ${saved}`}
        icon="refund"
        onDone={onClose}
        onUndo={() => {
          void undoFeeWaived(database, ws, { cardId: fee.cardId, today }).then(invalidate);
          onClose();
        }}
      />
    );
  }
  return <FeeWaivedSheet fee={fee} today={today} onClose={onClose} onSaved={setSaved} chargedAsNormal={chargedAsNormal} />;
}
