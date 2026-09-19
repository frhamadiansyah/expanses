import { describe, expect, it } from 'vitest';
import { backupUrgency, bannerWords, copyReasonWords, daysSince, isSqliteFile, reminderDue, snoozeUntil } from './backupState';

describe('backupUrgency', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  it('keeps today’s ladder and adds an overdue step at thirty days', () => {
    expect(backupUrgency('2026-09-15T12:00:00Z', true, now)).toBe('ok');
    expect(backupUrgency('2026-09-13T12:00:00Z', true, now)).toBe('remind');
    expect(backupUrgency('2026-09-06T12:00:00Z', true, now)).toBe('warn');
    expect(backupUrgency('2026-08-20T12:00:00Z', true, now)).toBe('overdue');
    expect(backupUrgency(null, true, now)).toBe('overdue');
    expect(backupUrgency(null, false, now)).toBe('ok');
  });

  it('says nothing about a device with no money on it, however old the last backup', () => {
    expect(backupUrgency('2020-01-01T00:00:00Z', false, now)).toBe('ok');
  });
});

describe('daysSince', () => {
  it('counts whole days in the device’s own calendar, not in elapsed hours', () => {
    // Half past eleven last night is yesterday, even though it is forty minutes ago.
    const justBeforeMidnight = new Date(2026, 8, 19, 23, 30);
    expect(daysSince(justBeforeMidnight.toISOString(), new Date(2026, 8, 20, 0, 10))).toBe(1);
    expect(daysSince(new Date(2026, 8, 20, 1, 0).toISOString(), new Date(2026, 8, 20, 23, 0))).toBe(0);
    expect(daysSince(new Date(2026, 7, 20, 9, 0).toISOString(), new Date(2026, 8, 20, 9, 0))).toBe(31);
  });

  it('never reads as negative when the clock has gone backwards', () => {
    expect(daysSince('2026-09-25T12:00:00Z', new Date('2026-09-20T12:00:00Z'))).toBe(0);
  });
});

describe('bannerWords', () => {
  it('says how long it has been, and what that means', () => {
    expect(bannerWords('overdue', 31)).toBe('No backup in 31 days. Your only copy is on this device.');
    expect(bannerWords('overdue', null)).toBe('You have not backed up yet. Your only copy is on this device.');
    expect(bannerWords('warn', 15)).toBe('No backup in 15 days. Your data exists only on this device.');
    expect(bannerWords('remind', 8)).toBe('No backup in 8 days. Your data exists only on this device.');
  });
});

describe('reminderDue', () => {
  const now = new Date('2026-09-20T12:00:00Z');

  it('stays quiet when there is nothing to say', () => {
    expect(reminderDue('ok', null, now)).toBe(false);
    expect(reminderDue('ok', { until: '2026-09-01T00:00:00Z', urgency: 'warn' }, now)).toBe(false);
  });

  it('speaks when nothing has been put off', () => {
    expect(reminderDue('remind', null, now)).toBe(true);
  });

  it('holds its tongue for a week after a “Not now”', () => {
    const snooze = { until: snoozeUntil(now), urgency: 'remind' as const };
    expect(reminderDue('remind', snooze, now)).toBe(false);
    expect(reminderDue('remind', snooze, new Date('2026-09-26T12:00:00Z'))).toBe(false);
    expect(reminderDue('remind', snooze, new Date('2026-09-27T12:00:00Z'))).toBe(true);
  });

  it('speaks again the moment it gets worse, snooze or not', () => {
    const snooze = { until: snoozeUntil(now), urgency: 'remind' as const };
    expect(reminderDue('warn', snooze, now)).toBe(true);
    expect(reminderDue('overdue', { until: snoozeUntil(now), urgency: 'warn' }, now)).toBe(true);
    // ...but a level already put off stays put off, even once it is the worst one there is.
    expect(reminderDue('overdue', { until: snoozeUntil(now), urgency: 'overdue' }, now)).toBe(false);
  });

  it('treats a snooze it cannot read as no snooze at all', () => {
    expect(reminderDue('warn', { until: 'sometime', urgency: 'warn' }, now)).toBe(true);
  });
});

describe('copyReasonWords', () => {
  it('says why each copy on the device was taken', () => {
    expect(copyReasonWords('before-migration')).toBe('Taken before an update');
    expect(copyReasonWords('daily')).toBe('The day’s copy');
    expect(copyReasonWords('before-restore')).toBe('Taken before a restore');
    expect(copyReasonWords('before-start-fresh')).toBe('Taken before starting fresh');
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
