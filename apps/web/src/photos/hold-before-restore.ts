import { photos, type PhotoStore } from './store';

/**
 * What a restore does about the photographs before it replaces the database — and what happens when it cannot.
 *
 * A restore is followed by a reload, and the reload sweeps: every file the restored database does not name is
 * read as an orphan and deleted. So the pictures on the device are put beyond the sweep's reach first
 * (`holdPhotosBeforeRestore`). The database restore already insists on a safety copy of the data it is about
 * to overwrite; this is the same insistence for the one thing in this app that has **no second copy anywhere**.
 *
 * Which is why a hold that could not be recorded — a full origin, an iOS Safari private window, a directory
 * that will not be walked — cannot be logged and stepped over. Both call sites used to `.catch(console.warn)`
 * and restore anyway, which is the whole protection gone in the one case it exists for. It stops the restore
 * now, and the user is asked before any restore goes ahead without it: losing a photograph is permanent, so
 * it is a decision a person makes, not one a warning in a console makes for them.
 */
export const PHOTOS_NOT_HELD_QUESTION =
  'Your photos could not be protected from the clean-up that runs after a restore. Restoring now can delete the photos on this device for good — they have no second copy anywhere. Restore anyway?';

/** What is said when the answer is no, or when there is nobody to ask. */
export const PHOTOS_NOT_HELD_REFUSAL = 'Nothing was restored: the photos on this device could not be protected from the clean-up a restore is followed by.';

const askInWindow = (question: string): boolean => (typeof window === 'undefined' ? false : window.confirm(question));

/**
 * Holds every photo on the device out of the sweep's reach, and **rejects** rather than letting a restore
 * proceed unheld — unless the user, asked in so many words, says to go ahead.
 */
export async function holdPhotosOrRefuse(store: PhotoStore = photos, ask: (question: string) => boolean = askInWindow): Promise<readonly string[]> {
  try {
    return await store.holdPhotosBeforeRestore();
  } catch (error) {
    console.warn('Photos could not be held back from the sweep', error);
    if (!ask(PHOTOS_NOT_HELD_QUESTION)) throw new Error(PHOTOS_NOT_HELD_REFUSAL);
    return [];
  }
}
