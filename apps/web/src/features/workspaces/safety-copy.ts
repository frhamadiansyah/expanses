import { useApp } from '../../app/context';
import type { SnapshotReason } from '../../db/snapshot-policy';

/**
 * The safety copy a step that changes balances takes first, where the platform keeps them: a delete
 * (`before-delete`), Place them now (`before-place`, A8 review M-9). Without one, nothing is done.
 */
export function useSafetyCopy(reason: Extract<SnapshotReason, 'before-delete' | 'before-place'>) {
  const { safety } = useApp();
  return async () => {
    if (!safety) return;
    try {
      await safety.snapshots.write(await safety.bytes(), reason, safety.schemaVersion);
    } catch (failure) {
      console.warn('No safety copy could be taken first', reason, failure);
      throw new Error('A safety copy could not be kept first, so nothing was changed.');
    }
  };
}
