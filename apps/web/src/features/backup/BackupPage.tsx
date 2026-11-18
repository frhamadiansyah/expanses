import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { formatBytes, formatWhen } from '../recovery/recovery-copy';
import { ICloudGroup } from './icloud/ICloudGroup';
import { copyReasonWords, daysSince } from './backupState';
import { BackupFileInputs, useBackupFlows } from './use-backup-flows';

/** The phone's Backup page (and the address /backup). What every action does lives in `useBackupFlows`. */
export function BackupPage() {
  const flows = useBackupFlows();
  const { photoIndex, last, kept, error, busy, done, pending, blocked } = flows;
  return (
    <div className={SCREEN}>
      <LargeTitle title="Backup" />

      <ICloudGroup blocked={blocked} />

      <InsetGroup
        header="File"
        info={
          <>
            A file kept somewhere else — in Files, on a computer, or sent by message or email. A backup made on any device will do: it is the same file everywhere. It is <strong>not encrypted</strong>: anyone with the file can read the finances in it, so keep it somewhere private.
          </>
        }
      >
        <InsetRow
          title="Download backup"
          value={last.data ? (daysSince(last.data) === 0 ? 'Today' : `${daysSince(last.data)} days ago`) : 'Never'}
          valueTone="ink-3"
          chevron={false}
          className={blocked ? 'opacity-40' : undefined}
          onClick={() => !busy && !pending && void flows.onExport()}
        />
        <InsetRow
          title="Restore from file…"
          label="Restore from file…"
          action
          className={blocked ? 'opacity-40' : undefined}
          onClick={() => !busy && !pending && flows.chooseBackupFile()}
        />
      </InsetGroup>

      <InsetGroup header="Photos" info="Photos live beside the database on this device. The backup file holds the figures; this zip holds the pictures.">
        {!!photoIndex.data?.length && (
          <InsetRow
            title={`Download photos (${photoIndex.data.length})`}
            action
            className={blocked ? 'opacity-40' : undefined}
            onClick={() => !busy && !pending && void flows.onDownloadPhotos()}
          />
        )}
        <InsetRow
          title="Restore photos…"
          action
          className={blocked ? 'opacity-40' : undefined}
          onClick={() => !busy && !pending && flows.choosePhotoZip()}
        />
      </InsetGroup>

      {done && <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-up)]">{done}</p>}
      <ErrorBox error={error} />

      {/* Directly under the action that raised it: the second press must never be somewhere the user has to go looking for. */}
      {pending && (
        <>
          {/* Prose, so a `Panel`: `InsetGroup` places rows, and this is the sentence that has to be read first. */}
          <Panel header="Before replacing the data">
            <p className="text-[13px] leading-[17px] text-[var(--ph-warn)]">
              Check that <strong>{pending.safetyName}</strong> is in Downloads. It is the only copy of the data on this device right now. Continue only once it is there.
            </p>
          </Panel>
          {/* Its own group, and its own air from Cancel: a replace-everything a row away from a cancel is the wrong tap. */}
          <InsetGroup>
            <DestructiveRow label={`Replace my data with ${pending.name}`} onClick={() => !busy && void flows.onConfirmRestore()} />
          </InsetGroup>
          <InsetGroup>
            <InsetRow title="Cancel" action className={busy ? 'opacity-40' : undefined} onClick={() => !busy && flows.cancelRestore()} />
          </InsetGroup>
        </>
      )}

      <InsetGroup
        header="Safety copies on this device"
        info={
          <>
            cicis keeps a copy of the data before every update and once on each day the app is opened, so a bad update or the wrong restore can be undone. They sit in the app&apos;s own storage on this device, which means they are <strong>not a backup</strong>: anything that loses the data loses them with it.
          </>
        }
      >
        {kept.data?.length ? (
          /* The row is the action: a row never holds a button, and "Restore" beside the moment is exactly what it is. */
          kept.data.map((copy) => (
            <InsetRow
              key={copy.file}
              title={formatWhen(copy.takenAt)}
              subtitle={`${copyReasonWords(copy.reason)} · ${formatBytes(copy.bytes)}`}
              value="Restore"
              chevron={false}
              label={`Restore this copy from ${formatWhen(copy.takenAt)}`}
              className={blocked ? 'opacity-40' : undefined}
              onClick={() => !busy && !pending && void flows.onChooseCopy(copy)}
            />
          ))
        ) : (
          <InsetRow
            title="No copies on this device yet"
            subtitle="One is taken the first time Expanses opens each day, and before any update to the data."
            chevron={false}
          />
        )}
      </InsetGroup>


      <BackupFileInputs flows={flows} />
    </div>
  );
}
