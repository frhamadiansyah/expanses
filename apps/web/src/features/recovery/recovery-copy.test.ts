import { describe, expect, it } from 'vitest';
import type { RecoveryReason, SnapshotInfo } from '../../db/open';
import { lastGoodCopy, MID_SESSION_NOTE, recoveryCopy } from './recovery-copy';

const reason = (kind: RecoveryReason['kind'], extra: Partial<RecoveryReason> = {}): RecoveryReason => ({
  kind,
  headline: 'Something happened.',
  detail: 'technical',
  exportable: true,
  ...extra,
});

describe('recoveryCopy', () => {
  it('always says the data is still there, and never shows the technical text as the headline', () => {
    for (const kind of ['cannot-open', 'unreadable', 'corrupt', 'newer-database', 'migration-failed', 'verify-failed', 'locked'] as const) {
      const copy = recoveryCopy(reason(kind), { hasSnapshot: true });
      expect(copy.headline).not.toBe('technical');
      expect(copy.body.length).toBeGreaterThan(20);
      expect(copy.actions).toContain('export');
    }
  });

  it('offers the last good copy only when there is one', () => {
    expect(recoveryCopy(reason('corrupt'), { hasSnapshot: true }).actions).toContain('restore');
    expect(recoveryCopy(reason('corrupt'), { hasSnapshot: false }).actions).not.toContain('restore');
  });

  it('never offers deletion to someone whose app is simply too old', () => {
    const copy = recoveryCopy(reason('newer-database'), { hasSnapshot: true });
    expect(copy.actions).toEqual(['export', 'retry']);
    expect(copy.headline).toBe('This data was made by a newer version of Expanses');
  });

  /*
   * Spec §3.4. The same failure, found with the app open and the user in it, needs one extra sentence and
   * nothing else: they were looking at their money a second ago and it has just gone off the screen.
   */
  it('tells someone the app went out from under them what they have actually lost', () => {
    const copy = recoveryCopy(reason('corrupt', { midSession: true }), { hasSnapshot: true });
    expect(copy.body.startsWith(MID_SESSION_NOTE)).toBe(true);
    expect(copy.body).toContain('not your money');
    // Never alarming, never an instruction to delete anything, and every button still on offer.
    expect(copy.body).not.toMatch(/delete|reinstall|lost your data|corrupt/i);
    expect(copy.actions).toEqual(['export', 'restore', 'retry', 'start-fresh']);
  });

  it('does not tell someone who has only just launched the app that they lost a screen', () => {
    expect(recoveryCopy(reason('corrupt'), { hasSnapshot: true }).body).not.toContain(MID_SESSION_NOTE);
    // And the recovery tools, asked for on purpose, say nothing went wrong at all — even from a fatal.
    expect(recoveryCopy(reason('corrupt', { midSession: true }), { hasSnapshot: true, requested: true }).body).not.toContain(MID_SESSION_NOTE);
  });

  it('says the data stopped answering, rather than that it would not open, when it had already opened', () => {
    expect(recoveryCopy(reason('unreadable'), { hasSnapshot: true }).headline).toBe('Your data is on this device, but it would not open');
    expect(recoveryCopy(reason('unreadable', { midSession: true }), { hasSnapshot: true }).headline).toBe('Your data stopped answering');
  });

  it('says the update was undone when it was', () => {
    const copy = recoveryCopy(reason('verify-failed', { rolledBack: true }), { hasSnapshot: true });
    expect(copy.headline).toBe('Your update was undone');
    expect(copy.body).toContain('Nothing was lost');
  });

  it('says the same of an update that threw part-way and was put back', () => {
    const copy = recoveryCopy(reason('migration-failed', { rolledBack: true }), { hasSnapshot: true });
    expect(copy.headline).toBe('Your update was undone');
    expect(copy.body).toContain('exactly as it was');
    // Not rolled back is a different sentence: nothing may claim the data was put back when it was not.
    expect(recoveryCopy(reason('migration-failed'), { hasSnapshot: true }).headline).toBe('The update to your data could not be finished');
  });

  it('does not offer a restore or a wipe when storage is not working at all', () => {
    const copy = recoveryCopy(reason('cannot-open', { exportable: false }), { hasSnapshot: false });
    expect(copy.actions).toEqual(['retry']);
  });

  it('does not offer to put back a copy of an update that has already been put back', () => {
    // The live file *is* that copy: the button would take a second press to change nothing at all.
    for (const kind of ['migration-failed', 'verify-failed'] as const) {
      expect(recoveryCopy(reason(kind, { rolledBack: true }), { hasSnapshot: true }).actions).not.toContain('restore');
      // A rollback that could not be made is a different matter: there the copy is the way back.
      expect(recoveryCopy(reason(kind, { rolledBack: false }), { hasSnapshot: true }).actions).toContain('restore');
    }
  });

  it('offers a second tab nothing that the first tab would block', () => {
    const copy = recoveryCopy(reason('locked'), { hasSnapshot: true });
    // The other tab holds every file open: a restore and a wipe would both fail on it. Export reads, so it stays.
    expect(copy.actions).toEqual(['export', 'retry']);
    expect(copy.headline).toBe('Expanses is already open in another tab');
    expect(copy.body).toContain('Close the other Expanses tab');
  });
});

describe('lastGoodCopy', () => {
  const copy = (takenAt: string, reason: SnapshotInfo['reason']): SnapshotInfo => ({
    file: `${takenAt}-${reason}`,
    reason,
    schemaVersion: 47,
    bytes: 1024,
    takenAt,
  });

  it('skips the copy taken before a restore, however new it is', () => {
    // The journey this exists for: a corrupt file was replaced with Tuesday's copy, so the newest copy on
    // the device is now a copy of the corruption. Offering it would hand the corruption back.
    const list = [copy('2026-09-18T09:00:00.000Z', 'daily'), copy('2026-09-19T10:00:00.000Z', 'before-restore')];
    expect(lastGoodCopy(list)?.takenAt).toBe('2026-09-18T09:00:00.000Z');
  });

  it('takes the newest of the copies that are candidates', () => {
    const list = [copy('2026-09-17T09:00:00.000Z', 'daily'), copy('2026-09-19T08:00:00.000Z', 'before-migration')];
    expect(lastGoodCopy(list)?.reason).toBe('before-migration');
  });

  it('answers with nothing when every copy is an undo of a restore', () => {
    expect(lastGoodCopy([copy('2026-09-19T10:00:00.000Z', 'before-restore')])).toBe(null);
    expect(lastGoodCopy([])).toBe(null);
  });
});
