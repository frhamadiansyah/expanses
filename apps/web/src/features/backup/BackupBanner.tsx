import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts } from '../../lib/queries';
import { cx } from '../../ui';
import { backupUrgency, daysSince, getLastBackupAt } from './backupState';

export function BackupBanner() {
  const { database } = useApp();
  const accounts = useAccounts();
  const last = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  if (!accounts.isSuccess || !last.isSuccess) return null;
  const urgency = backupUrgency(last.data, (accounts.data ?? []).some(isMoneyAccount));
  if (urgency === 'ok') return null;
  return (
    <div className={cx('mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm', urgency === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700')} role="status">
      <span>{last.data ? `No backup in ${daysSince(last.data)} days.` : 'You have not backed up yet.'} Your data exists only on this device.</span>
      <Link to="/backup" className="whitespace-nowrap font-medium underline">
        Back up now
      </Link>
    </div>
  );
}
