import { describe, expect, it, vi } from 'vitest';
import { holdPhotosOrRefuse, PHOTOS_NOT_HELD_REFUSAL } from './hold-before-restore';
import { memoryDirectory } from './memory-directory';
import { makePhotoStore, type PhotoStore, type SweepShield } from './store';

const bytes = (text: string) => new TextEncoder().encode(text);

/** A store whose hold cannot be recorded — the full origin, the iOS Safari private window. */
function storeThatCannotHold(): PhotoStore {
  const unwritable: SweepShield = {
    read: () => [],
    write: () => {
      throw new Error('QuotaExceededError');
    },
  };
  return makePhotoStore(() => memoryDirectory(), unwritable);
}

/**
 * What a restore does when the photographs cannot be put beyond the sweep's reach.
 *
 * Both call sites used to read `await photos.holdPhotosBeforeRestore().catch(console.warn)` and go on to
 * restore. The database being restored has a safety copy taken a moment earlier; the pictures have no second
 * copy anywhere, and the sweep that runs on the reload after a restore is the thing that deletes them. So a
 * hold that did not happen stops the restore, and the only way past it is a person answering the question.
 */
describe('a restore that cannot protect the photographs', () => {
  it('holds every photo on the device and answers with the names, when the device lets it', async () => {
    const store = makePhotoStore(() => memoryDirectory());
    const photo = await store.savePhotoBytes(bytes('a receipt'), 'image/jpeg');
    const ask = vi.fn(() => true);

    expect(await holdPhotosOrRefuse(store, ask)).toEqual([photo.fileName]);
    // Nothing was asked, because nothing went wrong: the question is not part of an ordinary restore.
    expect(ask).not.toHaveBeenCalled();
  });

  it('refuses, so the restore never runs, when the hold could not be recorded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const asked: string[] = [];
    const declined = vi.fn((question: string) => {
      asked.push(question);
      return false;
    });

    await expect(holdPhotosOrRefuse(storeThatCannotHold(), declined)).rejects.toThrow(PHOTOS_NOT_HELD_REFUSAL);
    expect(declined).toHaveBeenCalledTimes(1);
    // Asked in words that say what is at stake, not "an error occurred".
    expect(asked[0]).toMatch(/no second copy anywhere/);
    expect(warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('lets the restore go ahead only when the user says so in so many words', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const accepted = vi.fn(() => true);

    expect(await holdPhotosOrRefuse(storeThatCannotHold(), accepted)).toEqual([]);
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
