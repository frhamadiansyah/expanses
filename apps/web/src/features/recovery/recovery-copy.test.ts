import { describe, expect, it } from 'vitest';
import type { RecoveryReason } from '../../db/open';
import { recoveryCopy } from './recovery-copy';

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
});
