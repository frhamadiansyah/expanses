import { dismissWithdrawalRateNotice, withdrawalRateNoticeDue } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { Notice } from '../../ui/native';
import { WITHDRAWAL_RATE_NOTICE } from '../../lib/withdrawal-rate';

/** Said once, after the first run has recalculated every foreign account (§6, R18). OK puts it away for good. */
export function WithdrawalRateNotice() {
  const { database } = useApp();
  const queryClient = useQueryClient();
  const due = useQuery({ queryKey: ['withdrawal-rate-notice'], queryFn: () => withdrawalRateNoticeDue(database) });
  if (!due.data) return null;
  const dismiss = async () => {
    await dismissWithdrawalRateNotice(database);
    await queryClient.invalidateQueries({ queryKey: ['withdrawal-rate-notice'] });
  };
  return (
    <Notice
      testId="withdrawal-rate-notice"
      kind="info"
      title="Withdrawal rate now used"
      line="Past months may change slightly"
      body={WITHDRAWAL_RATE_NOTICE}
      onDismiss={() => void dismiss()}
      dismissLabel="OK"
    />
  );
}
