import { isoDate } from '@expanses/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { useApp } from '../../app/context';
import { saveBytes } from '../../lib/download';
import { ErrorBox } from '../../ui';
import { Notice, NoticeButton } from '../../ui/native';
import { afterUpdate } from './after-update';
import { setLastBackupAt } from './backupState';
import { dismissUpdateCard, subscribeToUpdateCard, updateCardDismissed } from './reminder-state';

/**
 * The one thing the app says about what happened on the way in.
 *
 * It appears above the page after an update that changed the schema, and after one that had to be undone —
 * the two moments when the backup a user holds is suddenly older than their data, or when the app is
 * deliberately running a version behind. It is not a toast: both messages are about the safety of their only
 * copy, and both offer the one action that actually helps, which is a backup off this device.
 */
export function AfterUpdateCard() {
  const { database, safety, update } = useApp();
  const queryClient = useQueryClient();
  // Published rather than kept here: the standing backup reminder stands down while this card is up, and
  // it has to learn the moment it is not.
  const gone = useSyncExternalStore(subscribeToUpdateCard, updateCardDismissed, updateCardDismissed);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const note = afterUpdate(update);
  if (!note || gone) return null;

  const onBackup = async () => {
    setError(null);
    setBusy(true);
    try {
      const bytes = await database.exportBytes();
      await saveBytes(bytes, `expanses-backup-${isoDate()}.sqlite3`, 'application/vnd.sqlite3');
      await setLastBackupAt(database, new Date().toISOString());
      // The standing "you have not backed up" banner reads the same date; it must not go on saying that.
      await queryClient.invalidateQueries({ queryKey: ['last-backup'] });
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  /*
   * The one place a block lifts without a new build. The update is attempted again on the next open exactly
   * as it was the first time — a copy first, the check afterwards, and the same rollback if it fails again —
   * so pressing this can cost the user a trip through the recovery screen, never their data.
   */
  const onRetry = async () => {
    setError(null);
    setBusy(true);
    try {
      await safety?.snapshots.unblock();
      window.location.reload();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const undone = note.kind === 'undone';
  // Which step of a run of updates was at fault is not knowable once they have all been put back, so
  // the text names the point the app stops at rather than a culprit it would be guessing.
  const text = undone ? `Updates from ${note.version} onwards are being skipped until tried again.` : `A copy was taken before the update and checked afterwards. Data is at update ${note.version}.`;
  return (
    <Notice
      kind={undone ? 'warning' : 'success'}
      title={note.headline}
      line={note.line}
      body={text}
      // Every message in the app can be put away, this one included: a card that cannot be dismissed is
      // one the user learns to read past, and while it stands it is covering for the backup reminder.
      onDismiss={dismissUpdateCard}
      actions={
        <>
          <NoticeButton disabled={busy} onClick={() => void onBackup()}>
            Download backup
          </NoticeButton>
          {undone && (
            <NoticeButton className="mt-2" disabled={busy || !safety} onClick={() => void onRetry()}>
              Try again
            </NoticeButton>
          )}
        </>
      }
    >
      {done && <p className="text-[13px] text-[var(--ph-ink-2)]">Backup downloaded. Keep it somewhere private, as it is all of the data.</p>}
      <ErrorBox error={error} />
    </Notice>
  );
}
