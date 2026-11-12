import { coveredCharge, formatMinor } from '@expanses/core';
import { waiveAnnualFee } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { DateRow } from '../transactions/CardRows';
import { type DueFee } from './fee-due';
import { feeDateText } from './fee-line';

/**
 * What a tap on an annual fee row asks: was it waived. The alert comes first with its three choices, as before;
 * Waived opens a small sheet naming the charge it covers (the last one that happened, unless the next is within 30
 * days) and the day the bank reversed it, today unless changed. Saving refunds the fee on the card when it was
 * recorded, dated that day, and marks the charge's year; Charged as normal and Not now only close it.
 */
export function FeeAlert({ fee, today, onClose }: { fee: DueFee; today: string; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState(false);
  const [reversedOn, setReversedOn] = useState(today);
  const covered = fee.annualFeeOn ? coveredCharge(fee.annualFeeOn, today) : null;
  const on = covered ? feeDateText(covered) : null;
  const amount = fee.annualFeeMinor !== null ? formatMinor(fee.annualFeeMinor, fee.currency) : null;
  const what = [amount, on ? `charged on ${on}` : null].filter(Boolean).join(' ');

  const waive = async () => {
    try {
      await waiveAnnualFee(database, ws, { cardId: fee.cardId, today, reversedOn });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    }
  };

  if (sheet && covered) {
    return (
      <Sheet grouped title={`Annual fee ${covered.slice(0, 4)}`} onClose={onClose} confirm={{ label: 'Waived', disabled: reversedOn === '', run: () => void waive() }}>
        <InsetGroup>
          <InsetRow plain title="Charged" value={[amount, on].filter(Boolean).join(' · ')} />
          <DateRow on={reversedOn} onChange={setReversedOn} max={today} label="Reversed on" />
        </InsetGroup>
        <ErrorBox error={error} />
      </Sheet>
    );
  }

  return (
    <NoticeAlert
      title="Annual fee"
      text={<>{what ? `${what}. ` : ''}Waived refunds it on the card and clears that fee.</>}
      actions={
        <>
          <button type="button" onClick={() => setSheet(true)} className={`${ALERT_ROW} font-semibold`}>
            Waived
          </button>
          <button type="button" onClick={onClose} className={ALERT_ROW}>
            Charged as normal
          </button>
        </>
      }
      closeLabel="Not now"
      onClose={onClose}
    />
  );
}
