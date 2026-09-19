import { describe, expect, it } from 'vitest';
import { MID_SESSION_NOTE, recoveryCopy, SCREEN_STOPPED_NOTE } from './recovery-copy';
import { screenFailureReason } from './screen-failure';

describe('a screen that threw while it was drawing', () => {
  it('is a typed reason, never a blank page, and never claims the data is the problem', () => {
    const reason = screenFailureReason(new TypeError("Cannot read properties of undefined (reading 'map')"));
    expect(reason.kind).toBe('cannot-open');
    expect(reason.midSession).toBe(true);
    // The bytes are untouched and the recovery screen reads them off OPFS without the engine either way.
    expect(reason.exportable).toBe(true);
    expect(reason.detail).toContain("reading 'map'");
  });

  it('says the same thing to SQLite that §3.4 does, when SQLite is what threw', () => {
    // A screen that threw because the query underneath it rejected with a corrupt page is not a screen bug:
    // it is the mid-session fatal, arriving through a component instead of through the executor.
    const reason = screenFailureReason(new Error('database disk image is malformed'));
    expect(reason.kind).toBe('corrupt');
    expect(reason.midSession).toBe(true);
    expect(recoveryCopy(reason, { hasSnapshot: true }).body.startsWith(MID_SESSION_NOTE)).toBe(true);
  });

  it('reaches the user as words about a screen, not about their money', () => {
    const copy = recoveryCopy(screenFailureReason(new Error('undefined is not a function')), { hasSnapshot: true });
    expect(copy.body.startsWith(SCREEN_STOPPED_NOTE)).toBe(true);
    expect(copy.headline).toBe('That screen stopped before it could finish');
    expect(copy.body).toContain('exactly as they were');
    // The three rules every line of this screen holds to.
    expect(copy.body).not.toMatch(/delete|reinstall|lost your data|corrupt/i);
    expect(copy.headline).not.toMatch(/undefined is not a function/);
    // Nothing is a dead end: every tool is on offer, including the way back to a copy.
    expect(copy.actions).toEqual(['export', 'restore', 'retry', 'start-fresh']);
  });

  it('says nothing about a screen to someone who never got one', () => {
    // The open-time `cannot-open` is a different sentence, and must not pick this one up.
    const copy = recoveryCopy({ kind: 'cannot-open', headline: 'log', detail: 'x', exportable: true }, { hasSnapshot: true });
    expect(copy.headline).toBe('We could not open your data this time');
    expect(copy.body).not.toContain(SCREEN_STOPPED_NOTE);
  });
});
