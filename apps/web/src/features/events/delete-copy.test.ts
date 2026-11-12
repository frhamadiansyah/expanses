import { describe, expect, it } from 'vitest';
import { deleteCopyConfirm, deletedCopyLine, deleteEventCopyFlow } from './delete-copy';

const view = { name: 'Turkey trip', myName: 'Fandri' };
const NEVER_SENT = 'Some records made on this phone never reached the others; the safety copy taken first keeps them.';

describe('Delete this copy of a shared event', () => {
  it('asks in the owner’s words, naming the person, never “you”', () => {
    const text = deleteCopyConfirm(view, { unsentHere: 0 });
    expect(text).toBe('Delete this copy of Turkey trip? Fandri is no longer in it. What was recorded stays with the others.');
    expect(text).not.toMatch(/\byou(r)?\b/i);
  });

  it('says so when records made here never reached the others, and only then (review minor 3)', () => {
    expect(deleteCopyConfirm(view, { unsentHere: 2 })).toBe(
      `Delete this copy of Turkey trip? Fandri is no longer in it. What was recorded stays with the others. ${NEVER_SENT}`,
    );
    expect(deleteCopyConfirm(view, { unsentHere: 2 })).not.toMatch(/\byou(r)?\b/i);
  });

  const steps = (log: string[], over: Partial<Parameters<typeof deleteEventCopyFlow>[1]> = {}) => ({
    plan: async () => (log.push('plan'), { refusal: null, unsentHere: 0 }),
    confirm: (text: string) => (log.push(`confirm ${text.endsWith(NEVER_SENT) ? 'unsent' : 'plain'}`), true),
    safetyCopy: async () => void log.push('copy'),
    remove: async () => void log.push('delete'),
    ...over,
  });

  it('plans, asks, takes the safety copy, then deletes', async () => {
    const log: string[] = [];
    expect(await deleteEventCopyFlow(view, steps(log))).toBe('deleted');
    expect(log).toEqual(['plan', 'confirm plain', 'copy', 'delete']);
  });

  it('a refusal is shown in its own words, and nothing is asked, copied or deleted (review I1)', async () => {
    const log: string[] = [];
    const refusal = "Fandri's balance in Turkey trip is +TRY 500,00, not zero: this copy is kept as the record of who owes whom.";
    await expect(deleteEventCopyFlow(view, steps(log, { plan: async () => (log.push('plan'), { refusal, unsentHere: 0 }) }))).rejects.toThrow(refusal);
    expect(log).toEqual(['plan']);
  });

  it('asks with the unsent sentence when the plan counts any', async () => {
    const log: string[] = [];
    await deleteEventCopyFlow(view, steps(log, { plan: async () => (log.push('plan'), { refusal: null, unsentHere: 1 }) }));
    expect(log).toEqual(['plan', 'confirm unsent', 'copy', 'delete']);
  });

  it('a No changes nothing', async () => {
    const log: string[] = [];
    expect(await deleteEventCopyFlow(view, steps(log, { confirm: () => (log.push('confirm'), false) }))).toBe('cancelled');
    expect(log).toEqual(['plan', 'confirm']);
  });

  it('deletes nothing when the safety copy cannot be kept', async () => {
    const log: string[] = [];
    const failing = deleteEventCopyFlow(view, steps(log, { safetyCopy: async () => { throw new Error('A safety copy could not be kept first, so nothing was changed.'); } }));
    await expect(failing).rejects.toThrow('nothing was changed');
    expect(log).toEqual(['plan', 'confirm plain']);
  });

  it('a kept transaction of a deleted copy names its event, and offers no way to it (review minor 1)', () => {
    expect(deletedCopyLine('Turkey trip')).toBe('From Turkey trip, copy deleted here');
    expect(deletedCopyLine(null)).toBe('From a shared event, copy deleted here');
  });
});
