import { isoDate } from '@expanses/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useMatchRoute } from '@tanstack/react-router';
import { useState, useSyncExternalStore } from 'react';
import { useApp } from '../../app/context';
import { saveBytes } from '../../lib/download';
import { isMoneyAccount, useAccounts } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { NOTICE_BUTTON, Notice, NoticeButton } from '../../ui/native';
import { afterUpdate, bannerStandsDown } from './after-update';
import { type BackupSnooze, backupUrgency, bannerWords, daysSince, getLastBackupAt, reminderDue, setLastBackupAt, snoozeUntil } from './backupState';
import { readSnooze, SNOOZE_KEY, subscribeToUpdateCard, updateCardDismissed } from './reminder-state';

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
      await saveBytes(bytes, `expanses-backup-${isoDate()}.sqlite3`, 'application/vnd.sqlite3');
      await setLastBackupAt(database, new Date().toISOString());
      // The date this banner reads is the one just written; without this it goes on saying the old number.
      await queryClient.invalidateQueries({ queryKey: ['last-backup'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const words = bannerWords(level, last.data ? daysSince(last.data) : null);
  return (
    <Notice
      kind="warning"
      title={words.title}
      line={words.line}
      onDismiss={onDismiss}
      actions={
        level === 'overdue' ? (
          <NoticeButton disabled={busy} onClick={() => void onDownload()}>
            Download backup
          </NoticeButton>
        ) : (
          <Link to="/backup" className={NOTICE_BUTTON}>
            Back up now
          </Link>
        )
      }
    >
      <ErrorBox error={error} />
    </Notice>
  );
}
