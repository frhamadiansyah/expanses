import { Download, Image, Upload } from 'lucide-react';
import { ErrorBox } from '../../ui';
import { DESK_BTN, DESK_BTN_DANGER, DeskGroup, DeskIcon, DeskRow, PaneTitle } from '../account/desk-rows';
import { formatBytes, formatWhen } from '../recovery/recovery-copy';
import { ICloudGroup } from './icloud/ICloudGroup';
import { copyReasonWords, daysSince } from './backupState';
import { BackupFileInputs, photoWords, useBackupFlows } from './use-backup-flows';

const GREY = '#8e8e93';

/** "today", "yesterday", "3 days ago", "never": when the last backup file was saved. */
function lastSaved(last: string | null | undefined): string {
  if (!last) return 'never';
  const days = daysSince(last);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Settings › Backup on the Mac (Mac Settings and Tools, A): iCloud (the iOS and Mac app only), the backup file, the
 * photos, and the safety copies this device keeps. Every button presses the Backup page's own handlers
 * (`useBackupFlows`): the same confirm, the same safety copy downloaded first, the same second press, the same
 * refusal of a newer file — nothing here restores, deletes or replaces by any other road.
 */
export function DeskBackup() {
  const flows = useBackupFlows();
  const { photoIndex, last, kept, error, busy, done, pending, blocked } = flows;
  const photoCount = photoIndex.data?.length ?? 0;

  return (
    <div data-testid="settings-backup">
      <PaneTitle>Backup</PaneTitle>

      <ICloudGroup blocked={blocked} desk />

      <DeskGroup
        title="File"
        footer="A file kept somewhere else — in Files, on another computer, or sent by message or email. A backup made on any device will do. It is not encrypted: anyone with the file can read the finances in it, so keep it somewhere private."
      >
        <DeskRow
          lead={<DeskIcon icon={Download} tint={GREY} />}
          title="Backup file"
          subtitle={last.isSuccess ? `Last saved ${lastSaved(last.data)}` : undefined}
          right={
            <button type="button" className={DESK_BTN} disabled={blocked} onClick={() => !busy && !pending && void flows.onExport()}>
              Download backup
            </button>
          }
        />
        <DeskRow
          lead={<DeskIcon icon={Upload} tint={GREY} />}
          title="Restore from a file…"
          subtitle="Replaces all the data on this device. A safety copy downloads first."
          right={
            <button type="button" className={DESK_BTN} disabled={blocked} onClick={() => !busy && !pending && flows.chooseBackupFile()}>
              Choose file…
            </button>
          }
        />
      </DeskGroup>

      <DeskGroup title="Photos" footer="Photos live beside the database on this device. The backup file holds the figures; this zip holds the pictures.">
        {photoCount > 0 && (
          <DeskRow
            lead={<DeskIcon icon={Image} tint={GREY} />}
            title="Photos on this device"
            subtitle={photoWords(photoCount)}
            right={
              <button type="button" className={DESK_BTN} disabled={blocked} onClick={() => !busy && !pending && void flows.onDownloadPhotos()}>
                Download photos ({photoCount})
              </button>
            }
          />
        )}
        <DeskRow
          lead={photoCount > 0 ? undefined : <DeskIcon icon={Image} tint={GREY} />}
          title="Restore photos…"
          subtitle="Puts back pictures a transaction here still names. Nothing on this device is replaced."
          right={
            <button type="button" className={DESK_BTN} disabled={blocked} onClick={() => !busy && !pending && flows.choosePhotoZip()}>
              Choose…
            </button>
          }
        />
      </DeskGroup>

      {done && <p className="mb-[14px] px-[4px] text-[13px] leading-[18px] font-semibold text-[var(--mk-t-green)]">{done}</p>}
      <div className="mb-[14px] empty:hidden">
        <ErrorBox error={error} />
      </div>

      {/* Directly under the actions that raise it, as on the phone: the second press is never somewhere to go looking for. */}
      {pending && (
        <section className="mb-[22px] rounded-[18px] bg-[var(--mk-t-orange-bg)] px-[20px] py-[16px]" data-testid="restore-confirm">
          <h3 className="text-[15px] font-bold text-[var(--mk-ink)]">Before replacing the data</h3>
          <p className="mt-[4px] text-[13px] leading-[18px] text-[var(--mk-t-orange)]">
            Check that <strong>{pending.safetyName}</strong> is in Downloads. It is the only copy of the data on this device right now. Continue only once it is there.
          </p>
          <div className="mt-[12px] flex items-center justify-between gap-[12px]">
            <button type="button" className={DESK_BTN} disabled={busy} onClick={() => !busy && flows.cancelRestore()}>
              Cancel
            </button>
            <button type="button" className={DESK_BTN_DANGER} disabled={busy} onClick={() => !busy && void flows.onConfirmRestore()}>
              Replace my data with {pending.name}
            </button>
          </div>
        </section>
      )}

      <DeskGroup
        title="Safety copies on this device"
        footer="cicis keeps a copy of the data before every update and once on each day the app is opened, so a bad update or the wrong restore can be undone. They sit in the app's own storage on this device, so they are not a backup: anything that loses the data loses them with it."
      >
        {kept.data?.length ? (
          kept.data.map((copy) => (
            <DeskRow
              key={copy.file}
              title={formatWhen(copy.takenAt)}
              subtitle={`${copyReasonWords(copy.reason)} · ${formatBytes(copy.bytes)}`}
              right={
                <button
                  type="button"
                  className={DESK_BTN}
                  disabled={blocked}
                  aria-label={`Restore this copy from ${formatWhen(copy.takenAt)}`}
                  onClick={() => !busy && !pending && void flows.onChooseCopy(copy)}
                >
                  Restore
                </button>
              }
            />
          ))
        ) : (
          <DeskRow quiet title="No copies on this device yet" subtitle="One is taken the first time cicis opens each day, and before any update to the data." />
        )}
      </DeskGroup>

      <BackupFileInputs flows={flows} />
    </div>
  );
}
