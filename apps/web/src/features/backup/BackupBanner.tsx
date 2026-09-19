import { isoDate } from '@expanses/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useMatchRoute } from '@tanstack/react-router';
import { useState, useSyncExternalStore } from 'react';
import { useApp } from '../../app/context';
import { saveBytes } from '../../lib/download';
import { isMoneyAccount, useAccounts } from '../../lib/queries';
import { Button, cx, ErrorBox } from '../../ui';
import { afterUpdate, bannerStandsDown } from './after-update';
import { type BackupSnooze, backupUrgency, bannerWords, daysSince, getLastBackupAt, reminderDue, setLastBackupAt, snoozeUntil } from './backupState';
import { readSnooze, SNOOZE_KEY, subscribeToUpdateCard, updateCardDismissed } from './reminder-state';

const TONE: Record<string, string> = {
  overdue: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
  warn: 'bg-amber-100 text-amber-900',
  remind: 'bg-slate-100 text-slate-700',
};

/**
 * The standing reminder to keep a copy of your own.
 *
 * It is about the user's own export — a file they hold, off this device — and never about the safety
 * copies the app keeps for itself, which would be lost by everything that loses the database. At its
 * loudest it does the export in place: a reminder a month overdue should be one press from done, not a
 * trip to another screen. And it is always dismissible, for a week, because a message that cannot be
 * put off is one the user learns to read past.
 */
export function BackupBanner() {
  const { database, update } = useApp();
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();
  const accounts = useAccounts();
  const last = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  const [snooze, setSnooze] = useState(readSnooze);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Shared with the card above the page, so putting that card away brings this one back in the same session.
  const cardDismissed = useSyncExternalStore(subscribeToUpdateCard, updateCardDismissed, updateCardDismissed);

  if (!accounts.isSuccess || !last.isSuccess) return null;
  // Not on the screen that answers it: a reminder on top of the thing it is reminding you to do is noise.
  if (matchRoute({ to: '/backup' })) return null;
  // The card above the page has just said more about their data than this can, and offers the same
  // backup. Two messages about one thing is the nagging this branch is meant to avoid — but only for as
  // long as that card is really there.
  if (bannerStandsDown(afterUpdate(update), cardDismissed)) return null;

  const level = backupUrgency(last.data, (accounts.data ?? []).some(isMoneyAccount));
  if (level === 'ok' || !reminderDue(level, snooze)) return null;

  const onDismiss = () => {
    const next: BackupSnooze = { until: snoozeUntil(), urgency: level };
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: put it off for this session, which is all this device can remember.
    }
    setSnooze(next);
  };

  const onDownload = async () => {
    setError(null);
    setBusy(true);
    try {
      const bytes = await database.exportBytes();
      saveBytes(bytes, `expanses-backup-${isoDate()}.sqlite3`, 'application/vnd.sqlite3');
      await setLastBackupAt(database, new Date().toISOString());
      // The date this banner reads is the one just written; without this it goes on saying the old number.
      await queryClient.invalidateQueries({ queryKey: ['last-backup'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx('mb-4 rounded-lg px-3 py-2 text-sm', TONE[level])} role="status">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{bannerWords(level, last.data ? daysSince(last.data) : null)}</span>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {level === 'overdue' ? (
            <Button className="min-h-11" disabled={busy} onClick={() => void onDownload()}>
              Download backup
            </Button>
          ) : (
            <Link to="/backup" className="inline-flex min-h-11 items-center px-1 font-medium whitespace-nowrap underline">
              Back up now
            </Link>
          )}
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onDismiss}>
            Not now
          </Button>
        </div>
      </div>
      {error != null && (
        <div className="mt-2">
          <ErrorBox error={error} />
        </div>
      )}
    </div>
  );
}
