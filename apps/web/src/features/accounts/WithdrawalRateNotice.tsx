import { dismissWithdrawalRateNotice, withdrawalRateNoticeDue } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../app/context';
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
    <div role="status" data-testid="withdrawal-rate-notice" className="mb-4 flex items-start gap-3 rounded-[12px] bg-[var(--ph-surface)] p-4 text-[15px] leading-5 text-[var(--ph-ink)]">
      <p className="flex-1">{WITHDRAWAL_RATE_NOTICE}</p>
      <button type="button" onClick={() => void dismiss()} className="shrink-0 text-[15px] font-medium text-[var(--ph-tint)]">
        OK
      </button>
    </div>
  );
}
