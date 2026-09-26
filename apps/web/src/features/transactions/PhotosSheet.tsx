import { allPhotoRows, addPhoto, deletePhoto, type TransactionPhotoRow } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Image as ImageIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { photos } from '../../photos/store';
import { sweepPhotosAtStart } from '../../photos/sweep-at-start';
import { usePhotoUrls } from '../../photos/use-photo-urls';
import { ErrorBox } from '../../ui';
import { FormRow, FormRows, RowGlyph } from './FormRow';
import type { FormDraft } from './tx-form';

/** "None", or "2 photos" — what the Photos row says without being opened. */
export const photosSummary = (draft: FormDraft): string =>
  draft.photoIds.length === 0 ? 'None' : `${draft.photoIds.length} ${draft.photoIds.length === 1 ? 'photo' : 'photos'}`;

/**
 * The pictures on this transaction — §4's Photos row, as its own screen.
 *
 * **Two identifiers, and they are not interchangeable.** `savePhotoBytes` answers an OPFS *file name*;
 * `addPhoto` answers a `transaction_photos.id`. `draft.photoIds` holds the row ids, because that is what
 * `writeExtrasTx` re-keys onto the transaction at Save. So each pick is two writes, in this order: the bytes
 * first, so no row ever names a file that is not there.
 *
 * Both writes are allowed to fail loudly, and neither failure may be papered over:
 *
 * - `savePhotoBytes` throws where there is no OPFS. It has no honest empty answer — a caller handed a file
 *   name writes a row naming a file that was never written — so the sheet says photos are not available here.
 * - `addPhoto` throws on a device below the migration that made `transaction_photos`. An id handed back from a
 *   write that never happened is a phantom: the form would accept a photograph attached to a transaction that
 *   has none of it. So the bytes just written are taken off the device again and the user is told.
 *
 * A photograph has no second copy anywhere — not in the sqlite backup, not on a server. Nothing here uploads,
 * fetches, or hands a picture to a third party, and the bytes are read through the main thread's OPFS only,
 * never the worker's and never near the database's own `.expanses/` directory.
 */
export function PhotosSheet({ draft, onChange, onClose }: { draft: FormDraft; onChange: (draft: FormDraft) => void; onClose: () => void }) {
  const { database, ws } = useApp();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<TransactionPhotoRow | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  /*
   * The rows are read back rather than kept in this component's state, because the sheet is closed and
   * reopened while the form is still being filled in and `draft.photoIds` is all that survives it.
   * `allPhotoRows` is the reader the backup screen already uses; filtering it to this draft's ids here is
   * cheaper than a second repository function that asks the same question a narrower way.
   */
  const rows = useQuery({ queryKey: ['all-photo-rows', ws.workspaceId], queryFn: () => allPhotoRows(database, ws) });
  const byId = new Map((rows.data ?? []).map((row) => [row.id, row]));
  const mine = draft.photoIds.map((id) => byId.get(id)).filter((row): row is TransactionPhotoRow => !!row);
  const urls = usePhotoUrls(mine);
  const refresh = () => client.invalidateQueries({ queryKey: ['all-photo-rows', ws.workspaceId] });

  async function attach(files: readonly File[]) {
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // The bytes first, so a row never names a file that is not there; then the row, owned by nobody yet.
        // Save re-keys it onto the transaction (`writeExtrasTx`); an abandoned form leaves a row and a file
        // that the app-start sweep and the orphan pass tidy away together.
        const { fileName, byteSize } = await photos.savePhotoBytes(bytes, file.type);
        try {
          added.push(await addPhoto(database, ws, { transactionId: '', fileName, mime: file.type, byteSize }));
        } catch (rowFailed) {
          // The row did not go in, so nothing will ever name these bytes. Take them back off the device now
          // rather than leave a file for the sweep to find, and let the failure reach the user: a form that
          // swallowed this would be a form that accepted a photograph it did not keep.
          await photos.deletePhotoFile(fileName);
          throw rowFailed;
        }
      }
    } catch (e) {
      setError(e);
    } finally {
      // Whatever did go in is attached, even when a later file failed: a row nothing points at is an orphan
      // the next sweep deletes, taking a photograph the user watched arrive with it.
      if (added.length > 0) {
        onChange({ ...draft, photoIds: [...draft.photoIds, ...added] });
        await refresh();
      }
      setBusy(false);
    }
  }

  async function drop(row: TransactionPhotoRow) {
    setError(null);
    setBusy(true);
    try {
      // The reverse of attaching, both halves: the row first, then the file it named.
      await deletePhoto(database, ws, row.id);
      await photos.deletePhotoFile(row.fileName);
      onChange({ ...draft, photoIds: draft.photoIds.filter((id) => id !== row.id) });
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    onClose();
    /*
     * The same sweep the app runs at start, called through the same function, so a file whose row has just
     * been deleted goes with it rather than waiting for the next launch. Never `kept ?? []`:
     * `allPhotoFileNames` answers **null** where there is no table to ask, and a null read as an empty list
     * tells the sweep that no file on this device is referenced.
     *
     * Rows written for this open form carry `transaction_id = ''` and are returned by `allPhotoFileNames` all
     * the same, so the pictures waiting on the draft behind this sheet are named and safe.
     */
    void sweepPhotosAtStart(database).catch(() => {
      // Tidying can wait for the next launch; it is never worth failing a form over.
    });
  }

  const pick = (input: HTMLInputElement | null) => {
    setError(null);
    input?.click();
  };

  return (
    <Sheet grouped title="Photos" onClose={close}>
      <div className="space-y-3">
        <div
          onDragOver={(e) => {
            // Desktop only, and it has to be said twice: without both, the browser navigates to the file.
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void attach([...e.dataTransfer.files]);
          }}
          className={dragging ? 'rounded-xl ring-2 ring-[var(--ph-tint)]' : ''}
        >
          <ul data-testid="photo-grid" className="grid grid-cols-3 gap-[6px] sm:grid-cols-4">
            {mine.map((row, i) => (
              <li key={row.id} className="relative">
                <button
                  type="button"
                  aria-label={`Photo ${i + 1}`}
                  onClick={() => setViewing(row)}
                  className="ph-focus-inset block aspect-[3/4] w-full overflow-hidden rounded-[10px] bg-[var(--ph-surface)] ring-[0.5px] ring-[var(--ph-hair)]"
                >
                  {urls[row.fileName] && <img src={urls[row.fileName]} alt="" className="h-full w-full object-cover" />}
                </button>
                <button
                  type="button"
                  aria-label={`Remove photo ${i + 1}`}
                  disabled={busy}
                  onClick={() => void drop(row)}
                  className="ph-focus absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ph-scrim)] text-xs text-[var(--ph-selected)]"
                >
                  ✕
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                aria-label="Add a photo"
                disabled={busy}
                onClick={() => pick(library.current)}
                className="ph-focus-inset flex aspect-[3/4] w-full items-center justify-center rounded-[10px] border border-dashed border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-2xl text-[var(--ph-tint)]"
              >
                +
              </button>
            </li>
          </ul>
        </div>

        {/* D2's two rows, in the tint: the camera itself, or the library. */}
        <FormRows>
          <FormRow
            icon={<RowGlyph tone="plain"><Camera size={16} className="text-[var(--ph-tint)]" /></RowGlyph>}
            label="Take photo"
            tone="tint"
            chevron={false}
            disabled={busy}
            onClick={() => pick(camera.current)}
          />
          <FormRow
            icon={<RowGlyph tone="plain"><ImageIcon size={16} className="text-[var(--ph-tint)]" /></RowGlyph>}
            label="Choose from library"
            tone="tint"
            chevron={false}
            disabled={busy}
            onClick={() => pick(library.current)}
          />
        </FormRows>

        {/*
          Two inputs rather than one: `capture` asks a phone for the camera itself, and an input carrying it
          cannot also be the one that opens the library. Both are hidden and driven by the buttons above, so
          the sheet reads as two plain choices rather than as a file field.
        */}
        <input
          ref={camera}
          data-testid="photo-camera-input"
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void attach([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={library}
          data-testid="photo-library-input"
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            void attach([...(e.target.files ?? [])]);
            // Cleared, so choosing the very same file twice in a row is still a change the input reports.
            e.target.value = '';
          }}
        />

        <p className="px-1 text-[12px] leading-4 text-[var(--ph-ink-3)]">Photos stay on this device with the transaction and go into your backups. Tap one to see it full size.</p>
        <ErrorBox error={error} />
      </div>

      {viewing && (
        <Sheet title="Photo" onClose={() => setViewing(null)}>
          {urls[viewing.fileName] ? (
            <img src={urls[viewing.fileName]} alt="Receipt photo" className="mx-auto max-h-[70dvh] w-auto rounded-xl" />
          ) : (
            <p className="text-sm text-slate-500">That picture is not on this device.</p>
          )}
        </Sheet>
      )}
    </Sheet>
  );
}
