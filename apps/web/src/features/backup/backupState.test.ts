import { describe, expect, it } from 'vitest';
import { backupUrgency, isSqliteFile } from './backupState';

describe('backupUrgency', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  it('escalates with age and when data was never backed up', () => {
    expect(backupUrgency(null, false, now)).toBe('ok');
    expect(backupUrgency(null, true, now)).toBe('warn');
    expect(backupUrgency('2026-09-15T12:00:00Z', true, now)).toBe('ok');
    expect(backupUrgency('2026-09-13T12:00:00Z', true, now)).toBe('remind');
    expect(backupUrgency('2026-09-06T12:00:00Z', true, now)).toBe('warn');
  });
});

describe('isSqliteFile', () => {
  it('checks the SQLite magic bytes', () => {
    const good = new Uint8Array(100);
    good.set(new TextEncoder().encode('SQLite format 3'));
    expect(isSqliteFile(good)).toBe(true);
    const bad = new Uint8Array(100);
    bad.set(new TextEncoder().encode('SQLite format 3x'));
    expect(isSqliteFile(bad)).toBe(false);
    expect(isSqliteFile(new Uint8Array(100))).toBe(false);
  });
});
