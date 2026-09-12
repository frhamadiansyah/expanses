import { describe, expect, it } from 'vitest';
import { DUE_SOON_DAYS, dueLabel, dueStateFor, statusFor } from '../src/index';

const TODAY = '2026-09-12';

describe('statusFor', () => {
  it('calls a debt with nothing left settled', () => {
    expect(statusFor(0, 'open')).toBe('settled');
  });

  it('keeps a debt with a balance open', () => {
    expect(statusFor(9_000_000, 'open')).toBe('open');
  });

  it('reopens a person who borrowed again after settling', () => {
    expect(statusFor(2_000_000, 'settled')).toBe('open');
  });

  it('leaves a forgiven debt forgiven, whatever the balance says', () => {
    expect(statusFor(4_000_000, 'forgiven')).toBe('forgiven');
    expect(statusFor(0, 'forgiven')).toBe('forgiven');
  });

  it('treats a balance below zero as settled, not as money owed back', () => {
    expect(statusFor(-1, 'open')).toBe('settled');
  });
});

describe('dueStateFor', () => {
  it('warns when the date agreed is close', () => {
    expect(dueStateFor('2026-09-18', TODAY, 'open')).toBe('due_soon');
  });

  it('warns on the last day of the window', () => {
    expect(dueStateFor('2026-10-03', TODAY, 'open')).toBe('due_soon');
    expect(DUE_SOON_DAYS).toBe(21);
  });

  it('says nothing about a date two months out', () => {
    expect(dueStateFor('2026-11-30', TODAY, 'open')).toBe('none');
  });

  it('calls a date already past overdue', () => {
    expect(dueStateFor('2026-09-01', TODAY, 'open')).toBe('overdue');
  });

  it('counts the day itself as due soon, not overdue', () => {
    expect(dueStateFor(TODAY, TODAY, 'open')).toBe('due_soon');
  });

  it('says nothing about a debt already settled or forgiven', () => {
    expect(dueStateFor('2026-09-01', TODAY, 'settled')).toBe('none');
    expect(dueStateFor('2026-09-01', TODAY, 'forgiven')).toBe('none');
  });

  it('says nothing when no date was agreed', () => {
    expect(dueStateFor(null, TODAY, 'open')).toBe('none');
  });
});

describe('dueLabel', () => {
  it('counts the days left', () => {
    expect(dueLabel('2026-09-18', TODAY, 'open')).toBe('Due in 6 days');
  });

  it('says tomorrow and today in words', () => {
    expect(dueLabel('2026-09-13', TODAY, 'open')).toBe('Due tomorrow');
    expect(dueLabel(TODAY, TODAY, 'open')).toBe('Due today');
  });

  it('counts the days late', () => {
    expect(dueLabel('2026-09-01', TODAY, 'open')).toBe('11 days overdue');
  });

  it('gives the plain date when it is far off', () => {
    expect(dueLabel('2026-11-30', TODAY, 'open')).toBe('Due 30 Nov 2026');
  });

  it('says nothing for a settled debt or a debt with no date', () => {
    expect(dueLabel('2026-09-01', TODAY, 'settled')).toBe('');
    expect(dueLabel(null, TODAY, 'open')).toBe('');
  });
});
