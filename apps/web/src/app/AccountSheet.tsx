import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { getLastBackupAt, daysSince } from '../features/backup/backupState';
import { usePendingDraftCount } from '../features/review/queries';
import { useApp } from './context';
import { MORE_GROUPS } from './nav';
import { Sheet } from './Sheet';

/** How long ago the last backup was, in the fewest words that still answer "am I covered?". */
function backupNote(last: string | null): string {
  if (!last) return 'never';
  const days = daysSince(last);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The account: everything the tab bar cannot hold. A sheet, so closing it returns you where you were. */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { database } = useApp();
  const pending = usePendingDraftCount().data ?? 0;
  const lastBackup = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });

  const note = (to: string) => {
    if (to === '/backup') return lastBackup.isSuccess ? backupNote(lastBackup.data) : '';
    if (to === '/review' && pending > 0) return `${pending} waiting`;
    return '';
  };

  return (
    <Sheet title="Account" onClose={onClose}>
      <div className="-mx-1">
        {MORE_GROUPS.map((group) => (
          <section key={group.title} className="mb-4 last:mb-0">
            <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{group.title}</h3>
            <div className="divide-y divide-slate-100">
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className="flex min-h-12 items-center gap-3 rounded-lg px-1 text-sm hover:bg-slate-50"
                  activeProps={{ className: 'font-medium' }}
                >
                  <item.icon size={18} aria-hidden className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {note(item.to) && <span className="text-xs text-slate-500">{note(item.to)}</span>}
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
