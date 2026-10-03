import { getTrackPayments, setTrackPayments } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SwitchRow } from '../../ui/native';

/** The card's "Track card payments" (S7): off unless turned on. Kept on this device, as the card's terms are. */
export function TrackPaymentsSetting({ cardAccountId }: { cardAccountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const on = useQuery({ queryKey: ['track-payments', ws.workspaceId, cardAccountId], queryFn: () => getTrackPayments(database, cardAccountId) });
  return (
    <>
      <InsetGroup header="Statement check" footer="Off: payments on a statement are kept as one line on the card, not as transfers.">
        <SwitchRow
          label="Track card payments"
          checked={on.data ?? false}
          disabled={!on.isSuccess}
          onChange={(checked) => {
            setError(null);
            void setTrackPayments(database, cardAccountId, checked).then(invalidate, setError);
          }}
        />
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
