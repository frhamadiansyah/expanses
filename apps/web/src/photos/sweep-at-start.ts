import { allPhotoFileNames, type Database } from '@expanses/db';
import { type PhotoStore, photos } from './store';

/**
 * The app-start sweep, as one function, so that what is tested is what runs.
 *
 * This used to be three lines inside `Layout.tsx`'s effect, and the test for it re-typed those three lines by
 * hand under a comment reading "Layout.tsx, exactly". It was not: it was a copy, and a copy cannot regress
 * when the original does. Both halves of the pairing that keeps a photograph alive lived in the copy —
 * `allPhotoFileNames` answering null, and the sweep refusing null — so putting `kept ?? []` back in the
 * component reintroduced the exact hazard this whole area exists to prevent, and the suite stayed green.
 *
 * Now `Layout.tsx` calls this and nothing else, `photos.spec.ts` proves it calls it against real OPFS, and
 * the null path — a device below a blocked update, where there is no `transaction_photos` table to ask — is
 * asserted here, on the function that actually runs.
 *
 * `store` is a parameter only so a test can hand in a directory that is not OPFS; the app never passes one.
 */
export async function sweepPhotosAtStart(database: Database, store: PhotoStore = photos): Promise<number> {
  return store.sweepOrphanPhotos(await allPhotoFileNames(database));
}
