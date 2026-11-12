import { dismissRepairNotice, repairNotices } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { Notice } from '../../ui/native';
import { repairLine, repairRowText, repairTitle } from './repair-notice';

/**
 * Once, after the shared-book repairs (sync gaps R2) put right Family purchases that were tagged to an event without
 * being moved: what was moved and what shows in the workspace again, with the list behind it. Gone once dismissed.
 */
export function RepairNotice() {
  const { database } = useApp();
  const client = useQueryClient();
  const notices = useQuery({ queryKey: ['repair-notices'], queryFn: () => repairNotices(database) }).data ?? [];
  const notice = notices[0];
  if (!notice) return null;
  return (
    <Notice
      testId="repair-notice"
      kind="info"
      title={repairTitle(notice)}
      line={repairLine(notice)}
      dismissLabel="Done"
      onDismiss={() => void dismissRepairNotice(database, notice.bookId).then(() => client.invalidateQueries({ queryKey: ['repair-notices'] }))}
    >
      <ul data-testid="repair-notice-rows" className="space-y-1.5 text-left text-[13px] text-[var(--ph-ink-2)]">
        {notice.rows.map((row) => (
          <li key={row.transactionId}>
            <span className="text-[var(--ph-ink-3)]">{row.occurredOn}</span> {repairRowText(row, notice.bookName)}
          </li>
        ))}
      </ul>
    </Notice>
  );
}
