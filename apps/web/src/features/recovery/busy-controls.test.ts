import { describe, expect, it } from 'vitest';
import { type RecoveryControl, disabledWhileBusy, ESCAPES } from './busy-controls';

const EVERY: RecoveryControl[] = ['restore', 'export', 'retry', 'start-fresh', 'download-backup', 'delete-everything', 'keep-my-data'];

describe('what the recovery screen keeps pressable while it is working', () => {
  it('leaves every control alone when nothing is in flight', () => {
    expect(EVERY.filter((control) => disabledWhileBusy(control, false))).toEqual([]);
  });

  /*
   * The defect, stated: `askWorker` has no bound, so a restore or a wipe that quietly never answers holds
   * `busy` for ever. With Try again disabled by it the last-resort screen has no way out but a reload the
   * user has no reason to think of, and with "Keep my data" disabled the Start fresh sheet cannot even be
   * shut. Both are pure navigation. Neither may ever be withheld.
   */
  it('never takes the way out away, however long an action runs', () => {
    expect(disabledWhileBusy('retry', true)).toBe(false);
    expect(disabledWhileBusy('keep-my-data', true)).toBe(false);
  });

  it('still holds back everything that writes, or that would start a second piece of work', () => {
    expect(EVERY.filter((control) => disabledWhileBusy(control, true))).toEqual(['restore', 'export', 'start-fresh', 'download-backup', 'delete-everything']);
  });

  it('counts an escape as one that only navigates, reloads or closes', () => {
    // A deliberately short list: anything added to it must be unable to touch a file or an engine.
    expect([...ESCAPES]).toEqual(['retry', 'keep-my-data']);
  });
});
