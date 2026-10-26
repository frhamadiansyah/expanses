import { formatMinor } from '@expanses/core';
import { waiveAnnualFee } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { type DueFee } from './fee-due';
import { feeDateText } from './fee-line';
import { nextFeeDate } from '@expanses/core';

/**
 * What a tap on an annual fee row asks: was it waived. Waived refunds the fee on the card when it was recorded and
 * marks this year's charge; Charged as normal and Not now only close it, and the date rolls on as it always does.
 */
export function FeeAlert({ fee, today, onClose }: { fee: DueFee; today: string; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const on = fee.annualFeeOn ? feeDateText(nextFeeDate(fee.annualFeeOn, today)) : null;
  const what = [fee.annualFeeMinor !== null ? formatMinor(fee.annualFeeMinor, fee.currency) : null, on ? `charged on ${on}` : null].filter(Boolean).join(' ');

  const waive = async () => {
    try {
      await waiveAnnualFee(database, ws, { cardId: fee.cardId, today });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <NoticeAlert
      title="Annual fee"
      text={
        <>
          {what ? `${what}. ` : ''}Waived refunds it on the card and clears this year&apos;s fee.
          <ErrorBox error={error} />
        </>
      }
      actions={
        <>
          <button type="button" onClick={() => void waive()} className={`${ALERT_ROW} font-semibold`}>
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
