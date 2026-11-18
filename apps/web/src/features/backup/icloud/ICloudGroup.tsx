import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Cloud } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../../app/context';
import { KEEP_OLDER_COPIES } from '../../../db/retention';
import { ErrorBox } from '../../../ui';
import { InsetGroup, InsetRow, Notice, NoticeButton, SwitchRow } from '../../../ui/native';
import { DESK_BTN, DeskGroup, DeskIcon, DeskRow, DeskSwitch } from '../../account/desk-rows';
import { iCloudSettings, ICLOUD_KEY, ICLOUD_OFFER_KEY, ICLOUD_PHOTOS_KEY, putSetting } from './data';
import { lastOwnCopy } from './names';
import { hasICloud, ICloudBackup } from './plugin';
import { ICLOUD_QUERY, runICloudBackup } from './runner';
import { cloudCopies } from './service';
import { copiesWord, whenShort } from './words';

const SETTINGS_QUERY = ['icloud-settings'] as const;

/** What the switch does, said once, behind the group's ⓘ. */
const ABOUT = (
  <ul className="list-disc space-y-[4px] pl-[16px]">
    <li>Once a day, and after big changes, cicis saves a copy to iCloud Drive in the cicis folder.</li>
    <li>The last 7 days are kept. Older copies are removed.{KEEP_OLDER_COPIES ? ' Copies made before this version of cicis are kept for now.' : ''}</li>
    <li>The copy is encrypted. Only devices signed in to the same Apple ID can open it.</li>
    <li>Uses iCloud storage. About as much as a downloaded backup each copy, more with photos.</li>
    <li>Restoring replaces the data on this iPhone. A safety copy is kept first.</li>
    <li>This is a backup, not sync: a second device does not update on its own.</li>
  </ul>
);

/**
 * The iCloud group at the top of the Backup page — only in the iOS app. A switch (on by default for a new install),
 * the last copy, photos in or out, a copy now, and the way to every copy in iCloud.
 */
export function ICloudGroup({ blocked, desk = false }: { blocked: boolean; /** The Mac's Settings › Backup look: the same switch and actions as Mac rows. */ desk?: boolean }) {
  const { database } = useApp();
  const queryClient = useQueryClient();
  const available = hasICloud();
  const settings = useQuery({ queryKey: SETTINGS_QUERY, enabled: available, queryFn: () => iCloudSettings(database) });
  const cloud = useQuery({ queryKey: ICLOUD_QUERY, enabled: available, queryFn: () => cloudCopies(ICloudBackup) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!available || !settings.data || cloud.isPending) return null;

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY }), queryClient.invalidateQueries({ queryKey: ICLOUD_QUERY })]);

  async function backUp(force: boolean) {
    setError(null);
    setBusy(true);
    try {
      await runICloudBackup(database, { force });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function setEnabled(on: boolean) {
    await putSetting(database, ICLOUD_KEY, on ? 'on' : 'off');
    await putSetting(database, ICLOUD_OFFER_KEY, 'answered');
    await refresh();
    // Turning it on takes the day's copy now, rather than at the next open.
    if (on) await backUp(false);
  }

  async function setPhotos(on: boolean) {
    await putSetting(database, ICLOUD_PHOTOS_KEY, on ? 'on' : 'off');
    await refresh();
  }

  const listed = cloud.data;
  if (!listed) {
    // Not signed in to iCloud, or iCloud Drive is off for the app: one grey row, and the way to fix it.
    if (desk) {
      return (
        <DeskGroup title="iCloud">
          <DeskRow lead={<DeskIcon icon={Cloud} tint="#5ac8fa" />} quiet title="Back up to iCloud" subtitle="iCloud Drive is off for cicis. Turn it on in Settings." right={<button type="button" className={DESK_BTN} onClick={() => void ICloudBackup.openSettings()}>Open Settings</button>} />
        </DeskGroup>
      );
    }
    return (
      <InsetGroup header="iCloud" info={ABOUT}>
        <InsetRow title={<span className="text-[var(--ph-ink-3)]">Back up to iCloud</span>} subtitle="iCloud Drive is off for cicis. Turn it on in Settings." chevron={false} />
        <InsetRow title="Open Settings" action onClick={() => void ICloudBackup.openSettings()} />
      </InsetGroup>
    );
  }

  const { enabled, withPhotos, offer } = settings.data;
  const last = lastOwnCopy(listed.copies, listed.deviceId);
  const off = busy || blocked;

  if (desk) {
    const lastLine = busy ? 'Backing up…' : last ? `Last backup: ${whenShort(last.takenAt)}` : 'No copy yet';
    return (
      <>
        <DeskGroup title="iCloud" footer="A backup is a copy, not sync: it brings everything back on a new device. The last 7 days are kept, encrypted.">
          <DeskRow lead={<DeskIcon icon={Cloud} tint="#5ac8fa" />} title="Back up to iCloud" subtitle={lastLine} right={<DeskSwitch label="Back up to iCloud" checked={enabled} disabled={off} onChange={(on) => void setEnabled(on)} />} />
          <DeskRow title="Include photos" right={<DeskSwitch label="Include photos" checked={withPhotos} disabled={off} onChange={(on) => void setPhotos(on)} />} />
          <DeskRow title="Back up now" right={<button type="button" className={DESK_BTN} disabled={off} onClick={() => void backUp(true)}>Back up now</button>} />
          {/* Today's restore page, with its own choice of copy and its own confirm. */}
          <DeskRow
            title="Restore from iCloud…"
            subtitle={copiesWord(listed.copies.length)}
            right={
              blocked ? (
                <button type="button" className={DESK_BTN} disabled>Choose a backup…</button>
              ) : (
                <Link to="/backup/icloud" className={DESK_BTN}>Choose a backup…</Link>
              )
            }
          />
        </DeskGroup>
        <ErrorBox error={error} />
      </>
    );
  }

  return (
    <>
      {offer && !enabled && (
        <Notice
          kind="info"
          title="iCloud backup"
          line="An encrypted copy every day"
          body="cicis can save an encrypted copy to iCloud Drive every day, so a new iPhone can pick up where this one left off."
          actions={
            <NoticeButton disabled={off} onClick={() => void setEnabled(true)}>
              Turn on iCloud backup
            </NoticeButton>
          }
          onDismiss={() => void putSetting(database, ICLOUD_OFFER_KEY, 'answered').then(refresh)}
        />
      )}
      <InsetGroup header="iCloud" info={ABOUT}>
        <SwitchRow label="Back up to iCloud" checked={enabled} disabled={off} onChange={(on) => void setEnabled(on)} />
        <InsetRow title="Last backup" value={busy ? 'Backing up…' : last ? whenShort(last.takenAt) : 'Not yet'} valueTone="ink-3" chevron={false} />
        <SwitchRow label="Include photos" checked={withPhotos} disabled={off} onChange={(on) => void setPhotos(on)} />
        <InsetRow title="Back up now" action disabled={off} onClick={() => void backUp(true)} />
        <InsetRow title="Restore from iCloud" value={copiesWord(listed.copies.length)} valueTone="ink-3" to="/backup/icloud" disabled={blocked} />
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
