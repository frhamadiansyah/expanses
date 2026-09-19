import { describe, expect, it } from 'vitest';
import { type RecoveryControl, type RecoveryWork, disabledWhileBusy, PRESSABLE_DURING } from './busy-controls';

const EVERY: RecoveryControl[] = ['restore', 'export', 'retry', 'start-fresh', 'download-backup', 'delete-everything', 'keep-my-data'];
const EVERY_WORK: RecoveryWork[] = ['restore', 'export', 'wipe'];

const disabledDuring = (work: RecoveryWork | null) => EVERY.filter((control) => disabledWhileBusy(control, work));

describe('what the recovery screen keeps pressable while it is working', () => {
  it('leaves every control alone when nothing is in flight', () => {
    expect(disabledDuring(null)).toEqual([]);
  });

  /*
   * The defect, stated: `askWorker` has no bound, so a wipe that quietly never answers holds the sheet
   * open for ever. With "Keep my data" disabled by it the Start fresh sheet cannot even be shut, on the
   * one screen whose purpose is to never be a dead end. Closing the sheet unmounts a dialog; the wipe
   * lives on a worker of its own in a closure. It touches nothing, so it is never withheld.
   */
  it('never takes the way out of the sheet away, whatever is running', () => {
    for (const work of EVERY_WORK) expect(disabledWhileBusy('keep-my-data', work)).toBe(false);
  });

  /*
   * And the correction to it. "Try again" is `window.location.href = …`, and a dedicated worker dies with
   * the document that owns it — so pressing it during a restore terminates the borrowed worker between
   * reading the previous bytes and putting them back, which is a torn live slot. It is the one press on
   * this screen that can damage the work it interrupts, and the one kind of work it can damage.
   */
  it('holds Try again back while a restore is writing the file, and never otherwise', () => {
    expect(disabledWhileBusy('retry', 'restore')).toBe(true);
    expect(disabledWhileBusy('retry', 'export')).toBe(false);
    expect(disabledWhileBusy('retry', 'wipe')).toBe(false);
  });

  it('still holds back everything that writes, or that would start a second piece of work', () => {
    expect(disabledDuring('restore')).toEqual(['restore', 'export', 'retry', 'start-fresh', 'download-backup', 'delete-everything']);
    expect(disabledDuring('export')).toEqual(['restore', 'export', 'start-fresh', 'download-backup', 'delete-everything']);
    expect(disabledDuring('wipe')).toEqual(['restore', 'export', 'start-fresh', 'download-backup', 'delete-everything']);
  });

  it('counts nothing as pressable that could end the worker the work is running in', () => {
    // A deliberately short table: a control earns a row only when pressing it cannot reach that work.
    expect(PRESSABLE_DURING).toEqual({
      restore: ['keep-my-data'],
      export: ['retry', 'keep-my-data'],
      wipe: ['retry', 'keep-my-data'],
    });
  });
});
