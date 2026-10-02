import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../../app/context';
import { newerDatabaseVersion } from '../../../db/newer-database';
import { ErrorBox } from '../../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../../ui/native';
import { LATEST_VERSION } from '@expanses/db';
import type { CloudCopy } from './names';
import { ICloudBackup } from './plugin';
import { ICLOUD_QUERY, restoreFromICloud } from './runner';
import { cloudCopies } from './service';
import { copyLine, whenShort } from './words';

/**
 * Every copy in iCloud, newest first, with the device that made it. Tapping one asks once — the system's own alert —
 * before the data on this iPhone is replaced; a safety copy of it is kept first, as with every restore.
 */
export function ICloudRestorePage() {
  const app = useApp();
  const cloud = useQuery({ queryKey: ICLOUD_QUERY, queryFn: () => cloudCopies(ICloudBackup) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function onChoose(copy: CloudCopy) {
    if (busy) return;
    if (!window.confirm(`Replace the data on this iPhone with the copy from ${whenShort(copy.takenAt)}? A safety copy of the current data is kept first.`)) return;
    setError(null);
    setBusy(copy.name);
    try {
      await restoreFromICloud(copy.name, app);
      window.location.replace('/backup');
    } catch (e) {
      const version = newerDatabaseVersion(e);
      setError(
        version === null
          ? e
          : new Error(`That copy was made by a newer version of cicis (update ${version}; this app knows up to ${LATEST_VERSION}). Nothing here was changed. Update cicis, then try again.`),
      );
      setBusy(null);
    }
  }

  const copies = cloud.data?.copies ?? [];
  return (
    <div className={SCREEN}>
      <PushedTitle title="Restore from iCloud" back="Backup" backTo="/backup" />
      <ErrorBox error={error ?? cloud.error} />
      {cloud.isSuccess && !cloud.data && (
        <InsetGroup>
          <InsetRow title="iCloud Drive is off for cicis" subtitle="Turn it on in Settings, then come back." chevron={false} />
        </InsetGroup>
      )}
      {cloud.data && (
        <InsetGroup>
          {copies.length ? (
            copies.map((copy) => (
              <InsetRow
                key={copy.name}
                title={whenShort(copy.takenAt)}
                subtitle={busy === copy.name ? 'Restoring…' : copyLine(copy)}
                label={`Restore the copy from ${whenShort(copy.takenAt)}`}
                disabled={!!busy}
                onClick={() => void onChoose(copy)}
              />
            ))
          ) : (
            <InsetRow title="No copies in iCloud yet" subtitle="The first one is saved today, once there is something to keep." chevron={false} />
          )}
        </InsetGroup>
      )}
    </div>
  );
}
