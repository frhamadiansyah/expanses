import { isoDate } from '@expanses/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { saveBytes } from '../../lib/download';
import { Button, ErrorBox } from '../../ui';
import { afterUpdate } from './after-update';
import { setLastBackupAt } from './backupState';

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
  const [gone, setGone] = useState(false);
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
      saveBytes(bytes, `expanses-backup-${isoDate()}.sqlite3`, 'application/vnd.sqlite3');
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
  return (
    <div className={`mb-4 rounded-lg px-3 py-3 text-sm ${undone ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`} role="status">
      <p className="font-medium">{note.headline}</p>
      <p className="mt-1 leading-relaxed">{note.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={undone ? 'secondary' : 'primary'} className="min-h-11" disabled={busy} onClick={() => void onBackup()}>
          Download a backup
        </Button>
        {undone ? (
          <Button variant="secondary" className="min-h-11" disabled={busy || !safety} onClick={() => void onRetry()}>
            Try the update again
          </Button>
        ) : (
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setGone(true)}>
            Not now
          </Button>
        )}
      </div>
      {done && (
        <p className="mt-2 text-xs">Backup downloaded. Keep it somewhere private — it is all of your data.</p>
      )}
      <div className="mt-2">
        <ErrorBox error={error} />
      </div>
      <details className="mt-2 text-xs opacity-80">
        <summary className="cursor-pointer py-1">Details</summary>
        <p className="mt-1">{undone ? `Update ${note.version} was put back and will be skipped until you try it again.` : `Your data is at update ${note.version}.`}</p>
      </details>
    </div>
  );
}
