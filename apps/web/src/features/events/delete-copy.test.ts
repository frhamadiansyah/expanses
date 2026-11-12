import { describe, expect, it } from 'vitest';
import { deleteCopyConfirm, deleteEventCopyFlow } from './delete-copy';

describe('Delete this copy of a shared event', () => {
  it('asks in the owner’s words, naming the person, never “you”', () => {
    const text = deleteCopyConfirm({ name: 'Turkey trip', myName: 'Fandri' });
    expect(text).toBe('Delete this copy of Turkey trip? Fandri is no longer in it. What was recorded stays with the others.');
    expect(text).not.toMatch(/\byou(r)?\b/i);
  });

  it('takes the safety copy first, then deletes', async () => {
    const steps: string[] = [];
    await deleteEventCopyFlow({ safetyCopy: async () => void steps.push('copy'), remove: async () => void steps.push('delete') });
    expect(steps).toEqual(['copy', 'delete']);
  });

  it('deletes nothing when the safety copy cannot be kept', async () => {
    const steps: string[] = [];
    const failing = deleteEventCopyFlow({
      safetyCopy: async () => {
        throw new Error('A safety copy could not be kept first, so nothing was changed.');
      },
      remove: async () => void steps.push('delete'),
    });
    await expect(failing).rejects.toThrow('nothing was changed');
    expect(steps).toEqual([]);
  });
});
